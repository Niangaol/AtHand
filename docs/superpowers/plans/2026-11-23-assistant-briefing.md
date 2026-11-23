# 内置助手简报与洞察 一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让顺手在首页和「今天」页主动产出今日简报与本周复盘，并给内置助手和外部 Agent 增加 4 个只读洞察工具；模型只润色，不可用时降级规则文案。

**Architecture:** 四个确定性纯函数放在 `src/domain/insights.ts`，前端与网关共用。网关新增 4 个只读工具和 `GET /api/assistant/briefing`，由 `assistant.mjs` 调模型润色。前端首帧本地算 facts + 模板文案，连上电脑后异步替换为模型版本。

**Tech Stack:** React 19 + Vite + Zod 4 + vitest；网关是零依赖 Node 24（`node --test`）；E2E 用 Playwright。

**Spec:** `docs/superpowers/specs/2026-11-23-assistant-briefing-design.md`

## Execution order

Task 1 → 2 → 3 → 4 → 5（领域层，严格顺序，后一个依赖前一个的类型）→ 6（网关工具）→ 7（briefing 端点）→ 8（前端拉取）→ 9、10、11（UI 与文档，可并行）。

## Global Constraints

- 不引入任何新依赖。
- 所有计算用确定性代码，模型不参与算术。
- 洞察计算排除 `record.source === 'demo'` 的记录。
- 金额内部用分（amountCents），展示用 `money()` 或 `/100`。
- 日期键 `YYYY-MM-DD`；时间区间用 epoch 毫秒；周一开始。
- 中文文案，语气平稳克制；金额格式 `¥18.50`。
- 网关测试用 `node --test local-sync/*.test.mjs`；前端测试 `npx vitest run`。
- 提交信息用中文，`feat:` / `test:` / `docs:` 前缀。

## File Structure

新增：

- `src/domain/insights.ts` — 4 个纯函数 + 2 个模板文案函数
- `src/domain/insights.test.ts`
- `src/data/briefing.ts` — 客户端拉取与 zod 校验
- `src/data/briefing.test.ts`
- `src/data/useBriefing.ts` — React hook
- `local-sync/assistantBriefing.test.mjs`

修改：

- `local-sync/agentApi.mjs` — 4 个工具
- `local-sync/assistant.mjs` — `briefing()` + 缓存
- `local-sync/server.mjs` — 路由 + `getBriefFacts`
- `src/features/home/HomePage.tsx` — 今日简报卡
- `src/features/overview/OverviewPage.tsx` — 本周复盘面板
- `src/features/assistant/AssistantPage.tsx` — 两条快捷提示
- `src/styles.css`
- `docs/agent-api.md`
- `e2e/home.spec.ts`

---

### Task 1: 领域层今日简报 buildDayBrief

**Files:**
- Create: `src/domain/insights.ts`
- Test: `src/domain/insights.test.ts`

**Interfaces:**
- Consumes: `PlannerState`、`RecordEntry`、`CalendarSource`、`buildTimeline`、`getCountdowns`、`summarize`、`focusedSecondsBetween`、`scheduleWarnings`
- Produces: `export type DayBrief`、`export function buildDayBrief(state, records, calendars, today, now?)`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createPlannerState } from './planner';
import { buildEvent } from './schedule';
import { buildDayBrief } from './insights';
import type { RecordEntry } from './records';

const at = (time: string) => new Date(`${time}+08:00`).getTime();

function record(overrides: Partial<RecordEntry>): RecordEntry {
  return { id: 'r1', date: '2026-11-23', title: '午饭', amountCents: 1850, source: 'manual', type: 'expense', category: '吃饭', ...overrides } as RecordEntry;
}

