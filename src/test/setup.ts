import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('shunshou-write-guards', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('documents', 'readwrite');
      transaction.objectStore('documents').clear();
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
});

afterEach(cleanup);

HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

let lockQueue = Promise.resolve<unknown>(undefined);
Object.defineProperty(navigator, 'locks', { configurable: true, value: {
  request: (_name: string, callback: () => unknown) => {
    const task = lockQueue.then(callback);
    lockQueue = task.catch(() => undefined);
    return task;
  },
} });
