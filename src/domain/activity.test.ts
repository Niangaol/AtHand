import { describe, expect, it } from 'vitest';
import { mergeActivity } from './activity.ts';
import type { FocusSession } from './focus.ts';
import type { RecordEntry } from './records.ts';

const today = '2026-11-22';
const at = (hour: number, minute = 0) => new Date(2026, 10, 22, hour, minute).getTime();

function focusSession(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'focus-1', task: '复习', minutes: 25, startedAt: at(9), status: 'completed',
    segments: [{ start: at(9), end: at(9) + 25 * 60_000 }], owner: 'me', epoch: 1, ...overrides,
  };
}

const expense: RecordEntry = { id: 'record-1', date: today, title: '午饭', amountCents: 1850, source: 'manual', type: 'expense', category: '吃饭' };

describe('mergeActivity', () => {
  it('merges computer operations, focus sessions and ledger entries newest first', () => {
    const items = mergeActivity({
      today,
      assistant: [{ id: 'audit-1', at: at(11), title: '查看当天安排', detail: '今天有一项安排', ok: true }],
      focusSessions: [focusSession()],
      records: [expense],
    });

    expect(items.map((item) => item.title)).toEqual(['查看当天安排', '专注完成', '记支出']);
    expect(items[1]).toMatchObject({ source: 'focus', at: at(9) + 25 * 60_000, detail: '复习 · 25 分钟' });
    expect(items[2]).toMatchObject({ source: 'ledger', at: null, detail: '午饭 · ¥18.50' });
  });

  it('keeps only entries from the given day', () => {
    const items = mergeActivity({
      today,
      assistant: [{ id: 'audit-old', at: at(20) - 86_400_000, title: '旧操作', detail: '', ok: true }],
      focusSessions: [focusSession({ startedAt: at(9) - 86_400_000, segments: [{ start: at(9) - 86_400_000, end: at(9) - 86_400_000 + 25 * 60_000 }] })],
      records: [{ ...expense, id: 'old', date: '2026-11-21' }],
    });

    expect(items).toEqual([]);
  });

  it('puts untimed ledger entries after timed actions and caps the list', () => {
    const assistant = Array.from({ length: 10 }, (_, index) => ({
      id: `audit-${index}`,
      at: at(8) + index * 60_000,
      title: `操作 ${index}`,
      detail: '',
      ok: true,
    }));
    const items = mergeActivity({ today, assistant, focusSessions: [], records: [expense] });

    expect(items).toHaveLength(8);
    expect(items.every((item) => item.source === 'assistant')).toBe(true);
    expect(items[0].title).toBe('操作 9');
  });

  it('describes running and cancelled focus sessions without inventing an end time', () => {
    const running = focusSession({ id: 'running', status: 'running', segments: [{ start: at(9), end: null }] });
    const cancelled = focusSession({ id: 'cancelled', status: 'cancelled', segments: [{ start: at(8), end: at(8) + 5 * 60_000 }] });

    const items = mergeActivity({ today, assistant: [], focusSessions: [running, cancelled], records: [] });

    expect(items.find((item) => item.id === 'focus:running')).toMatchObject({ title: '正在专注', at: at(9) });
    expect(items.find((item) => item.id === 'focus:cancelled')).toMatchObject({ title: '结束专注', at: at(8) + 5 * 60_000 });
  });
});
