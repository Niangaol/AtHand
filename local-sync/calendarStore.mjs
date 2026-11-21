import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { calendarSnapshotSchema, calendarUploadSchema, reconcileCalendar } from '../src/domain/calendar.ts';

const schema = z.object({ sources: z.array(calendarSnapshotSchema).max(30), receipts: z.array(z.object({ sourceId: z.string(), requestId: z.string(), hash: z.string(), revision: z.number() }).strict()).max(100000) }).strict();
export function createCalendarStore(directory) {
  const file = path.join(directory, 'calendar.json');
  function write(doc) {
    schema.parse(doc);
    fs.mkdirSync(directory, { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(doc)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  function read() { return schema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  try { read(); } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('calendar_storage_corrupt', { cause: error });
    write({ sources: [], receipts: [] });
  }
  return {
    read: () => read().sources,
    upload(input) {
      const upload = calendarUploadSchema.parse(input);
      const doc = read();
      const hash = crypto.createHash('sha256').update(JSON.stringify(upload)).digest('hex');
      const receipt = doc.receipts.find((r) => r.sourceId === upload.sourceId && r.requestId === upload.requestId);
      const previous = doc.sources.find((source) => source.sourceId === upload.sourceId) ?? null;
      if (receipt) {
        if (receipt.hash !== hash) throw new Error('operation_reused');
        return previous;
      }
      const snapshot = reconcileCalendar(previous, upload);
      write({ sources: [...doc.sources.filter((s) => s.sourceId !== upload.sourceId), snapshot], receipts: [...doc.receipts, { sourceId: upload.sourceId, requestId: upload.requestId, hash, revision: snapshot.revision }] });
      return snapshot;
    },
  };
}
