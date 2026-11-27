import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RecordsProvider } from '../../data/RecordsProvider';
import { PlannerProvider } from '../../data/PlannerProvider';
import { CalendarProvider } from '../../data/CalendarProvider';
import { CampusProvider } from '../../data/CampusProvider';
import { OverviewPage } from './OverviewPage';
import { STORAGE_KEY } from '../../data/storage';
import { PLANNER_KEY } from '../../data/plannerStorage';
import { getWeekRange, shiftDate } from '../../domain/dates';
import type { LedgerState } from '../../domain/records';
import type { PlannerState } from '../../domain/planner';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
});

function renderPage() {
  return render(
    <MemoryRouter><RecordsProvider><PlannerProvider><CalendarProvider><CampusProvider>
      <OverviewPage />
    </CampusProvider></CalendarProvider></PlannerProvider></RecordsProvider></MemoryRouter>,
  );
}

const { start } = getWeekRange(new Date().toISOString().slice(0, 10));

it('renders the week review panel with clean empty states and no data', async () => {
  const { container } = renderPage();
  const panel = await screen.findByRole('region', { name: '本周复盘' });
  expect(panel).toBeVisible();
  expect(within(panel).getByText('本周还没有支出记录，记一笔就会出现在这里。')).toBeInTheDocument();
  expect(within(panel).getByText('这周还没有专注记录，去留一段专注时间试试。')).toBeInTheDocument();
  expect(within(panel).getByText('未来一周没有临近的考试或截止日期。')).toBeInTheDocument();
  expect(within(panel).getByText('这周的安排没有冲突，也没有排得过满的日子。')).toBeInTheDocument();
  const days = container.querySelectorAll('.review-focus-day');
  expect(days).toHaveLength(7);
  for (const bar of Array.from(container.querySelectorAll<HTMLElement>('.review-focus-bar i'))) expect(bar.style.height).toBe('0%');
  expect(container.textContent).not.toContain('NaN');
  expect(container.textContent).not.toContain('undefined');
  expect(screen.getByRole('region', { name: '今日安排' })).toBeVisible();
  expect(screen.getByRole('region', { name: '最近倒计时' })).toBeVisible();
  expect(screen.getByRole('region', { name: '今天与本周概览' })).toBeVisible();
  expect(screen.getByText('最近几笔')).toBeInTheDocument();
});

it('renders populated categories, focus bars and countdowns', async () => {
  const ledger: LedgerState = {
    version: 1,
    records: [
      { id: 'e1', date: shiftDate(start, 1), title: '午饭', amountCents: 3200, source: 'manual', type: 'expense', category: '吃饭' },
      { id: 'e2', date: shiftDate(start, 2), title: '公交', amountCents: 500, source: 'manual', type: 'expense', category: '交通' },
    ],
    workplaces: [],
    settings: { hourlyRateCents: 2000 },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  const dayTwo = new Date(`${shiftDate(start, 2)}T09:00:00`).getTime();
  const planner: PlannerState = {
    version: 1, events: [], courseRules: [], countdowns: [{ id: 'c1', title: '交材料', kind: 'document', date: shiftDate(start, 9) }], trips: [], serviceEntries: [],
    preferences: { focusMinutes: 25 }, reminderReceipts: [],
    focusSessions: [{ id: 'f1', task: '写报告', minutes: 50, startedAt: dayTwo, status: 'completed', segments: [{ start: dayTwo, end: dayTwo + 50 * 60_000 }], owner: 'o', epoch: 1 }],
  };
  localStorage.setItem(PLANNER_KEY, JSON.stringify({ version: 1, base: planner, revision: 0, serverId: null, serverUrl: null, entityVersions: {}, pending: [] }));

  const { container } = renderPage();
  const panel = await screen.findByRole('region', { name: '本周复盘' });
  expect(within(panel).getByText('吃饭')).toBeInTheDocument();
  expect(within(panel).getByText('交通')).toBeInTheDocument();
  expect(within(panel).getByText('交材料')).toBeInTheDocument();
  const heights = Array.from(container.querySelectorAll<HTMLElement>('.review-focus-bar i')).map((bar) => bar.style.height);
  // OverviewPage 把 focusByDay 的分钟数直接当百分比用（Math.min(100, Math.max(0, minutes))），
  // 所以 50 分钟的一周就是 50%，不是按当周最大值归一的 100%。
  expect(heights).toEqual(['0%', '0%', '50%', '0%', '0%', '0%', '0%']);
  expect(within(panel).queryByText('本周还没有支出记录，记一笔就会出现在这里。')).toBeNull();
  expect(within(panel).queryByText('这周还没有专注记录，去留一段专注时间试试。')).toBeNull();
  expect(container.textContent).not.toContain('NaN');
});
