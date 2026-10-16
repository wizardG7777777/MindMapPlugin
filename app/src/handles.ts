import type { FileHandle } from './file-session.ts';
import { capabilityStore, type CapabilityRecords } from './capability-store.ts';

// Only capabilities are persisted. No graph contents, drafts, view, or undo history.
const DATABASE = 'mindmap-file-capabilities-v1';
// Namespace restoration by the entry page, not by the currently selected file's name.
// Opening another HTML page in this tab must not inherit an unrelated file selection.
const SESSION_KEY = `mindmap-file-session-v1:${location.href.split('#')[0]}`;
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function change(action: (store: IDBObjectStore) => void): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      action(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function get(key: string): Promise<FileHandle | undefined> {
  const db = await database();
  try {
    return await new Promise<FileHandle | undefined>((resolve, reject) => {
      const request = db.transaction('handles').objectStore('handles').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
const records: CapabilityRecords<FileHandle> = {
  get,
  put: (key, handle) => change(store => { store.put(handle, key); }),
  remove: key => change(store => { store.delete(key); }),
};
const store = capabilityStore(records, {
  get: () => sessionStorage.getItem(SESSION_KEY),
  set: key => sessionStorage.setItem(SESSION_KEY, key),
}, () => crypto.randomUUID());
export const prepareHandle = store.prepare;
export const recall = store.recall;
