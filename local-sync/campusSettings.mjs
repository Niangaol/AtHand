import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = 'campus.json';

export function createCampusSettings(directory) {
  const file = path.join(directory, FILE);
  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { personalEnabled: value?.personalEnabled === true };
    } catch {
      return { personalEnabled: false };
    }
  }
  function update(patch) {
    const current = read();
    const next = { version: 1, personalEnabled: typeof patch?.personalEnabled === 'boolean' ? patch.personalEnabled : current.personalEnabled };
    fs.mkdirSync(directory, { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return next;
  }
  return { read, update };
}
