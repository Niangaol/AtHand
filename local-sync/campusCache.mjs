import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = 'campus-cache.json';

/**
 * 公共校园数据落盘；个人数据只驻内存，断开或关闭开关时清空。
 * 磁盘文件永远只包含 personal=false 的条目。
 */
export function createCampusCache({ directory, now = Date.now, maxEntries = 60 }) {
  const file = path.join(directory, FILE);
  const memory = new Map();
  let diskLoaded = false;

  function loadDisk() {
    if (diskLoaded) return;
    diskLoaded = true;
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      const entries = value?.entries;
      if (!entries || typeof entries !== 'object') return;
      for (const [key, entry] of Object.entries(entries)) {
        if (!entry || typeof entry !== 'object' || entry.personal === true) continue;
        if (!Number.isFinite(entry.at) || !entry.envelope || typeof entry.envelope !== 'object') continue;
        memory.set(key, { at: entry.at, personal: false, envelope: entry.envelope });
      }
    } catch { /* 文件不存在或损坏时从空缓存开始。 */ }
  }

  function persist() {
    fs.mkdirSync(directory, { recursive: true });
    const entries = {};
    for (const [key, entry] of memory) {
      if (entry.personal) continue;
      entries[key] = { at: entry.at, personal: false, envelope: entry.envelope };
    }
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }

  function trim() {
    if (memory.size <= maxEntries) return;
    const ordered = [...memory.entries()].sort((left, right) => left[1].at - right[1].at);
    let publicRemoved = false;
    for (const [key, entry] of ordered.slice(0, memory.size - maxEntries)) {
      memory.delete(key);
      if (!entry.personal) publicRemoved = true;
    }
    if (publicRemoved) persist();
  }

  return {
    read(key) {
      loadDisk();
      const entry = memory.get(key);
      return entry ? { at: entry.at, envelope: entry.envelope } : null;
    },
    write(key, envelope, { personal = false } = {}) {
      loadDisk();
      memory.set(key, { at: now(), personal, envelope });
      trim();
      if (!personal) persist();
    },
    clearPersonal() {
      loadDisk();
      let changed = false;
      for (const [key, entry] of memory) {
        if (entry.personal) { memory.delete(key); changed = true; }
      }
      if (changed) persist();
    },
  };
}
