import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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
