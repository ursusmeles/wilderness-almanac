export const DATABASE_NAME = 'wilderness-almanac:campaigns';
export const STORES = ['campaigns', 'palettes', 'settings', 'recovery', 'journal'];

export function openDatabase(factory) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = factory.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        const store = db.createObjectStore(name, {
          keyPath: name === 'journal' ? ['campaignId', 'id'] : 'id',
        });
        if (name === 'journal') store.createIndex('campaign', 'campaignId');
      }
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error('blocked'));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (settled) request.result.close();
      else resolve(request.result);
    };
  });
}

export function requested(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Only await IndexedDB requests inside work: unrelated async work can make a
// transaction inactive. Success means the entire transaction committed.
export async function transact(db, names, mode, work) {
  const transaction = db.transaction(names, mode);
  const done = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction aborted'));
  });
  const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)]));
  try {
    const result = await work(stores);
    await done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* Already aborted or completed. */
    }
    await done.catch(() => {});
    throw error;
  }
}

export function readDatabase(db) {
  return transact(db, STORES, 'readonly', async (stores) =>
    Object.fromEntries(
      await Promise.all(STORES.map(async (name) => [name, await requested(stores[name].getAll())])),
    ),
  );
}

export async function requestPersistence(manager) {
  try {
    if (!manager?.persist) return 'unsupported';
    if (await manager.persisted?.()) return 'granted';
    return (await manager.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}
