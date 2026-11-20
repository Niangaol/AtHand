import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RecordsProvider, useRecords } from './RecordsProvider';
import { createInitialState, STORAGE_KEY } from './storage';
import type { RecordDraft } from '../domain/ledger';

const draft: RecordDraft = { type: 'work', date: '2026-11-20', title: '真实排班', workplaceId: 'tea', startTime: '14:00', endTime: '17:00', nextDay: false, duration: '', hourlyRate: '20', amount: '', category: '吃饭' };
beforeEach(() => localStorage.clear());
const wrapper = ({ children }: { children: ReactNode }) => <RecordsProvider today="2026-11-20">{children}</RecordsProvider>;

describe('real ledger operations', () => {
  it('serializes a save racing inside another tab’s read before either write completes', async () => {
    let raw: string | null = null;
    let onRead: (() => void) | null = null;
    const storage = {
      getItem: () => { const snapshot = raw; const callback = onRead; onRead = null; callback?.(); return snapshot; },
      setItem: (_key: string, value: string) => { raw = value; },
    };
    const customWrapper = ({ children }: { children: ReactNode }) => <RecordsProvider today="2026-11-20" storage={storage}>{children}</RecordsProvider>;
    const first = renderHook(useRecords, { wrapper: customWrapper });
    const second = renderHook(useRecords, { wrapper: customWrapper });
    let secondSave: Promise<{ ok: boolean }> | undefined;
    await act(async () => {
      onRead = () => { secondSave = second.result.current.saveRecord({ ...draft, title: 'second' }); };
      expect((await first.result.current.saveRecord({ ...draft, title: 'first' })).ok).toBe(true);
      expect((await secondSave)!.ok).toBe(false);
    });
    expect(JSON.parse(raw!).records.map((record: { title: string }) => record.title)).toEqual(['first']);
  });
  it('replaces demo records on first save and persists editing and deletion', async () => {
    const { result } = renderHook(useRecords, { wrapper });
    await act(async () => { expect((await result.current.saveRecord(draft)).ok).toBe(true); });
    expect(result.current.records).toHaveLength(1);
    const id = result.current.records[0].id;
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).records[0].title).toBe('真实排班');
    await act(async () => { await result.current.saveRecord({ ...draft, hourlyRate: '30' }, id); });
    expect(result.current.records[0].amountCents).toBe(9000);
    await act(async () => { await result.current.deleteRecord(id); });
    expect(result.current.records).toHaveLength(0);
  });
  it('retains historic pay after a unit rate change and blocks deleting a referenced unit', async () => {
    const { result } = renderHook(useRecords, { wrapper });
    await act(async () => { await result.current.saveRecord(draft); });
    await act(async () => { await result.current.saveWorkplace('新奶茶店', '30', 'tea'); });
    expect(result.current.records[0].amountCents).toBe(6000);
    await act(async () => { expect((await result.current.deleteWorkplace('tea')).ok).toBe(false); });
    expect(result.current.workplaces.some((unit) => unit.id === 'tea')).toBe(true);
  });
  it('clears only examples and retains real records and referenced units', async () => {
    const { result } = renderHook(useRecords, { wrapper });
    await act(async () => { await result.current.saveRecord(draft); });
    await act(async () => { await result.current.clearExamples(); });
    expect(result.current.records[0].title).toBe('真实排班');
    expect(result.current.workplaces.map((unit) => unit.id)).toEqual(['tea']);
  });
  it('does not change state after a failed disk write', async () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const { result } = renderHook(useRecords, { wrapper: ({ children }) => <RecordsProvider today="2026-11-20" storage={storage}>{children}</RecordsProvider> });
    await act(async () => { expect((await result.current.saveRecord(draft)).ok).toBe(false); });
    expect(result.current.records.some((record) => record.source === 'manual')).toBe(false);
    expect(result.current.error).toContain('保存失败');
  });
  it('blocks writes on corrupt state until an explicit reset', async () => {
    localStorage.setItem(STORAGE_KEY, 'unreadable');
    const { result } = renderHook(useRecords, { wrapper });
    await act(async () => { expect((await result.current.saveWorkplace('家教', '80')).ok).toBe(false); });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('unreadable');
    await act(async () => { expect((await result.current.resetLedger()).ok).toBe(true); });
    expect(result.current.error).toBe('');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(createInitialState('2026-11-20', false));
  });
});
