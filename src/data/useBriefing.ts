import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlannerState } from '../domain/planner.ts';
import type { RecordEntry } from '../domain/records.ts';
import type { CalendarSource } from '../domain/schedule.ts';
import { buildDayBrief, buildWeekReview, dayBriefNarrative, weekReviewNarrative } from '../domain/insights.ts';
import type { DayBrief, WeekReview } from '../domain/insights.ts';
import { isGatewayConnected } from './gateway';
import { fetchBriefing } from './briefing';
import type { BriefingScope } from './briefing';

type Input = { scope: BriefingScope; state: PlannerState; records: readonly RecordEntry[]; calendars: CalendarSource[]; today: string };

type BriefingView<Facts> = {
  facts: Facts;
  narrative: string;
  degraded: boolean;
  warning: string | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

export function useBriefing(input: Input & { scope: 'day' }): BriefingView<DayBrief>;
export function useBriefing(input: Input & { scope: 'week' }): BriefingView<WeekReview>;
export function useBriefing({ scope, state, records, calendars, today }: Input): BriefingView<DayBrief | WeekReview> {
  const local = useMemo(() => {
    if (scope === 'day') {
      const facts = buildDayBrief(state, records, calendars, today);
      return { facts, narrative: dayBriefNarrative(facts) };
    }
    const facts = buildWeekReview(state, records, calendars, today);
    return { facts, narrative: weekReviewNarrative(facts) };
  }, [scope, state, records, calendars, today]);
  const [remote, setRemote] = useState<{ narrative: string; degraded: boolean; warning: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(0);

  const load = useCallback(async (fresh = false): Promise<void> => {
    const ticket = ++active.current;
    if (!isGatewayConnected()) {
      setRemote(null);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const value = await fetchBriefing(scope, { fresh });
      if (active.current !== ticket) return;
      setRemote({ narrative: value.narrative, degraded: value.degraded, warning: value.warning });
    } catch (reason) {
      if (active.current !== ticket) return;
      setError(reason instanceof Error ? reason.message : '简报没有拉取成功。');
    } finally {
      if (active.current === ticket) setLoading(false);
    }
  }, [scope]);

  useEffect(() => { void load(false); }, [load]);

  return {
    facts: local.facts,
    narrative: remote?.narrative ?? local.narrative,
    degraded: remote ? remote.degraded : true,
    warning: remote?.warning ?? null,
    loading,
    error,
    refresh: () => load(true),
  };
}
