/** Tiny IndexedDB key/value cache for saved chat messages. Every call fails soft (private mode, eviction, no support). */
const DB = "vision-cache";
const STORE = "kv";
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return (dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  }));
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export const idbGet = <T>(key: string) => run<T>("readonly", (s) => s.get(key));
export const idbSet = (key: string, value: unknown) => run("readwrite", (s) => s.put(value, key));
export const idbDelete = (key: string) => run("readwrite", (s) => s.delete(key));
export const idbClear = () => run("readwrite", (s) => s.clear());
