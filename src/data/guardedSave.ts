let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('shunshou-write-guards', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('无法打开并发保存校验，请检查浏览器存储设置。')); };
  });
  return database;
}

export async function readGuardedRaw(key: string): Promise<string | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents', 'readonly').objectStore('documents').get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(new Error('无法读取来源存档，未切换记录。'));
  });
}

export async function guardedSave(key: string, expectedRaw: string | null, write: () => string, recovery = false): Promise<string> {
  const db = await openDatabase();
  return new Promise<string>((resolve, reject) => {
    const transaction = db.transaction('documents', 'readwrite');
    const store = transaction.objectStore('documents');
    const request = store.get(key);
    let written: string | undefined;
    let error: Error | undefined;
    request.onsuccess = () => {
      try {
        // Chromium的localStorage跨进程缓存可能晚于Web Lock放行，事务内的副本用于校验。
        if (!recovery && request.result !== undefined && request.result !== expectedRaw) throw new Error('其他窗口已更新记录，请刷新后重试；当前草稿尚未保存。');
        written = write();
        store.put(written, key);
      } catch (reason) { error = reason instanceof Error ? reason : new Error('保存失败'); transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(written!);
    transaction.onabort = () => {
      if (written !== undefined) {
        try {
          if (localStorage.getItem(key) === written) {
            if (expectedRaw === null) localStorage.removeItem(key); else localStorage.setItem(key, expectedRaw);
          }
        } catch { error = new Error('保存校验失败，恢复旧缓存也失败；请保留备份并停止编辑。'); }
      }
      reject(error ?? new Error('并发保存校验失败，未确认保存。'));
    };
    transaction.onerror = () => {};
  });
}
