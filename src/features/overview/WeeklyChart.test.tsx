import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { WeeklyChart } from './WeeklyChart';
import type { DayPoint } from '../../domain/chart';

/** 2026-11-16 是周一，与 OverviewPage 用 summarize() 生成的周数据同序 */
function week(overrides: Partial<DayPoint>[] = []): DayPoint[] {
  return Array.from({ length: 7 }, (_, index) => ({
    date: `2026-11-${String(16 + index).padStart(2, '0')}`,
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
    workMinutes: 0,
    ...(overrides[index] ?? {}),
  }));
}

function renderChart(daily: DayPoint[], today = '2026-11-20', workMinutes = 0) {
  return render(
    <MemoryRouter>
      <WeeklyChart daily={daily} today={today} workMinutes={workMinutes} />
    </MemoryRouter>,
  );
}

describe('WeeklyChart', () => {
  it('exposes seven keyboard read points with Chinese labels', () => {
    const { container } = renderChart(week([{}, {}, { expenseCents: 1850, netCents: -1850 }]));
    const points = Array.from(container.querySelectorAll<HTMLElement>('.chart-day[tabindex="0"]'));
    expect(points).toHaveLength(7);
    expect(points.map((point) => point.getAttribute('aria-label'))).toEqual([
      '周一：收入 0 元，支出 0 元',
      '周二：收入 0 元，支出 0 元',
      '周三：收入 0 元，支出 18.50 元',
      '周四：收入 0 元，支出 0 元',
      '周五：收入 0 元，支出 0 元',
      '周六：收入 0 元，支出 0 元',
      '周日：收入 0 元，支出 0 元',
    ]);
  });

  it('marks today with a vermilion tick and a highlight class', () => {
    const { container } = renderChart(week());
    const marked = container.querySelectorAll('.chart-day.is-today');
    expect(marked).toHaveLength(1);
    expect(marked[0].querySelector('.chart-today-mark')).not.toBeNull();
    expect(marked[0].getAttribute('aria-label')).toBe('周五：收入 0 元，支出 0 元');
  });

  it('puts a real seven row table inside the details', () => {
    const { container } = renderChart(week());
    expect(container.querySelector('.chart-details summary')?.textContent).toBe('看这周的数字');
    expect(container.querySelectorAll('.chart-table thead th')).toHaveLength(5);
    expect(container.querySelectorAll('.chart-table tbody tr')).toHaveLength(7);
    expect(container.querySelectorAll('.chart-table tbody th')).toHaveLength(7);
    expect(container.querySelectorAll('.chart-table tbody td')).toHaveLength(28);
  });

  it('renders an empty week without NaN and with the empty caption', () => {
    const { container } = renderChart(week());
    expect(container.textContent).not.toContain('NaN');
    expect(screen.getByText('本周还没有收支记录')).toBeInTheDocument();
    expect(container.querySelectorAll('.chart-axis')).toHaveLength(5);
  });

  it('opens the detail card on click and closes it with Escape', () => {
    const { container } = renderChart(week([{ incomeCents: 8000, netCents: 8000, workMinutes: 120 }]));
    const points = container.querySelectorAll<HTMLElement>('.chart-day');
    fireEvent.click(points[0]);
    const tip = container.querySelector('.chart-tip');
    expect(tip).not.toBeNull();
    expect(tip?.textContent).toContain('净额');
    expect(tip?.textContent).toContain('2.0 小时');
    fireEvent.keyDown(points[0], { key: 'Escape' });
    expect(container.querySelector('.chart-tip')).toBeNull();
  });

  it('closes the detail card when the pointer leaves the column', () => {
    const { container } = renderChart(week());
    const points = container.querySelectorAll<HTMLElement>('.chart-day');
    fireEvent.mouseOver(points[3]);
    expect(container.querySelector('.chart-tip')).not.toBeNull();
    fireEvent.mouseOut(points[3]);
    expect(container.querySelector('.chart-tip')).toBeNull();
  });

  it('labels only the weekly maximum and today, never bars under 14px', () => {
    const { container } = renderChart(week([
      { incomeCents: 8000, netCents: 8000 },
      { incomeCents: 2000, netCents: 2000 },
      {},
      {},
      { incomeCents: 1500, netCents: 1500 },
    ]));
    const labels = Array.from(container.querySelectorAll('.chart-value')).map((node) => node.textContent);
    expect(labels).toEqual(['80', '15']);
  });

  it('keeps the panel heading, legend, footer hours and ledger link', () => {
    const { container } = renderChart(week(), '2026-11-20', 90);
    expect(container.querySelector('.chart-panel h2')?.textContent).toBe('钱与时间的一周');
    const legend = container.querySelector('.chart-legend');
    expect(legend?.textContent).toContain('收入');
    expect(legend?.textContent).toContain('支出');
    expect(legend?.textContent).toContain('单位：元');
    expect(container.querySelector('.chart-footnote')?.textContent).toContain('本周累计工作 1.5 小时');
    expect(screen.getByRole('link', { name: '查看完整周账单' })).toHaveAttribute('href', '/ledger');
  });
});
