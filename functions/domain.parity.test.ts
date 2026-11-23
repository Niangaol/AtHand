import { describe, expect, it } from 'vitest';
import * as src from '../src/domain/insights.ts';
import { summarize as srcSummarize } from '../src/domain/summary.ts';
import * as bundled from './vendor/domain.mjs';
import { createInitialState } from '../src/data/storage.ts';

const today = '2026-11-23';
const now = new Date(`${today}T12:00:00`).getTime();

describe('domain bundle parity', () => {
  it('exports the same public surface', () => {
    for (const name of ['buildDayBrief', 'buildWeekReview', 'buildTimeline', 'getCountdowns', 'summarize', 'buildRecord', 'isLedgerState', 'applyCommand']) {
      expect(typeof (bundled as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('buildDayBrief matches source on empty state', () => {
    const state = bundled.createPlannerState();
    expect(bundled.buildDayBrief(state, [], [], today, now)).toEqual(src.buildDayBrief(state, [], [], today, now));
  });

  it('buildWeekReview matches source with sample ledger', () => {
    const ledger = createInitialState(today, true);
    const state = bundled.createPlannerState();
    expect(bundled.buildWeekReview(state, ledger.records, [], today, now))
      .toEqual(src.buildWeekReview(state, ledger.records, [], today, now));
  });

  it('summarize matches source', () => {
    const ledger = createInitialState(today, true);
    expect(bundled.summarize(ledger.records, today, today)).toEqual(srcSummarize(ledger.records, today, today));
  });
});
