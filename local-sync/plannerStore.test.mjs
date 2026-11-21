import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlannerStore } from './plannerStore.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-planner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createPlannerStore(dir) };
}
const command = { kind: 'put', collection: 'countdowns', value: { id: 'a', title: '证件', date: '2026-12-01', kind: 'document' } };

test('atomically persists revision and deduplicates a lost response across restart', (t) => {
  const { dir, store } = fixture(t);
  const op = { operationId: 'op-a', baseRevision: 0, command };
  const first = store.execute(op);
  assert.equal(first.revision, 1);
  const restarted = createPlannerStore(dir);
  assert.deepEqual(restarted.execute(op), first);
  assert.equal(restarted.read().state.countdowns.length, 1);
  assert.throws(() => restarted.execute({ ...op, command: { ...command, value: { ...command.value, title: 'different' } } }), /operation_reused/);
});
test('CAS detects stale writes including deleted entities', (t) => {
  const { store } = fixture(t);
  store.execute({ operationId: 'a', baseRevision: 0, command });
  assert.throws(() => store.execute({ operationId: 'b', baseRevision: 0, command }), /conflict/);
  store.execute({ operationId: 'c', baseRevision: 1, command: { kind: 'delete', collection: 'countdowns', id: 'a' } });
  assert.equal(store.read().entityVersions['countdowns:a'], 2);
});
test('bad schema cannot modify disk and corrupt files are never replaced', (t) => {
  const { dir, store } = fixture(t);
  const before = fs.readFileSync(path.join(dir, 'planner.json'), 'utf8');
  assert.throws(() => store.execute({ operationId: 'a', baseRevision: 0, command: { ...command, value: { id: 'bad' } } }));
  assert.equal(fs.readFileSync(path.join(dir, 'planner.json'), 'utf8'), before);
  fs.writeFileSync(path.join(dir, 'planner.json'), '{broken');
  assert.throws(() => createPlannerStore(dir));
  assert.equal(fs.readFileSync(path.join(dir, 'planner.json'), 'utf8'), '{broken');
});
test('one active focus and epoch reject a previous device after takeover', (t) => {
  const { store } = fixture(t);
  store.execute({ operationId: 'a', baseRevision: 0, command: { kind: 'focus.start', id: 'focus', task: '数学', minutes: 25, owner: 'a' } });
  assert.throws(() => store.execute({ operationId: 'b', baseRevision: 1, command: { kind: 'focus.start', id: 'other', task: '阅读', minutes: 25, owner: 'b' } }));
  store.execute({ operationId: 'c', baseRevision: 1, command: { kind: 'focus.control', id: 'focus', action: 'takeover', owner: 'b', epoch: 1 } });
  assert.throws(() => store.execute({ operationId: 'd', baseRevision: 2, command: { kind: 'focus.control', id: 'focus', action: 'pause', owner: 'a', epoch: 1 } }));
});
