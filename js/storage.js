let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not available in this environment.'));
    }
    const request = indexedDB.open('leaf-reader', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('data')) {
        db.createObjectStore('data');
      }
    };
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };
    request.onerror = () => reject(request.error || new Error('Failed to open database.'));
    request.onblocked = () => reject(new Error('Database open blocked by another tab.'));
  });
}

export const db = openDB().catch(err => {
  console.warn('Storage initialization fallback:', err);
  return null;
});

export async function get(key) {
  const d = (await db) || dbInstance || await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = d.transaction('data', 'readonly');
      const req = tx.objectStore('data').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    } catch (e) {
      reject(e);
    }
  });
}

export async function put(key, value) {
  const d = (await db) || dbInstance || await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = d.transaction('data', 'readwrite');
      tx.objectStore('data').put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    } catch (e) {
      reject(e);
    }
  });
}

export async function remove(key) {
  const d = (await db) || dbInstance || await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = d.transaction('data', 'readwrite');
      tx.objectStore('data').delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    } catch (e) {
      reject(e);
    }
  });
}
