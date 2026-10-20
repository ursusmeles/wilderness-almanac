const LIMIT = 32;
const CACHE_VERSION = 1;
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
      campaign.generatorVersion,
      campaign.seed,
      campaign.variant,
      campaign.colors,
      campaign.iconKey,
      campaign.hexEdits,
    ]),
  );
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Optional bounded image cache, kept outside the campaign/localStorage quota.
// Cache failures never affect campaign saves or trigger a renderer download.
export async function loadThumbnail(campaign) {
  try {
    const [db, key] = await Promise.all([open(), signature(campaign)]);
    if (!db) return '';
    const record = await new Promise((resolve, reject) => {
      const request = db.transaction('icons').objectStore('icons').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return record?.image?.startsWith('data:image/png;base64,') ? record.image : '';
  } catch {
    return '';
  }
}
export async function saveThumbnail(campaign, image) {
  if (!image) return false;
  try {
    const [db, key] = await Promise.all([open(), signature(campaign)]);
    if (!db) return false;
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('icons', 'readwrite');
      const store = transaction.objectStore('icons');
      store.put({ id: key, image, savedAt: Date.now() });
      const all = store.getAll();
      all.onsuccess = () => {
        const oldest = all.result.sort((a, b) => b.savedAt - a.savedAt).slice(LIMIT);
        oldest.forEach((record) => store.delete(record.id));
      };
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    return true;
  } catch {
    return false;
  }
}
