import { beforeEach, describe, expect, it } from 'vitest';
import { loadPlanner, savePlanner, emptyEnvelope, PLANNER_KEY, enqueue, projectedState } from './plannerStorage';

beforeEach(() => localStorage.clear());
const now = Date.parse('2026-11-21T10:00:00+08:00');
describe('planner storage and persistent outbox', () => {
  it('does not touch the old ledger and preserves pending changes over reload', () => {
    localStorage.setItem('shunshou.ledger.v1', 'keep existing ledger');
    const first = loadPlanner(localStorage);
    const next = enqueue(first.envelope, { kind: 'put', collection: 'countdowns', value: { id: 'a', title: '证件', date: '2026-12-01', kind: 'document' } }, now, 'op-a');
    savePlanner(localStorage, next, first.raw);
    expect(projectedState(loadPlanner(localStorage).envelope).countdowns[0].title).toBe('证件');
    expect(loadPlanner(localStorage).envelope.pending[0].operationId).toBe('op-a');
    expect(localStorage.getItem('shunshou.ledger.v1')).toBe('keep existing ledger');
  });
  it('does not display an unconfirmed server timer as already running', () => {
    const initial = { ...emptyEnvelope(), serverId: 'server-a', serverUrl: 'https://example.invalid' };
    const next = enqueue(initial, { kind: 'focus.start', id: 'one', task: '数学', minutes: 25, owner: 'a' }, now, 'op-a');
    expect(projectedState(next).focusSessions).toHaveLength(0);
    expect(next.pending).toHaveLength(1);
  });
  it('preserves corrupt data and refuses stale window writes', () => {
    localStorage.setItem(PLANNER_KEY, '{broken');
    const broken = loadPlanner(localStorage);
    expect(broken.error).not.toBe('');
    expect(broken.raw).toBe('{broken');
    expect(localStorage.getItem(PLANNER_KEY)).toBe('{broken');
    localStorage.clear();
    savePlanner(localStorage, emptyEnvelope(), null);
    expect(() => savePlanner(localStorage, emptyEnvelope(), null)).toThrow();
  });
  it('does not overwrite storage on quota or validation failure', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(() => savePlanner(storage, emptyEnvelope(), null)).toThrow();
    expect(() => savePlanner(localStorage, { ...emptyEnvelope(), base: { version: 99 } } as never, null)).toThrow();
    expect(localStorage.getItem(PLANNER_KEY)).toBe(null);
  });
});