describe('buildDayBrief', () => {
  it('summarizes the day, skips demo records, and finds the next item', () => {
    const state = createPlannerState();
    state.events.push(buildEvent({ id: 'e1', kind: 'course', title: '高等数学', location: 'A101', start: '2026-11-23T09:00', end: '2026-11-23T11:00', allDay: false, timeZone: 'Asia/Shanghai' }));
    state.events.push(buildEvent({ id: 'e2', kind: 'exam', title: '线代考试', location: '', start: '2026-11-25T14:00', end: '2026-11-25T16:00', allDay: false, timeZone: 'Asia/Shanghai' }));
    const records = [record({}), record({ id: 'r2', amountCents: 99900, source: 'demo' })];
    const facts = buildDayBrief(state, records, [], '2026-11-23', at('2026-11-23T08:00'));
    expect(facts.date).toBe('2026-11-23');
    expect(facts.items.map((item) => item.title)).toEqual(['高等数学']);
    expect(facts.next?.title).toBe('高等数学');
    expect(facts.expenseCents).toBe(1850);
    expect(facts.countdowns.map((item) => item.title)).toEqual(['线代考试']);
    expect(facts.countdowns[0]).toMatchObject({ days: 2 });
  });

  it('returns empty-day shape with next null after the last item', () => {
    const facts = buildDayBrief(createPlannerState(), [], [], '2026-11-23', at('2026-11-23T23:00'));
    expect(facts).toMatchObject({ date: '2026-11-23', items: [], next: null, expenseCents: 0, focusMinutes: 0, activeFocus: null });
    expect(facts.warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/insights.test.ts`
Expected: FAIL — `Failed to resolve import "./insights"`

- [ ] **Step 3: Write minimal implementation**

```ts
import type { PlannerState } from './planner.ts';
import type { RecordEntry } from './records.ts';
import { buildTimeline, scheduleWarnings, type CalendarSource } from './schedule.ts';
import { getCountdowns } from './countdowns.ts';
import { focusedSecondsBetween, remainingSeconds, type FocusSession } from './focus.ts';
import { summarize } from './summary.ts';
import { getWeekRange, shiftDate } from './dates.ts';

export type DayBrief = {
  date: string;
  items: { title: string; start: number; end: number; kind: string; location: string; source: string }[];
  next: { title: string; start: number; kind: string } | null;
  countdowns: { title: string; date: string; days: number; kind: string }[];
  expenseCents: number;
  workMinutes: number;
  focusMinutes: number;
  activeFocus: { task: string; remainingMinutes: number } | null;
  warnings: string[];
};

const dayBounds = (date: string) => ({
  start: new Date(`${date}T00:00:00`).getTime(),
  end: new Date(`${shiftDate(date, 1)}T00:00:00`).getTime(),
});

function realRecords(records: readonly RecordEntry[]): readonly RecordEntry[] {
  return records.filter((item) => item.source !== 'demo');
}

function active(state: PlannerState): FocusSession | null {
  return state.focusSessions.find((session) => session.status === 'running' || session.status === 'paused') ?? null;
}

export function buildDayBrief(
  state: PlannerState, records: readonly RecordEntry[], calendars: CalendarSource[], today: string, now = Date.now(),
): DayBrief {
  const timeline = buildTimeline(state, realRecords(records), calendars, today, today, now);
  const bounds = dayBounds(today);
  const summary = summarize(realRecords(records), today, today);
  const running = active(state);
  return {
    date: today,
    items: timeline.slice(0, 12).map((item) => ({
      title: item.title, start: item.start, end: item.end, kind: item.kind, location: item.location, source: item.sourceLabel,
    })),
    next: timeline.find((item) => item.start >= now) ?? null,
    countdowns: getCountdowns(state, today, calendars)
      .filter((item) => item.days >= 0 && item.days <= 7)
      .slice(0, 3)
      .map((item) => ({ title: item.title, date: item.date, days: item.days, kind: item.kind })),
    expenseCents: summary.expenseCents,
    workMinutes: summary.workMinutes,
    focusMinutes: Math.floor(focusedSecondsBetween(state.focusSessions, bounds.start, bounds.end, now) / 60),
    activeFocus: running ? { task: running.task, remainingMinutes: Math.ceil(remainingSeconds(running, now) / 60) } : null,
    warnings: scheduleWarnings(timeline).map((warning) => warning.text),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/insights.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/insights.ts src/domain/insights.test.ts
git commit -m "feat: 今日简报领域函数"
```

---

### Task 2: 本周复盘 buildWeekReview

**Files:**
- Modify: `src/domain/insights.ts`
- Modify: `src/domain/insights.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `realRecords`、`dayBounds`、`active`；`getWeekRange`、`summarize`、`expenseCategories`
- Produces: `export type WeekReview`、`export function buildWeekReview(state, records, calendars, anchor, now?)`；`WeekReview.anchor` 所在周为本周，上一周为对比基线

- [ ] **Step 1: Write the failing test**

```ts
import { buildWeekReview } from './insights';

describe('buildWeekReview', () => {
  it('compares this week with the previous week and ranks categories', () => {
    const state = createPlannerState();
    state.focusSessions.push({
      id: 'f1', task: '复习', minutes: 50, startedAt: at('2026-11-23T19:00'), status: 'completed',
      segments: [{ start: at('2026-11-23T19:00'), end: at('2026-11-23T19:50') }], owner: 'web', epoch: 1,
    });
    const records = [
      record({ id: 'a', date: '2026-11-23', amountCents: 2000, category: '吃饭' }),
      record({ id: 'b', date: '2026-11-24', amountCents: 1000, category: '交通' }),
      record({ id: 'c', date: '2026-11-17', amountCents: 5000, category: '吃饭' }),
    ];
    const facts = buildWeekReview(state, records, [], '2026-11-23', at('2026-11-24T12:00'));
    expect(facts).toMatchObject({ start: '2026-11-23', end: '2026-11-29' });
    expect(facts.thisWeek.expenseCents).toBe(3000);
    expect(facts.lastWeek.expenseCents).toBe(5000);
    expect(facts.thisWeek.focusMinutes).toBe(50);
    expect(facts.categories[0]).toMatchObject({ category: '吃饭', cents: 2000, share: 67 });
    expect(facts.focusByDay).toHaveLength(7);
    expect(facts.focusByDay[0]).toMatchObject({ date: '2026-11-23', minutes: 50 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/insights.test.ts`
Expected: FAIL — `buildWeekReview is not a function`

- [ ] **Step 3: Write minimal implementation**

在 `insights.ts` 追加：

```ts
import { expenseCategories } from './records.ts';

export type WeekReview = {
  start: string;
  end: string;
  thisWeek: { expenseCents: number; incomeCents: number; netCents: number; workMinutes: number; focusMinutes: number; focusSessions: number };
  lastWeek: { expenseCents: number; incomeCents: number; netCents: number; workMinutes: number; focusMinutes: number; focusSessions: number };
  categories: { category: string; cents: number; share: number }[];
  focusByDay: { date: string; minutes: number }[];
  countdowns: { title: string; date: string; days: number }[];
  warnings: string[];
  topExpense: { title: string; amountCents: number; date: string } | null;
};

function weekBucket(state: PlannerState, records: readonly RecordEntry[], start: string, end: string, now: number) {
  const summary = summarize(records, start, end);
  const bounds = { start: new Date(`${start}T00:00:00`).getTime(), end: new Date(`${shiftDate(end, 1)}T00:00:00`).getTime() };
  const sessions = state.focusSessions.filter((session) => session.status !== 'cancelled');
  return {
    expenseCents: summary.expenseCents, incomeCents: summary.incomeCents, netCents: summary.netCents, workMinutes: summary.workMinutes,
    focusMinutes: Math.floor(focusedSecondsBetween(sessions, bounds.start, bounds.end, now) / 60),
    focusSessions: sessions.filter((session) => session.startedAt >= bounds.start && session.startedAt < bounds.end).length,
  };
}

export function buildWeekReview(
  state: PlannerState, records: readonly RecordEntry[], calendars: CalendarSource[], anchor: string, now = Date.now(),
): WeekReview {
  const real = realRecords(records);
  const { start, end } = getWeekRange(anchor);
  const previous = getWeekRange(shiftDate(start, -7));
  const timeline = buildTimeline(state, real, calendars, start, end, now);
  const spend = real.filter((item) => item.type === 'expense' && item.date >= start && item.date <= end);
  const total = spend.reduce((sum, item) => sum + item.amountCents, 0);
  const byCategory = expenseCategories
    .map((category) => {
      const cents = spend.filter((item) => item.type === 'expense' && item.category === category).reduce((sum, item) => sum + item.amountCents, 0);
      return { category, cents, share: total ? Math.round((cents / total) * 100) : 0 };
    })
    .filter((item) => item.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const top = [...spend].sort((a, b) => b.amountCents - a.amountCents)[0];
  const sessions = state.focusSessions;
  return {
    start, end,
    thisWeek: weekBucket(state, real, start, end, now),
    lastWeek: weekBucket(state, real, previous.start, previous.end, now),
    categories: byCategory,
    focusByDay: Array.from({ length: 7 }, (_, index) => {
      const date = shiftDate(start, index);
      const bounds = dayBounds(date);
      return { date, minutes: Math.floor(focusedSecondsBetween(sessions, bounds.start, bounds.end, now) / 60) };
    }),
    countdowns: getCountdowns(state, anchor, calendars).filter((item) => item.days >= 0 && item.days <= 7).slice(0, 5).map((item) => ({ title: item.title, date: item.date, days: item.days })),
    warnings: [...new Set(scheduleWarnings(timeline).map((warning) => warning.text))],
    topExpense: top ? { title: top.title, amountCents: top.amountCents, date: top.date } : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/insights.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/insights.ts src/domain/insights.test.ts
git commit -m "feat: 本周复盘领域函数"
```

---

### Task 3: 账本洞察 buildLedgerInsights

**Files:**
- Modify: `src/domain/insights.ts`
- Modify: `src/domain/insights.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `realRecords`；`expenseCategories`、`shiftDate`
- Produces: `export type LedgerInsights`、`export function buildLedgerInsights(records, today, days?)`，`days` 范围 7–90，默认 30

- [ ] **Step 1: Write the failing test**

```ts
import { buildLedgerInsights } from './insights';

describe('buildLedgerInsights', () => {
  it('covers the window, compares to the previous window, and ranks categories', () => {
    const records = [
      record({ id: 'a', date: '2026-11-22', amountCents: 2000, category: '吃饭' }),
      record({ id: 'b', date: '2026-11-21', amountCents: 1500, category: '吃饭' }),
      record({ id: 'c', date: '2026-11-10', amountCents: 6000, category: '学习', title: '教材' }),
      record({ id: 'w', date: '2026-11-20', amountCents: 8000, type: 'work', workplaceId: 'u', startTime: '09:00', endTime: '13:00', durationMinutes: 240, hourlyRateCents: 2000, title: '兼职' } as RecordEntry),
    ];
    const facts = buildLedgerInsights(records, '2026-11-23', 7);
    expect(facts.range).toMatchObject({ from: '2026-11-17', to: '2026-11-23', days: 7 });
    expect(facts.expenseCents).toBe(3500);
    expect(facts.previousExpenseCents).toBe(6000);
    expect(facts.deltaPct).toBe(-42);
    expect(facts.categories).toEqual([{ category: '吃饭', cents: 3500, share: 100 }]);
    expect(facts.anomalies).toEqual([]);
  });

  it('flags single expenses above three times the daily average', () => {
    const facts = buildLedgerInsights([
      record({ id: 'a', date: '2026-11-22', amountCents: 2000, category: '吃饭' }),
      record({ id: 'big', date: '2026-11-23', title: '羽绒服', amountCents: 30000, category: '日用' }),
    ], '2026-11-23', 7);
    expect(facts.anomalies).toHaveLength(1);
    expect(facts.anomalies[0].title).toBe('羽绒服');
    expect(facts.topExpenses[0]).toMatchObject({ title: '羽绒服', amountCents: 30000 });
  });

  it('returns deltaPct null when the previous window is empty', () => {
    const facts = buildLedgerInsights([record({ amountCents: 1000 })], '2026-11-23', 7);
    expect(facts.previousExpenseCents).toBe(0);
    expect(facts.deltaPct).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/insights.test.ts`
Expected: FAIL — `buildLedgerInsights is not a function`

- [ ] **Step 3: Write minimal implementation**

在 `insights.ts` 追加：

```ts
export type LedgerInsights = {
  range: { from: string; to: string; days: number };
  expenseCents: number;
  incomeCents: number;
  netCents: number;
  dailyAverageExpenseCents: number;
  categories: { category: string; cents: number; share: number }[];
  previousExpenseCents: number;
  deltaPct: number | null;
  topExpenses: { title: string; amountCents: number; date: string; category: string }[];
  anomalies: { title: string; amountCents: number; date: string; reason: string }[];
};

export function buildLedgerInsights(records: readonly RecordEntry[], today: string, days = 30): LedgerInsights {
  const span = Math.min(90, Math.max(7, Math.round(days)));
  const from = shiftDate(today, -(span - 1));
  const previousFrom = shiftDate(from, -span);
  const previousTo = shiftDate(from, -1);
  const real = realRecords(records);
  const window = real.filter((item) => item.date >= from && item.date <= today);
  const previous = real.filter((item) => item.date >= previousFrom && item.date <= previousTo);
  const summary = summarize(window, from, today);
  const expenseCents = summary.expenseCents;
  const dailyAverage = Math.floor(expenseCents / span);
  const expenses = window.filter((item): item is Extract<RecordEntry, { type: 'expense' }> => item.type === 'expense');
  const categories = expenseCategories
    .map((category) => {
      const cents = expenses.filter((item) => item.category === category).reduce((sum, item) => sum + item.amountCents, 0);
      return { category, cents, share: expenseCents ? Math.round((cents / expenseCents) * 100) : 0 };
    })
    .filter((item) => item.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const previousExpenseCents = summarize(previous, previousFrom, previousTo).expenseCents;
  const sorted = [...expenses].sort((a, b) => b.amountCents - a.amountCents);
  const threshold = Math.max(dailyAverage * 3, 5000);
  return {
    range: { from, to: today, days: span },
    expenseCents, incomeCents: summary.incomeCents, netCents: summary.netCents,
    dailyAverageExpenseCents: dailyAverage,
    categories,
    previousExpenseCents,
    deltaPct: previousExpenseCents ? Math.round(((expenseCents - previousExpenseCents) / previousExpenseCents) * 100) : null,
    topExpenses: sorted.slice(0, 3).map((item) => ({ title: item.title, amountCents: item.amountCents, date: item.date, category: item.category })),
    anomalies: sorted.filter((item) => item.amountCents >= threshold).slice(0, 3).map((item) => ({
      title: item.title, amountCents: item.amountCents, date: item.date,
      reason: `单笔 ¥${(item.amountCents / 100).toFixed(2)}，超过日均的 3 倍`,
    })),
  };
}
```

注意：测试第一例中 7 天窗口是 11-17 至 11-23，`教材`（11-10）落在对比窗口 11-10 至 11-16，只影响 `previousExpenseCents`，不进本期 `anomalies`；第二例专门验证异常阈值（30000 分 ≥ max(日均×3, 5000 分)）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/insights.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/insights.ts src/domain/insights.test.ts
git commit -m "feat: 账本洞察领域函数"
```

---

### Task 4: 专注洞察 buildFocusInsights

**Files:**
- Modify: `src/domain/insights.ts`
- Modify: `src/domain/insights.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `dayBounds`；`focusedSeconds`、`focusedSecondsBetween`
- Produces: `export type FocusInsights`、`export function buildFocusInsights(state, today, days?, now?)`

- [ ] **Step 1: Write the failing test**

```ts
import { buildFocusInsights } from './insights';

function session(id: string, start: string, minutes: number, task = '复习') {
  return {
    id, task, minutes, startedAt: at(start), status: 'completed' as const,
    segments: [{ start: at(start), end: at(start) + minutes * 60_000 }], owner: 'web', epoch: 1,
  };
}

describe('buildFocusInsights', () => {
  it('aggregates totals, streaks and time slots', () => {
    const state = createPlannerState();
    state.focusSessions.push(
      session('f1', '2026-11-23T09:00', 50),
      session('f2', '2026-11-23T20:00', 25, '英语'),
      session('f3', '2026-11-22T14:00', 30),
    );
    const facts = buildFocusInsights(state, '2026-11-23', 7, at('2026-11-23T22:00'));
    expect(facts.days).toBe(7);
    expect(facts.totalMinutes).toBe(105);
    expect(facts.sessions).toBe(3);
    expect(facts.streakDays).toBe(2);
    expect(facts.bestDay).toMatchObject({ date: '2026-11-23', minutes: 75 });
    expect(facts.bySlot.find((slot) => slot.slot === '上午')?.minutes).toBe(50);
    expect(facts.topTasks[0]).toEqual({ task: '复习', minutes: 80 });
  });

  it('handles no sessions', () => {
    const facts = buildFocusInsights(createPlannerState(), '2026-11-23', 7, at('2026-11-23T22:00'));
    expect(facts).toMatchObject({ totalMinutes: 0, sessions: 0, streakDays: 0, bestDay: null, topTasks: [] });
    expect(facts.daily).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/insights.test.ts`
Expected: FAIL — `buildFocusInsights is not a function`

- [ ] **Step 3: Write minimal implementation**

在 `insights.ts` 追加：

```ts
export type FocusInsights = {
  days: number;
  totalMinutes: number;
  sessions: number;
  completedSessions: number;
  daily: { date: string; minutes: number }[];
  averagePerActiveDayMinutes: number;
  streakDays: number;
  bestDay: { date: string; minutes: number } | null;
  bySlot: { slot: '上午' | '下午' | '晚上' | '深夜'; minutes: number; share: number }[];
  topTasks: { task: string; minutes: number }[];
};

const slotOf = (hour: number): FocusInsights['bySlot'][number]['slot'] =>
  hour >= 5 && hour < 12 ? '上午' : hour >= 12 && hour < 18 ? '下午' : hour >= 18 && hour < 23 ? '晚上' : '深夜';

export function buildFocusInsights(state: PlannerState, today: string, days = 30, now = Date.now()): FocusInsights {
  const span = Math.min(90, Math.max(7, Math.round(days)));
  const from = shiftDate(today, -(span - 1));
  const sessions = state.focusSessions.filter((item) => item.status !== 'cancelled');
  const daily = Array.from({ length: span }, (_, index) => {
    const date = shiftDate(from, index);
    const bounds = dayBounds(date);
    return { date, minutes: Math.floor(focusedSecondsBetween(sessions, bounds.start, bounds.end, now) / 60) };
  });
  const windowStart = new Date(`${from}T00:00:00`).getTime();
  const windowSessions = sessions.filter((item) => item.startedAt >= windowStart);
  const totalMinutes = daily.reduce((sum, day) => sum + day.minutes, 0);
  const activeDays = daily.filter((day) => day.minutes > 0);
  let streak = 0;
  for (let index = daily.length - 1; index >= 0; index--) {
    if (daily[index].minutes <= 0) break;
    streak += 1;
  }
  const slots = new Map<string, number>();
  const tasks = new Map<string, number>();
  for (const item of windowSessions) {
    const minutes = Math.floor(focusedSeconds(item, now) / 60);
    if (minutes <= 0) continue;
    const slot = slotOf(new Date(item.segments[0].start).getHours());
    slots.set(slot, (slots.get(slot) ?? 0) + minutes);
    tasks.set(item.task, (tasks.get(item.task) ?? 0) + minutes);
  }
  const best = [...daily].sort((a, b) => b.minutes - a.minutes)[0];
  return {
    days: span,
    totalMinutes,
    sessions: windowSessions.length,
    completedSessions: windowSessions.filter((item) => item.status === 'completed').length,
    daily,
    averagePerActiveDayMinutes: activeDays.length ? Math.round(totalMinutes / activeDays.length) : 0,
    streakDays: streak,
    bestDay: best && best.minutes > 0 ? best : null,
    bySlot: (['上午', '下午', '晚上', '深夜'] as const).map((slot) => {
      const minutes = slots.get(slot) ?? 0;
      return { slot, minutes, share: totalMinutes ? Math.round((minutes / totalMinutes) * 100) : 0 };
    }),
    topTasks: [...tasks.entries()].map(([task, minutes]) => ({ task, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 3),
  };
}
```

`insights.ts` 顶部 import 需补 `focusedSeconds`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/insights.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/insights.ts src/domain/insights.test.ts
git commit -m "feat: 专注洞察领域函数"
```

---

### Task 5: 模板文案 dayBriefNarrative / weekReviewNarrative

**Files:**
- Modify: `src/domain/insights.ts`
- Modify: `src/domain/insights.test.ts`

**Interfaces:**
- Consumes: Task 1–4 的四个类型
- Produces: `export function dayBriefNarrative(facts: DayBrief): string`、`export function weekReviewNarrative(facts: WeekReview): string`；输出 3–5 句、含关键数字、以句号结尾

- [ ] **Step 1: Write the failing test**

```ts
import { dayBriefNarrative, weekReviewNarrative } from './insights';

describe('template narratives', () => {
  it('covers schedule, spend, focus and countdown for the day', () => {
    const state = createPlannerState();
    state.events.push(buildEvent({ id: 'e1', kind: 'course', title: '高等数学', location: 'A101', start: '2026-11-23T14:00', end: '2026-11-23T16:00', allDay: false, timeZone: 'Asia/Shanghai' }));
    const facts = buildDayBrief(state, [record({ amountCents: 1850 })], [], '2026-11-23', at('2026-11-23T08:00'));
    const text = dayBriefNarrative(facts);
    expect(text).toContain('1 件事');
    expect(text).toContain('高等数学');
    expect(text).toContain('18.50');
    expect(text.endsWith('。')).toBe(true);
  });

  it('gives an empty-day sentence and a week comparison', () => {
    const empty = dayBriefNarrative(buildDayBrief(createPlannerState(), [], [], '2026-11-23', at('2026-11-23T08:00')));
    expect(empty).toContain('还没有安排');
    const week = buildWeekReview(createPlannerState(), [record({ date: '2026-11-23', amountCents: 2000 })], [], '2026-11-23', at('2026-11-23T12:00'));
    expect(weekReviewNarrative(week)).toContain('吃饭');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/insights.test.ts`
Expected: FAIL — `dayBriefNarrative is not a function`

- [ ] **Step 3: Write minimal implementation**

在 `insights.ts` 追加：

```ts
const yuan = (cents: number) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clock = (stamp: number) => new Date(stamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

export function dayBriefNarrative(facts: DayBrief): string {
  const lines: string[] = [];
  if (!facts.items.length) lines.push('今天还没有安排，可以先歇一会儿。');
  else {
    const next = facts.next
      ? `下一项是${facts.next.title}（${clock(facts.next.start)}）`
      : `今天最后一项已经结束`;
    lines.push(`今天 ${facts.items.length} 件事，${next}。`);
  }
  const spend = facts.expenseCents ? `今天支出 ¥${yuan(facts.expenseCents)}` : '今天还没有支出';
  const focus = facts.focusMinutes ? `，专注 ${facts.focusMinutes} 分钟。` : '，还没开始专注。';
  lines.push(`${spend}${focus}`);
  if (facts.countdowns.length) {
    const nearest = facts.countdowns[0];
    lines.push(`最近 ${nearest.days} 天是${nearest.title}，别忘了。`);
  }
  if (facts.warnings.length) lines.push(facts.warnings[0]);
  return lines.join('');
}

export function weekReviewNarrative(facts: WeekReview): string {
  const lines: string[] = [];
  lines.push(`本周支出 ¥${yuan(facts.thisWeek.expenseCents)}，上周 ¥${yuan(facts.lastWeek.expenseCents)}。`);
  if (facts.categories.length) {
    const top = facts.categories[0];
    lines.push(`花得最多的是${top.category}，占 ${top.share}%。`);
  }
  if (facts.thisWeek.focusMinutes) lines.push(`本周专注 ${facts.thisWeek.focusMinutes} 分钟，共 ${facts.thisWeek.focusSessions} 段。`);
  else lines.push('本周还没有专注记录。');
  if (facts.countdowns.length) lines.push(`未来一周最要紧的是${facts.countdowns[0].title}，还有 ${facts.countdowns[0].days} 天。`);
  return lines.join('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/insights.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/domain/insights.ts src/domain/insights.test.ts
git commit -m "feat: 简报与复盘规则文案"
```

---

### Task 6: 网关新增 4 个只读工具

**Files:**
- Modify: `local-sync/agentApi.mjs`（`tools` 数组，`day_overview` 之前插入）
- Test: `local-sync/insightsTools.test.mjs`

**Interfaces:**
- Consumes: `src/domain/insights.ts` 的 `buildDayBrief`、`buildWeekReview`、`buildLedgerInsights`、`buildFocusInsights`
- Produces: manifest 工具数 40 → 44；工具名 `day_brief`、`week_review`、`ledger_insights`、`focus_insights`，全部 read

- [ ] **Step 1: Write the failing test**

`local-sync/insightsTools.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('insight tools are listed and answer read-only summaries', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-insights-'));
  const password = crypto.randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    cwd: dir, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHUNSHOU_DATA_DIR: dir, SHUNSHOU_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway startup timeout')), 10000);
    child.stdout.on('data', (chunk) => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('gateway exited')); });
  });
  const login = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const { token } = await login.json();
  const created = await fetch(`${url}/api/agent/tokens`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '洞察', scope: 'read' }) });
  const { token: agent } = await created.json();
  const headers = { Authorization: `Bearer ${agent}`, 'Content-Type': 'application/json' };

  const manifest = await (await fetch(`${url}/api/v1/agent/manifest`, { headers })).json();
  for (const name of ['day_brief', 'week_review', 'ledger_insights', 'focus_insights']) {
    const tool = manifest.tools.find((item) => item.name === name);
    assert.ok(tool, `${name} missing`);
    assert.equal(tool.scope, 'read');
  }

  const call = async (tool, args = {}) => {
    const response = await fetch(`${url}/api/v1/agent/call`, { method: 'POST', headers, body: JSON.stringify({ tool, arguments: args }) });
    return { status: response.status, body: await response.json() };
  };
  const brief = await call('day_brief');
  assert.equal(brief.status, 200);
  assert.equal(brief.body.result.expenseCents, 0);
  assert.ok(Array.isArray(brief.body.result.items));
  const week = await call('week_review');
  assert.equal(week.status, 200);
  assert.equal(week.body.result.thisWeek.expenseCents, 0);
  const ledger = await call('ledger_insights', { days: 7 });
  assert.equal(ledger.status, 200);
  assert.equal(ledger.body.result.range.days, 7);
  const focus = await call('focus_insights', { days: 7 });
  assert.equal(focus.status, 200);
  assert.equal(focus.body.result.sessions, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test local-sync/insightsTools.test.mjs`
Expected: FAIL — `day_brief missing`

- [ ] **Step 3: Write minimal implementation**

`local-sync/agentApi.mjs` 顶部 import 追加：

```js
import { buildDayBrief, buildFocusInsights, buildLedgerInsights, buildWeekReview } from '../src/domain/insights.ts';
```

输入 schema 追加（与其他 `*Input` 放一起）：

```js
const dayBriefInput = z.object({ date: dateSchema.optional() }).strict();
const weekReviewInput = z.object({ anchor: dateSchema.optional() }).strict();
const insightWindowInput = z.object({ days: z.number().int().min(7).max(90).default(30) }).strict();
```

`tools` 数组开头（`day_overview` 之前）插入四个工具：

```js
{
  name: 'day_brief', scope: 'read', input: dayBriefInput,
  description: '今日简报：当天安排、下一项、未来7天倒计时、花费、专注和预警。日期不填就是今天。',
  handler: (args) => {
    const snap = snapshot();
    const date = args.date ?? snap.today;
    const facts = buildDayBrief(snap.doc.state, snap.records, snap.calendars, date, snap.now);
    return { result: { ...facts, timeZone }, revision: snap.doc.revision, serverId: snap.doc.serverId };
  },
},
{
  name: 'week_review', scope: 'read', input: weekReviewInput,
  description: '本周复盘：本周与上周的支出、收入、工时、专注对比，分类占比和预警。锚点日期不填就是今天所在周。',
  handler: (args) => {
    const snap = snapshot();
    const facts = buildWeekReview(snap.doc.state, snap.records, snap.calendars, args.anchor ?? snap.today, snap.now);
    return { result: { ...facts, timeZone }, revision: snap.doc.revision, serverId: snap.doc.serverId };
  },
},
{
  name: 'ledger_insights', scope: 'read', input: insightWindowInput,
  description: '账本洞察：近 N 天（7-90，默认30）支出、分类占比、与上一周期对比、大额支出和异常单笔。',
  handler: (args) => {
    const snap = snapshot();
    return { result: { ...buildLedgerInsights(snap.records, snap.today, args.days), timeZone }, revision: snap.doc.revision, serverId: snap.doc.serverId };
  },
},
{
  name: 'focus_insights', scope: 'read', input: insightWindowInput,
  description: '专注洞察：近 N 天（7-90，默认30）总分钟、每日分布、连续天数、高峰时段和常做任务。',
  handler: (args) => {
    const snap = snapshot();
    return { result: { ...buildFocusInsights(snap.doc.state, snap.today, args.days, snap.now), timeZone }, revision: snap.doc.revision, serverId: snap.doc.serverId };
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test local-sync/insightsTools.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add local-sync/agentApi.mjs local-sync/insightsTools.test.mjs
git commit -m "feat: 网关新增四个洞察工具"
```

---

### Task 7: 网关 briefing() 与缓存

**Files:**
- Modify: `local-sync/assistant.mjs`
- Test: `local-sync/assistantBriefing.test.mjs`

**Interfaces:**
- Consumes: Task 6 的工具（通过注入的 `getBriefFacts`）
- Produces: `createAssistant({...}).briefing({ scope, fresh })` → `{ scope, date, facts, narrative, degraded, warning, model, generatedAt }`

- [ ] **Step 1: Write the failing test**

`local-sync/assistantBriefing.test.mjs` 关键部分（完整文件按此结构写全）：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAssistant } from './assistant.mjs';

const reply = (response, value, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
};

test('briefing returns a modeled narrative, degrades cleanly, and caches', async (t) => {
  let mode = 'ok';
  const providerRequests = [];
  const provider = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      providerRequests.push({ url: request.url, body: raw ? JSON.parse(raw) : null });
      if (mode === 'fail') { reply(response, { error: { message: 'boom' } }, 500); return; }
      reply(response, { choices: [{ message: { role: 'assistant', content: '今天两件事，先上高等数学。' } }] });
    });
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = provider.address().port;
  t.after(() => new Promise((resolve) => provider.close(resolve)));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-briefing-'));
  const password = crypto.randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    cwd: dir, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHUNSHOU_DATA_DIR: dir, SHUNSHOU_PASSWORD: password }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill(); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway startup timeout')), 10000);
    child.stdout.on('data', (chunk) => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('gateway exited')); });
  });
  const login = await fetch(`${url}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const { token } = await login.json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const unconfigured = await fetch(`${url}/api/assistant/briefing?scope=day`, { headers });
  const unconfiguredBody = await unconfigured.json();
  assert.equal(unconfigured.status, 200);
  assert.equal(unconfiguredBody.degraded, true);
  assert.match(unconfiguredBody.warning, /还没有配置模型/);
  assert.ok(unconfiguredBody.narrative.length > 0);
  assert.ok(unconfiguredBody.facts.date);
  assert.equal(providerRequests.length, 0);

  await fetch(`${url}/api/assistant/settings`, { method: 'PUT', headers, body: JSON.stringify({ baseUrl: `http://127.0.0.1:${providerPort}/v1`, model: 'fake-model' }) });

  const first = await fetch(`${url}/api/assistant/briefing?scope=day`, { headers });
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.degraded, false);
  assert.equal(firstBody.narrative, '今天两件事，先上高等数学。');
  assert.equal(firstBody.model, 'fake-model');
  assert.equal(providerRequests.length, 1);

  await fetch(`${url}/api/assistant/briefing?scope=day`, { headers });
  assert.equal(providerRequests.length, 1, 'second call should hit cache');

  await fetch(`${url}/api/assistant/briefing?scope=day&fresh=1`, { headers });
  assert.equal(providerRequests.length, 2, 'fresh bypasses cache');

  mode = 'fail';
  const failed = await fetch(`${url}/api/assistant/briefing?scope=week&fresh=1`, { headers });
  const failedBody = await failed.json();
  assert.equal(failed.status, 200);
  assert.equal(failedBody.degraded, true);
  assert.match(failedBody.warning, /模型/);
  assert.ok(failedBody.narrative.length > 0);
  const bad = await fetch(`${url}/api/assistant/briefing?scope=bogus`, { headers });
  assert.equal(bad.status, 400);
});

test('briefing redacts facts for non-loopback models and restores placeholders', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-briefing-redact-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const facts = {
    date: '2026-11-23', items: [{ title: '找 13812345678 同学', start: Date.now(), end: Date.now() + 600_000, kind: 'event', location: '', source: '手动日程' }],
    next: null, countdowns: [], expenseCents: 0, workMinutes: 0, focusMinutes: 0, activeFocus: null, warnings: [],
  };
  const assistant = createAssistant({
    directory: dir,
    getTools: async () => [],
    callTool: async () => ({ ok: true }),
    getBriefFacts: async () => facts,
  });

  const sent = [];
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });

  assistant.updateSettings({ baseUrl: 'https://api.example.com/v1', model: 'cloud-model', privacyMode: 'off' });
  globalThis.fetch = async (_url, init) => {
    sent.push(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '今天先联系 13812345678。' } }] }), { status: 200 });
  };
  const raw = await assistant.briefing({ scope: 'day', fresh: true });
  assert.equal(raw.degraded, false);
  assert.ok(sent[0].includes('13812345678'), 'privacyMode off sends raw text');

  assistant.updateSettings({ privacyMode: 'redact' });
  globalThis.fetch = async (_url, init) => {
    sent.push(init.body);
    const match = String(init.body).match(/\[\[PHONE:[0-9a-f]{10}\]\]/);
    return new Response(JSON.stringify({ choices: [{ message: { content: `今天先联系 ${match ? match[0] : '某人'}。` } }] }), { status: 200 });
  };
  const redacted = await assistant.briefing({ scope: 'day', fresh: true });
  assert.equal(sent[1].includes('13812345678'), false, 'redact mode must not send the raw phone');
  assert.ok(sent[1].includes('[[PHONE:'), 'redact mode sends a placeholder');
  assert.equal(redacted.degraded, false);
  assert.ok(redacted.narrative.includes('13812345678'), 'reply placeholder is restored locally');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test local-sync/assistantBriefing.test.mjs`
Expected: FAIL — briefing 路由 405

- [ ] **Step 3: Write minimal implementation**

`local-sync/assistant.mjs`：

1. `createAssistant` 签名加 `getBriefFacts`：

```js
export function createAssistant({ directory, getTools, callTool, getBriefFacts }) {
```

2. 文件内新增常量与工具函数（放 `summarizeTool` 之后）：

```js
const BRIEFING_TIMEOUT_MS = 30_000;
const BRIEFING_TTL_MS = 10 * 60_000;
const BRIEFING_MAX = 50;
const BRIEFING_MAX_CHARS = 600;

function briefingPrompt(scope, facts) {
  return [
    `你是「顺手」的简报助手。下面是代码算好的${scope === 'day' ? '今日简报' : '本周复盘'}数据（JSON）。`,
    '规则：',
    '1. 只根据这些数据写 3 到 5 句简体中文，不要编造数据里没有的事。',
    '2. 金额说“元”，时间用 HH:MM；不要输出 JSON、列表符号或标题。',
    '3. 先给结论，再给一两句提醒；不确定就不提。',
    JSON.stringify(facts),
  ].join('\n');
}

function sanitizeNarrative(text) {
  const value = String(text ?? '').replace(/```[a-z]*\n?/gi, '').trim();
  if (value.length < 5 || value.length > BRIEFING_MAX_CHARS) return '';
  return value;
}

function templateNarrative(scope, facts) {
  return scope === 'day' ? dayBriefNarrative(facts) : weekReviewNarrative(facts);
}
```

顶部 import 补：

```js
import { dayBriefNarrative, weekReviewNarrative } from '../src/domain/insights.ts';
```

3. `createAssistant` 内新增缓存与 `briefing`：

```js
const briefCache = new Map();

function cacheKey(scope, facts) {
  return `${scope}:${scope === 'week' ? facts.start : facts.date}`;
}

async function briefing({ scope = 'day', fresh = false } = {}) {
  const settings = readSettings();
  const facts = await getBriefFacts(scope);
  const key = `${cacheKey(scope, facts)}:${settings.model}`;
  const cached = briefCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < BRIEFING_TTL_MS) return cached.value;

  const finish = (value) => {
    briefCache.set(key, { at: Date.now(), value });
    if (briefCache.size > BRIEFING_MAX) briefCache.delete(briefCache.keys().next().value);
    return value;
  };
  const degraded = (warning) => finish({
    scope, date: scope === 'week' ? facts.end : facts.date, facts,
    narrative: templateNarrative(scope, facts), degraded: true, warning, model: null, generatedAt: new Date().toISOString(),
  });

  if (!settings.model) return degraded('还没有配置模型，先给你规则版小结。');
  const loopback = isLoopback(settings.baseUrl);
  if (!loopback && settings.privacyMode === 'local-only') return degraded('隐私模式是“只在本机”，但模型地址不是本机。');

  const redacting = !loopback && settings.privacyMode === 'redact';
  const redactor = redacting ? createRedactor() : null;
  const body = {
    model: settings.model,
    messages: [
      { role: 'system', content: briefingPrompt(scope, redacting ? redactor.redactValue(facts) : facts) },
      { role: 'user', content: scope === 'day' ? '写今天的简报。' : '写本周的复盘。' },
    ],
    temperature: 0.3, max_tokens: 400, stream: false,
    ...(loopback ? { reasoning_effort: 'none' } : {}),
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIEFING_TIMEOUT_MS);
    let data;
    try {
      const response = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
        body: JSON.stringify(body), redirect: 'error', signal: controller.signal,
      });
      data = await response.json().catch(() => null);
      if (!response.ok) return degraded('模型没有正常回应，先给你规则版。');
    } finally {
      clearTimeout(timer);
    }
    const raw = data?.choices?.[0]?.message?.content;
    const narrative = sanitizeNarrative(redacting ? redactor.rehydrateText(raw) : raw);
    if (!narrative) return degraded('模型的回复不合用，先给你规则版。');
    return finish({
      scope, date: scope === 'week' ? facts.end : facts.date, facts,
      narrative, degraded: false, warning: null, model: settings.model, generatedAt: new Date().toISOString(),
    });
  } catch {
    return degraded('模型没有及时回应，先给你规则版。');
  }
}
```

4. `updateSettings` 末尾加 `briefCache.clear();`。

5. 返回值改为 `return { publicSettings, updateSettings, test, chat, briefing };`

- [ ] **Step 4: Modify server.mjs to wire the route**

`getAssistant` 注入 `getBriefFacts`：

```js
const getAssistant = () => assistant ??= createAssistant({
  directory: DATA_DIR,
  getTools: async () => (await getAgentApi().manifest({ kind: 'assistant', name: '内置助手', scope: 'write' })).tools,
  getBriefFacts: async (scope) => {
    const tool = scope === 'week' ? 'week_review' : 'day_brief';
    const result = await getAgentApi().call({ tool, arguments: {}, scope: 'read', actor: 'assistant', caller: { kind: 'assistant', name: '内置助手', scope: 'write' } });
    return result.result;
  },
  callTool: async ({ tool, args, requestId }) => {
```

`/api/assistant/` 分支内、`chat` 路由之前加：

```js
if (request.method === 'GET' && url.pathname === '/api/assistant/briefing') {
  const scope = url.searchParams.get('scope') ?? 'day';
  if (scope !== 'day' && scope !== 'week') {
    json(response, 400, { ok: false, error: 'invalid_scope', message: 'scope 只能是 day 或 week。' });
    return;
  }
  const fresh = url.searchParams.get('fresh') === '1';
  json(response, 200, { ok: true, ...(await getAssistant().briefing({ scope, fresh })) });
  return;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test local-sync/assistantBriefing.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add local-sync/assistant.mjs local-sync/server.mjs local-sync/assistantBriefing.test.mjs
git commit -m "feat: 简报端点与模型润色降级"
```

---

### Task 8: 前端拉取模块与 hook

**Files:**
- Create: `src/data/briefing.ts`
- Test: `src/data/briefing.test.ts`
- Create: `src/data/useBriefing.ts`

**Interfaces:**
- Consumes: `gatewayFetch`、`GatewayError`、`isGatewayConnected`；`buildDayBrief`、`buildWeekReview`、`dayBriefNarrative`、`weekReviewNarrative`
- Produces: `export type BriefingScope = 'day' | 'week'`、`export type BriefingResponse`、`export async function fetchBriefing(scope, options?)`、`export function useBriefing(input)`

- [ ] **Step 1: Write the failing test**

`src/data/briefing.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gatewayLogin } from './gateway';
import { fetchBriefing } from './briefing';

const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const dayFacts = {
  date: '2026-11-23', items: [], next: null, countdowns: [], expenseCents: 0, workMinutes: 0, focusMinutes: 0, activeFocus: null, warnings: [],
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('briefing client', () => {
  it('requests the scope and parses the response', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/api/login')) return reply({ ok: true, token: 'session-token', expiresAt: Date.now() + 3600_000 });
      return reply({ ok: true, scope: 'day', date: '2026-11-23', facts: dayFacts, narrative: '今天没有安排。', degraded: false, warning: null, model: 'm', generatedAt: '2026-11-23T08:00:00.000Z' });
    }));
    await gatewayLogin('http://gateway.test', 'password123');
    const value = await fetchBriefing('day', { fresh: true });
    expect(value.narrative).toBe('今天没有安排。');
    expect(value.degraded).toBe(false);
    expect(requests.at(-1)).toContain('/api/assistant/briefing?scope=day');
    expect(requests.at(-1)).toContain('fresh=1');
  });

  it('throws a gateway error on bad payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/login')) return reply({ ok: true, token: 'session-token', expiresAt: Date.now() + 3600_000 });
      return reply({ ok: true, scope: 'day' });
    }));
    await gatewayLogin('http://gateway.test', 'password123');
    await expect(fetchBriefing('day')).rejects.toThrow(/格式/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/briefing.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/data/briefing.ts`：

```ts
import { z } from 'zod';
import { GatewayError, gatewayFetch } from './gateway';

export type BriefingScope = 'day' | 'week';

const factsSchema = z.record(z.string(), z.unknown());
const responseSchema = z.object({
  ok: z.literal(true),
  scope: z.enum(['day', 'week']),
  date: z.string(),
  facts: factsSchema,
  narrative: z.string(),
  degraded: z.boolean(),
  warning: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  generatedAt: z.string(),
}).strict();

export type BriefingResponse = {
  scope: BriefingScope;
  date: string;
  facts: Record<string, unknown>;
  narrative: string;
  degraded: boolean;
  warning: string | null;
  model: string | null;
  generatedAt: string;
};

export async function fetchBriefing(scope: BriefingScope, options: { fresh?: boolean } = {}): Promise<BriefingResponse> {
  const query = `?scope=${scope}${options.fresh ? '&fresh=1' : ''}`;
  const response = await gatewayFetch(`/api/assistant/briefing${query}`);
  if (response.status === 401) throw new GatewayError('登录已失效，请重新连接电脑。', 'unauthorized');
  const value = await response.json().catch(() => null);
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new GatewayError('电脑返回的简报格式无效。', 'invalid_response');
  return {
    scope: parsed.data.scope, date: parsed.data.date, facts: parsed.data.facts, narrative: parsed.data.narrative,
    degraded: parsed.data.degraded, warning: parsed.data.warning ?? null, model: parsed.data.model ?? null, generatedAt: parsed.data.generatedAt,
  };
}
```

`src/data/useBriefing.ts`：

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlannerState } from '../domain/planner.ts';
import type { RecordEntry } from '../domain/records.ts';
import type { CalendarSource } from '../domain/schedule.ts';
import { buildDayBrief, buildWeekReview, dayBriefNarrative, weekReviewNarrative } from '../domain/insights.ts';
import { isGatewayConnected } from './gateway';
import { fetchBriefing, type BriefingScope } from './briefing';

type Input = { scope: BriefingScope; state: PlannerState; records: readonly RecordEntry[]; calendars: CalendarSource[]; today: string };

export function useBriefing({ scope, state, records, calendars, today }: Input) {
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

  const load = useCallback(async (fresh = false) => {
    if (!isGatewayConnected()) { setRemote(null); return; }
    const ticket = ++active.current;
    setLoading(true);
    setError('');
    try {
      const value = await fetchBriefing(scope, { fresh });
      if (active.current === ticket) setRemote({ narrative: value.narrative, degraded: value.degraded, warning: value.warning });
    } catch (reason) {
      if (active.current === ticket) setError(reason instanceof Error ? reason.message : '简报没有拉取成功。');
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
```

返回类型是 `DayBrief | WeekReview` 的联合；调用处按 `scope` 传字面量即可获得收窄——`useBriefing({ scope: 'day', ... })` 的返回仍是联合类型，组件里对 `facts.items` 的访问会报错。为此给 hook 增加重载：

```ts
export function useBriefing(input: Input & { scope: 'day' }): { facts: DayBrief; narrative: string; degraded: boolean; warning: string | null; loading: boolean; error: string; refresh: () => Promise<void> };
export function useBriefing(input: Input & { scope: 'week' }): { facts: WeekReview; narrative: string; degraded: boolean; warning: string | null; loading: boolean; error: string; refresh: () => Promise<void> };
export function useBriefing({ scope, state, records, calendars, today }: Input) { /* 上面实现体不变 */ }
```

实现体返回值需要满足两个重载，因此用到 `refresh: () => load(true)`（返回 `Promise<void>`）。`DayBrief`、`WeekReview` 类型从 `'../domain/insights.ts'` 一并 import。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/briefing.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/data/briefing.ts src/data/useBriefing.ts src/data/briefing.test.ts
git commit -m "feat: 前端简报拉取与 hook"
```

---

### Task 9: 首页今日简报卡

**Files:**
- Modify: `src/features/home/HomePage.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 8 的 `useBriefing`
- Produces: `<section aria-label="今日简报" className="home-brief">`，含 narrative、要点 chips、刷新按钮

- [ ] **Step 1: Wire the hook**

在 `HomePage` 内、`agenda` 等计算之后加：

```ts
const brief = useBriefing({ scope: 'day', state: planner, records, calendars: sources, today });
```

`import { useBriefing } from '../../data/useBriefing';` 以及 `RefreshCw`、`Sparkles` 图标。

- [ ] **Step 2: Insert the card**

在 `<dl className="home-glance">…</dl>` 之后、`{!askOpen ? <button className="home-ask"…` 之前插入：

```tsx
<section className="home-brief" aria-label="今日简报">
  <div className="home-brief-head">
    <span className="home-kicker"><Sparkles size={13} strokeWidth={1.7} /> 今日简报</span>
    <div className="home-brief-actions">
      {brief.degraded ? <span className="home-brief-tag">规则版</span> : null}
      <button type="button" className="text-link" onClick={() => void brief.refresh()} disabled={brief.loading}>
        <RefreshCw size={13} />{brief.loading ? '更新中' : '刷新'}
      </button>
    </div>
  </div>
  <p className="home-brief-copy">{brief.narrative}</p>
  <div className="home-brief-chips">
    <span>{brief.facts.items.length} 件安排</span>
    <span>支出 ¥ {money(brief.facts.expenseCents)}</span>
    <span>专注 {brief.facts.focusMinutes} 分钟</span>
    {brief.facts.countdowns[0] ? <span>{brief.facts.countdowns[0].title} · {brief.facts.countdowns[0].days} 天</span> : null}
  </div>
  {brief.warning ? <p className="form-hint">{brief.warning}</p> : null}
  {brief.error ? <p className="form-hint">{brief.error}</p> : null}
</section>
```

注意 `brief.facts` 来自本地 `buildDayBrief`，类型是 `DayBrief`，无需断言；`useBriefing` 返回的 `facts` 用联合类型，若 TypeScript 报错，在 hook 内部把返回值类型标为 `{ facts: DayBrief | WeekReview … }` 并在调用处按 scope 收窄。实现时以 `npx tsc --noEmit` 通过为准。

- [ ] **Step 3: Add styles**

`src/styles.css` 追加：

```css
.home-brief { margin-top: 16px; padding: 14px 16px; border: 1px solid var(--rule); border-left: 4px solid var(--steel); border-radius: var(--r); background: var(--sheet); }
.home-brief-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.home-brief-actions { display: flex; align-items: center; gap: 12px; }
.home-brief-actions .text-link { display: inline-flex; align-items: center; gap: 4px; }
.home-brief-tag { font-size: 11px; color: var(--steel); border: 1px solid var(--rule-strong); border-radius: 999px; padding: 1px 8px; }
.home-brief-copy { margin: 8px 0 10px; font-size: 13.5px; line-height: 1.7; color: var(--ink-soft); }
.home-brief-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.home-brief-chips span { font-size: 11.5px; color: var(--muted); background: var(--note); border-radius: 999px; padding: 3px 10px; }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run src/app/App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/home/HomePage.tsx src/styles.css
git commit -m "feat: 首页今日简报卡"
```

---

### Task 10: 「今天」页本周复盘面板

**Files:**
- Modify: `src/features/overview/OverviewPage.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 8 的 `useBriefing`（scope `week`）
- Produces: `<section aria-label="本周复盘" className="review-panel">`

- [ ] **Step 1: Wire the hook and insert the panel**

`OverviewPage` 内加：

```ts
const review = useBriefing({ scope: 'week', state: planner, records, calendars: sources, today });
```

在 `</section>`（`overview-band` 结束）之后、`<div className="dashboard-grid">` 之前插入：

```tsx
<section className="review-panel" aria-label="本周复盘">
  <div className="review-head">
    <div><span className="home-kicker">本周复盘</span><h2>{shortDate(review.facts.start)} 至 {shortDate(review.facts.end)}</h2></div>
    <div className="review-actions">
      {review.degraded ? <span className="home-brief-tag">规则版</span> : null}
      <button type="button" className="text-link" onClick={() => void review.refresh()} disabled={review.loading}><RefreshCw size={13} />{review.loading ? '更新中' : '刷新'}</button>
    </div>
  </div>
  <p className="review-copy">{review.narrative}</p>
  <dl className="review-stats">
    <div><dt>本周支出</dt><dd>¥ {money(review.facts.thisWeek.expenseCents)}</dd><small>上周 ¥ {money(review.facts.lastWeek.expenseCents)}</small></div>
    <div><dt>本周专注</dt><dd>{review.facts.thisWeek.focusMinutes} 分钟</dd><small>上周 {review.facts.lastWeek.focusMinutes} 分钟</small></div>
    <div><dt>本周工时</dt><dd>{(review.facts.thisWeek.workMinutes / 60).toFixed(1)} 小时</dd><small>上周 {(review.facts.lastWeek.workMinutes / 60).toFixed(1)} 小时</small></div>
    <div><dt>本周净剩</dt><dd>¥ {money(review.facts.thisWeek.netCents)}</dd><small>上周 ¥ {money(review.facts.lastWeek.netCents)}</small></div>
  </dl>
  {review.facts.categories.length ? <ul className="review-categories">
    {review.facts.categories.map((item) => <li key={item.category}>
      <span>{item.category}</span>
      <span className="review-bar"><i style={{ width: `${item.share}%` }} /></span>
      <strong>{item.share}%</strong>
    </li>)}
  </ul> : <p className="form-hint">本周还没有支出记录。</p>}
  <div className="review-focus" aria-label="本周专注分布">
    {review.facts.focusByDay.map((day) => <div key={day.date} className="review-focus-day">
      <span className="review-focus-bar"><i style={{ height: `${Math.min(100, day.minutes)}%` }} /></span>
      <small>{Number(day.date.slice(5, 7))}/{Number(day.date.slice(8))}</small>
    </div>)}
  </div>
  {review.facts.warnings.length ? <ul className="review-warnings">{review.facts.warnings.slice(0, 3).map((text) => <li key={text}>{text}</li>)}</ul> : null}
  {review.warning ? <p className="form-hint">{review.warning}</p> : null}
</section>
```

import 补 `RefreshCw` 和 `useBriefing`。

- [ ] **Step 2: Add styles**

```css
.review-panel { margin: 18px 0; padding: 18px 20px; border: 1px solid var(--rule); border-radius: var(--r); background: var(--sheet); }
.review-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.review-head h2 { margin: 4px 0 0; font-size: 16px; }
.review-actions { display: flex; align-items: center; gap: 12px; }
.review-copy { margin: 10px 0 14px; font-size: 13.5px; line-height: 1.7; color: var(--ink-soft); }
.review-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 0 0 14px; }
.review-stats div { padding: 10px 12px; background: var(--note); border-radius: var(--r-sm); }
.review-stats dt { font-size: 11.5px; color: var(--muted); }
.review-stats dd { margin: 4px 0 2px; font-family: var(--font-figure); font-size: 18px; color: var(--ink); }
.review-stats small { font-size: 11px; color: var(--muted); }
.review-categories { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; }
.review-categories li { display: grid; grid-template-columns: 56px 1fr 40px; align-items: center; gap: 10px; font-size: 12px; color: var(--ink-soft); }
.review-bar { display: block; height: 6px; background: var(--paper-deep); border-radius: 999px; overflow: hidden; }
.review-bar i { display: block; height: 100%; background: var(--brand); }
.review-focus { display: flex; align-items: flex-end; gap: 8px; height: 64px; margin-bottom: 12px; }
.review-focus-day { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; height: 100%; }
.review-focus-bar { flex: 1; width: 100%; display: flex; align-items: flex-end; background: var(--paper-deep); border-radius: 3px; overflow: hidden; }
.review-focus-bar i { display: block; width: 100%; background: var(--steel); }
.review-focus-day small { font-size: 10.5px; color: var(--muted); }
.review-warnings { margin: 0; padding-left: 18px; font-size: 12px; color: var(--warn); }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features/overview/OverviewPage.tsx src/styles.css
git commit -m "feat: 今天页本周复盘面板"
```

---

### Task 11: 助手页快捷提示与文档

**Files:**
- Modify: `src/features/assistant/AssistantPage.tsx`
- Modify: `docs/agent-api.md`
- Modify: `e2e/home.spec.ts`

**Interfaces:**
- Consumes: 已有 `sendAssistantMessage`
- Produces: 两条新快捷提示；文档工具数 44；首页 e2e 断言简报区

- [ ] **Step 1: Add quick prompts**

`quickPrompts` 末尾追加：

```ts
{ label: '今天简报', hint: '一次看完今天的重点', text: '用 day_brief 给我今天的简报。' },
{ label: '这周复盘', hint: '花费、专注和安排', text: '用 week_review 复盘我这周的花费、专注和安排。' },
```

- [ ] **Step 2: Update docs**

`docs/agent-api.md` 工具表：

- 标题「工具表（40 个）」改为「工具表（44 个）」。
- 表格在 `day_overview` 之前插入四行：

```md
| `day_brief` | 只读 | 今日简报：安排、下一项、倒计时、花费、专注与预警 |
| `week_review` | 只读 | 本周复盘：与上周对比、分类占比、专注分布、预警 |
| `ledger_insights` | 只读 | 近 7–90 天支出、分类占比、周期对比、异常单笔 |
| `focus_insights` | 只读 | 近 7–90 天专注总量、每日分布、连续天数、时段习惯 |
```

- 在「内置助手」章节末尾加一小节：

```md
### 简报与复盘

首页「今日简报」和「今天」页「本周复盘」由电脑网关的 `GET /api/assistant/briefing?scope=day|week` 提供。数据用确定性代码计算；模型只负责润色。模型未配置、超时或隐私模式冲突时自动降级为规则文案，`degraded` 为 `true`。`fresh=1` 跳过 10 分钟缓存。
```

- [ ] **Step 3: Add e2e assertion**

`e2e/home.spec.ts` 首个用例中，在 `await expect(page.getByRole('heading', { level: 1 })).toHaveText('今天，顺手就好。');` 之后加：

```ts
const brief = page.getByRole('region', { name: '今日简报' });
await expect(brief).toBeVisible();
await expect(brief).toContainText('件安排');
```

- [ ] **Step 4: Run the full suites**

Run: `npx tsc --noEmit && npx vitest run && node --test local-sync/*.test.mjs`
Expected: 前端全过；网关 71/72（`agentGateway.test.mjs:152` 为已知历史失败，不动）

- [ ] **Step 5: Commit**

```bash
git add src/features/assistant/AssistantPage.tsx docs/agent-api.md e2e/home.spec.ts
git commit -m "feat: 助手快捷提示与简报文档"
```
