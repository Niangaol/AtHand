import { describe, expect, it } from 'vitest';
import { syncPlanner } from './plannerSync';
import { emptyEnvelope, enqueue, projectedState } from './plannerStorage';
import type { PlannerEnvelope, RemoteDocument } from './plannerStorage';
import { applyCommand, commandKey, createPlannerState } from '../domain/planner';
import type { PlannerCommand } from '../domain/planner';

const at = Date.parse('2026-11-21T10:00:00+08:00');
const command: PlannerCommand = { kind: 'put', collection: 'countdowns', value: { id: 'a', title: '证件', date: '2026-12-01', kind: 'document' } };
function remote() {
  let doc: RemoteDocument = { state: createPlannerState(), revision: 0, serverId: 'server-a', entityVersions: {} };
  const receipts = new Map<string, number>();
  const port = { read: async () => structuredClone(doc), send: async (op: { operationId: string; baseRevision: number; command: PlannerCommand }) => {
    if (receipts.has(op.operationId)) return { ...structuredClone(doc), appliedRevision: receipts.get(op.operationId)! };
    if (doc.revision !== op.baseRevision) throw Object.assign(new Error('conflict'), { code: 'conflict' });
    doc = { ...doc, state: applyCommand(doc.state, op.command, at), revision: doc.revision + 1, entityVersions: { ...doc.entityVersions, [commandKey(op.command)]: doc.revision + 1 } };
    receipts.set(op.operationId, doc.revision);
    return { ...structuredClone(doc), appliedRevision: doc.revision };
  } };
  return { port, get: () => doc };
}
describe('planner reconciliation', () => {
  it('persists before transmission and recovers a lost response without duplication', async () => {
    const server = remote();
    let saved = enqueue(emptyEnvelope(), command, at, 'one');
    let lose = true;
    const transport = { ...server.port, send: async (op: Parameters<typeof server.port.send>[0]) => {
      expect(saved.pending[0].sentRevision).not.toBeNull();
      const result = await server.port.send(op);
      if (lose) { lose = false; throw new Error('offline'); }
      return result;
    } };
    await expect(syncPlanner(saved, 'http://localhost:1', transport, (v) => { saved = v; })).rejects.toThrow('offline');
    expect(saved.pending).toHaveLength(1);
    saved = await syncPlanner(JSON.parse(JSON.stringify(saved)), 'http://localhost:1', transport, (v) => { saved = v; });
    expect(saved.pending).toHaveLength(0);
    expect(server.get().state.countdowns).toHaveLength(1);
  });
  it('rebases different entities but keeps same-entity changes for user resolution', async () => {
    const server = remote();
    let first = await syncPlanner(emptyEnvelope(), 'http://localhost:1', server.port, () => {});
    const local = enqueue(first, command, at, 'local');
    await server.port.send({ operationId: 'remote', baseRevision: 0, command: { ...command, value: { ...command.value as object, title: '服务器修改' } } });
    await expect(syncPlanner(local, 'http://localhost:1', server.port, () => {})).rejects.toThrow('冲突');
    const other = enqueue(first, { ...command, value: { ...command.value as object, id: 'b' } }, at, 'other');
    first = await syncPlanner(other, 'http://localhost:1', server.port, () => {});
    expect(projectedState(first).countdowns).toHaveLength(2);
  });
  it('refuses to silently move pending data between servers', async () => {
    const server = remote();
    const bound: PlannerEnvelope = { ...emptyEnvelope(), serverId: 'elsewhere', serverUrl: 'https://old.example' };
    await expect(syncPlanner(bound, 'http://localhost:1', server.port, () => {})).rejects.toThrow('服务器');
  });
});
