import { toDateKey } from './dates.ts';
import { money } from './summary.ts';
import type { FocusSession } from './focus.ts';
import type { RecordEntry } from './records.ts';

export type ActivitySource = 'assistant' | 'focus' | 'ledger';
export type ActivityInput = { id: string; at: number; title: string; detail: string; ok?: boolean };
export type ActivityItem = Omit<ActivityInput, 'at'> & { source: ActivitySource; at: number | null };

const sameDay = (stamp: number, day: string) => Number.isFinite(stamp) && toDateKey(new Date(stamp)) === day;

function focusItem(session: FocusSession): ActivityItem {
  const lastEnd = session.segments.reduce<number | null>((end, segment) => segment.end ?? end, null);
  const ended = session.status === 'completed' || session.status === 'cancelled';
  const title = session.status === 'completed' ? '专注完成'
    : session.status === 'cancelled' ? '结束专注'
      : session.status === 'paused' ? '暂停专注' : '正在专注';
  return {
    id: `focus:${session.id}`,
    source: 'focus',
    at: ended ? (lastEnd ?? session.startedAt) : session.startedAt,
    title,
    detail: `${session.task} · ${session.minutes} 分钟`,
  };
}

function recordItem(record: RecordEntry): ActivityItem {
  return record.type === 'expense'
    ? { id: `record:${record.id}`, source: 'ledger', at: null, title: '记支出', detail: `${record.title} · ¥${money(record.amountCents)}` }
    : { id: `record:${record.id}`, source: 'ledger', at: null, title: '记工时', detail: `${record.title} · ${record.durationMinutes} 分钟` };
}

export function mergeActivity({ today, assistant, focusSessions, records, limit = 8 }: {
  today: string;
  assistant: ActivityInput[];
  focusSessions: FocusSession[];
  records: RecordEntry[];
  limit?: number;
}): ActivityItem[] {
  const items: ActivityItem[] = [
    ...assistant.filter((item) => sameDay(item.at, today)).map((item) => ({ ...item, source: 'assistant' as const })),
    ...focusSessions.filter((session) => sameDay(session.startedAt, today)).map(focusItem),
    ...records.filter((record) => record.date === today).map(recordItem),
  ];
  items.sort((left, right) => {
    if (left.at === null && right.at === null) return 0;
    if (left.at === null) return 1;
    if (right.at === null) return -1;
    return right.at - left.at;
  });
  return items.slice(0, limit);
}
