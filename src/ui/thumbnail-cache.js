const LIMIT = 32;
const CACHE_VERSION = 2;
const memory = new Map();
let database;

async function open() {
  if (!database)
    database = new Promise((resolve) => {
      try {
        const request = indexedDB.open('wilderness-almanac:thumbnails', 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('icons', { keyPath: 'id' });
        request.onerror = request.onblocked = () => resolve(undefined);
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            database = undefined;
          };
          resolve(db);
        };
      } catch {
        resolve(undefined);
      }
    });
  return database;
}
async function signature(campaign) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      CACHE_VERSION,
      campaign.id,
      campaign.generatorVersion,
      campaign.seed,
      campaign.variant,
      campaign.colors,
      Object.entries(campaign.hexEdits?.cells ?? {}).flatMap(
        ([key, { visited: _visited, ...appearance }]) =>
          Object.keys(appearance).length ? [[key, appearance]] : [],
      ),
    ]),
  );
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Optional gallery cache. A session fallback keeps refresh usable if IndexedDB fails.
function remember(key, images) {
  memory.delete(key);
  memory.set(key, images);
  let count = [...memory.values()].reduce((sum, gallery) => sum + gallery.length, 0);
  for (const [oldest, gallery] of memory) {
    if (count <= LIMIT) break;
    memory.delete(oldest);
    count -= gallery.length;
  }
}
const validImages = (images) =>
  Array.isArray(images)
    ? images
        .filter(
          (entry) =>
            typeof entry?.key === 'string' &&
            typeof entry.image === 'string' &&
            entry.image.startsWith('data:image/png;base64,'),
        )
        .slice(0, 9)
    : [];

export async function loadThumbnails(campaign) {
  try {
    const key = await signature(campaign);
    if (memory.has(key)) return memory.get(key);
    const db = await open();
    if (!db) return [];
    const record = await new Promise((resolve, reject) => {
      const request = db.transaction('icons').objectStore('icons').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const images = validImages(record?.images);
    if (images.length) remember(key, images);
    return images;
  } catch {
    return [];
  }
}
export async function saveThumbnails(campaign, entries) {
  const images = validImages(entries);
  if (!images.length) return false;
  try {
    const key = await signature(campaign);
    remember(key, images);
    const db = await open();
    if (!db) return false;
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('icons', 'readwrite');
      const store = transaction.objectStore('icons');
      store.put({ id: key, images, savedAt: Date.now() });
      const all = store.getAll();
      all.onsuccess = () => {
        let count = 0;
        for (const record of all.result.sort((a, b) => b.savedAt - a.savedAt)) {
          count += record.images?.length ?? 1;
          if (count > LIMIT) store.delete(record.id);
        }
      };
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    return true;
  } catch {
    return false;
  }
}
