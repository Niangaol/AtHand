import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { applyCommand, commandKey, commandSchema, createPlannerState, plannerSchema, idSchema } from '../src/domain/planner.ts';

const requestSchema = z.object({ operationId: idSchema, baseRevision: z.number().int().nonnegative(), command: commandSchema }).strict();
const resultSchema = z.object({ state: plannerSchema, revision: z.number().int().nonnegative(), serverId: idSchema, entityVersions: z.record(z.string(), z.number().int().nonnegative()) }).strict();
const fileSchema = resultSchema.extend({ receipts: z.array(z.object({ id: idSchema, hash: z.string(), revision: z.number().int().positive() }).strict()).max(100000) });
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export function createPlannerStore(directory) {
  const file = path.join(directory, 'planner.json');
  function write(value) {
    fileSchema.parse(value);
    fs.mkdirSync(directory, { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  function readFile() { return fileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  try { readFile(); } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('planner_storage_corrupt', { cause: error });
    write({ state: createPlannerState(), revision: 0, serverId: crypto.randomUUID(), entityVersions: {}, receipts: [] });
  }
  function publicDoc(doc) {
    return { state: doc.state, revision: doc.revision, serverId: doc.serverId, entityVersions: doc.entityVersions };
  }
  return {
    read: () => publicDoc(readFile()),
    execute(input) {
      const op = requestSchema.parse(input);
      const current = readFile();
      const hash = crypto.createHash('sha256').update(JSON.stringify(canonical(op.command))).digest('hex');
      const previous = current.receipts.find((r) => r.id === op.operationId);
      if (previous) {
        if (previous.hash !== hash) throw new Error('operation_reused');
        return { ...publicDoc(current), appliedRevision: previous.revision };
      }
      if (current.revision !== op.baseRevision) throw new Error('conflict');
      const state = applyCommand(current.state, op.command, Date.now());
      const revision = current.revision + 1;
      const next = { ...current, state, revision,
        entityVersions: { ...current.entityVersions, [commandKey(op.command)]: revision },
        receipts: [...current.receipts, { id: op.operationId, hash, revision }],
      };
      write(next);
      return { ...publicDoc(next), appliedRevision: revision };
    },
  };
}
