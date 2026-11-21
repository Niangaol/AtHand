import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PlannerProvider } from '../../data/PlannerProvider';
import { CampusPage } from './CampusPage';
import { resetHduSession } from './hduClient';

const password = 'p'.repeat(32);
const text = '今天第 1-2 节 高等数学，第 3-4 节 大学物理。';

function stubHdu(options: { demo?: boolean; warnings?: string[]; status?: number } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/login')) return Response.json({ csrf_token: 'c'.repeat(32), mode: 'demo' });
    if (options.status) return Response.json({ detail: '口令无效' }, { status: options.status });
    return Response.json({
      request_id: 'r', state: 'COMPLETED', route: 'timetable_today', text,
      sources: [{ title: '杭电助手课表', publisher: 'HDU-Help', url: 'https://example.com/timetable' }],
      notices: [], warnings: options.warnings ?? [], is_demo: options.demo ?? false, truncated: false,
    });
  }));
}
afterEach(() => { vi.unstubAllGlobals(); resetHduSession(); sessionStorage.clear(); });

it('asks the local HDU helper and surfaces demo data and warnings', async () => {
  stubHdu({ demo: true, warnings: ['hduhelp_cli_missing'] });
  render(<MemoryRouter><PlannerProvider><CampusPage /></PlannerProvider></MemoryRouter>);
  await userEvent.setup().type(screen.getByLabelText('HDU-Helper 访问口令'), password);
  await userEvent.setup().click(screen.getByRole('button', { name: '今天有什么课' }));
  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(screen.getByText('演示数据')).toBeInTheDocument();
  expect(screen.getByText('hduhelp_cli_missing')).toBeInTheDocument();
  expect(screen.getByText(/timetable_today/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '杭电助手课表' })).toHaveAttribute('href', 'https://example.com/timetable');
  expect(localStorage.getItem('shunshou.hduPassword')).toBeNull();
  expect(sessionStorage.getItem('shunshou.hduPassword')).toBe(password);
});

it('shows an actionable error for a wrong password', async () => {
  stubHdu({ status: 401 });
  render(<MemoryRouter><PlannerProvider><CampusPage /></PlannerProvider></MemoryRouter>);
  await userEvent.setup().type(screen.getByLabelText('HDU-Helper 访问口令'), password);
  await userEvent.setup().click(screen.getByRole('button', { name: '今天有什么课' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('口令无效');
});

it('states the campus boundary and never promises submission', () => {
  render(<MemoryRouter><PlannerProvider><CampusPage /></PlannerProvider></MemoryRouter>);
  expect(screen.getByText(/仍只监听本机/)).toBeInTheDocument();
  expect(screen.getByText(/不代提交/)).toBeInTheDocument();
});
