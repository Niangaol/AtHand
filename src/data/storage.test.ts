import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialState, loadLedger, saveLedger, STORAGE_KEY } from './storage';

beforeEach(() => localStorage.clear());

describe('versioned local ledger', () => {
  it('loads examples only when no saved state exists', () => {
    const loaded = loadLedger(localStorage, '2026-11-20');
    expect(loaded.state.records.length).toBeGreaterThan(0);
    const empty = { ...loaded.state, records: [], workplaces: [] };
    saveLedger(localStorage, empty, null);
    expect(loadLedger(localStorage, '2026-11-20').state.records).toEqual([]);
  });
  it('round trips work, expenses, units and settings', () => {
    const state = createInitialState('2026-11-20');
    saveLedger(localStorage, state, null);
    expect(loadLedger(localStorage, '2026-11-20').state).toEqual(state);
  });
  it.each(['broken JSON', '{"version":99}', '{"version":1,"records":[]}'])('preserves unreadable data instead of overwriting %s', (raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    const loaded = loadLedger(localStorage, '2026-11-20');
    expect(loaded.error).toBeTruthy();
    expect(loaded.state.records).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it('rejects malformed persisted money or date fields', () => {
    const state = createInitialState('2026-11-20');
    state.records[0].amountCents = -1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    expect(loadLedger(localStorage, '2026-11-20').error).toBeTruthy();
  });
  it('does not overwrite a change made by another tab', () => {
    localStorage.setItem(STORAGE_KEY, 'other-tab-data');
    expect(() => saveLedger(localStorage, createInitialState('2026-11-20'), null)).toThrow('其他窗口');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('other-tab-data');
  });
  it('reports quota failure instead of returning success', () => {
    const storage = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    expect(() => saveLedger(storage, createInitialState('2026-11-20'), null)).toThrow('保存失败');
  });
});
