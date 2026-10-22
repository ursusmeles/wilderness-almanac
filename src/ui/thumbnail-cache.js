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
      campaign.preferences,
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
function remember(record) {
  memory.delete(record.id);
  memory.set(record.id, record);
  if (memory.size > LIMIT) memory.delete(memory.keys().next().value);
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

export async function loadThumbnails(campaign, { allowStale = false } = {}) {
  try {
    const key = await signature(campaign);
    let record = memory.get(campaign.id);
    if (!record) {
      const db = await open();
      if (!db) return [];
      record = await new Promise((resolve, reject) => {
        const store = db.transaction('icons').objectStore('icons');
        const request = store.get(campaign.id);
        request.onsuccess = () => {
          if (request.result) return resolve(request.result);
          // Reuse the previous hashed cache until the campaign is rendered again.
          const legacy = store.get(key);
          legacy.onsuccess = () =>
            resolve(
              legacy.result && {
                ...legacy.result,
                id: campaign.id,
                signature: key,
                seed: campaign.seed,
                generatorVersion: campaign.generatorVersion,
                preferences: campaign.preferences,
              },
            );
          legacy.onerror = () => reject(legacy.error);
        };
        request.onerror = () => reject(request.error);
      });
      if (record) remember(record);
    }
    if (
      !record ||
      (record.signature !== key &&
        !(
          allowStale &&
          record.seed === campaign.seed &&
          record.generatorVersion === campaign.generatorVersion &&
          JSON.stringify(record.preferences) === JSON.stringify(campaign.preferences)
        ))
    )
      return [];
    return validImages(record.images);
  } catch {
    return [];
  }
}
export async function saveThumbnails(campaign, entries) {
  const images = validImages(entries);
  if (!images.length) return false;
  try {
    const key = await signature(campaign);
    const record = {
      id: campaign.id,
      signature: key,
      seed: campaign.seed,
      generatorVersion: campaign.generatorVersion,
      preferences: campaign.preferences,
      images,
      savedAt: Date.now(),
    };
    remember(record);
    const db = await open();
    if (!db) return false;
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('icons', 'readwrite');
      const store = transaction.objectStore('icons');
      store.put(record);
      store.delete(key);
      const all = store.getAll();
      all.onsuccess = () => {
        for (const record of all.result.sort((a, b) => b.savedAt - a.savedAt).slice(LIMIT))
          store.delete(record.id);
      };
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    return true;
  } catch {
    return false;
  }
}
