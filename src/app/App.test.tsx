import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../data/storage';

beforeEach(() => localStorage.clear());
import { App } from './App';
import { RecordsProvider } from '../data/RecordsProvider';
import type { RecordEntry } from '../domain/records';

function renderApp(path = '/', records?: RecordEntry[]) {
  const initialState = createInitialState('2026-11-20');
  if (records) initialState.records = records;
  return render(<MemoryRouter initialEntries={[path]}><RecordsProvider today="2026-11-20" initialState={initialState}><App /></RecordsProvider></MemoryRouter>);
}

describe('application foundation', () => {
  it('labels the example data and provides every core page', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: '把这一周，过得心里有数。' })).toBeInTheDocument();
    expect(screen.getByText('示例模式')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '主导航' });
    for (const name of ['今天', '记一笔', '周账单', '单位管理', '月度汇总', '校园', '设置']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
  });
  it('filters expenses without leaking work records into the list', async () => {
    const user = userEvent.setup();
    renderApp('/ledger');
    await user.click(screen.getByRole('button', { name: '只看支出' }));
    const list = screen.getByRole('region', { name: '账单明细' });
    expect(within(list).getByText('食堂午饭')).toBeInTheDocument();
    expect(within(list).queryByText('奶茶店排班')).not.toBeInTheDocument();
  });
  it('shows an empty week and can return to the example week', async () => {
    const user = userEvent.setup();
    renderApp('/ledger');
    await user.click(screen.getByRole('button', { name: '上一周' }));
    expect(screen.getByText('这一页，还是空白的')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '回到本周' }));
    expect(screen.getAllByText('奶茶店排班').length).toBeGreaterThan(0);
  });
  it('saves a real expense and replaces sample records', async () => {
    const user = userEvent.setup();
    renderApp('/entry');
    await user.click(screen.getByRole('tab', { name: '记支出' }));
    await user.type(screen.getByLabelText('支出金额（元）'), '18.50');
    await user.type(screen.getByLabelText('备注（选填）'), '真实午饭');
    await user.click(screen.getByRole('button', { name: '保存记录' }));
    expect(await screen.findByText('真实午饭')).toBeInTheDocument();
    expect(screen.queryByText('奶茶店排班')).not.toBeInTheDocument();
    expect(screen.getByText('本机账本')).toBeInTheDocument();
  });
  it('creates a unit from the empty state', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/workplaces']}><RecordsProvider today="2026-11-20" initialState={{ ...createInitialState('2026-11-20', false) }}><App /></RecordsProvider></MemoryRouter>);
    expect(screen.getByText('还没有兼职单位')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增单位' }));
    await user.type(screen.getByLabelText('单位名称'), '图书馆');
    await user.type(screen.getByLabelText('单位时薪（元）'), '25');
    await user.click(screen.getByRole('button', { name: '保存单位' }));
    expect(screen.getByRole('heading', { name: '图书馆' })).toBeInTheDocument();
  });
  it('renders empty data with zero totals', () => {
    renderApp('/', []);
    expect(screen.getByTestId('week-net')).toHaveTextContent('0.00');
    expect(screen.getByText('这一页，还是空白的')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
  it('recovers unknown URLs with a working home link', async () => {
    const user = userEvent.setup();
    renderApp('/not-found');
    await user.click(screen.getByRole('link', { name: '回到今天' }));
    expect(screen.getByRole('heading', { name: '把这一周，过得心里有数。' })).toBeInTheDocument();
  });
});
