import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { App } from '../../app/App';
import { RecordsProvider } from '../../data/RecordsProvider';
import { createInitialState } from '../../data/storage';

it('shows monthly totals and an empty adjacent month', async () => {
  const initialState = createInitialState('2026-11-20');
  render(<MemoryRouter initialEntries={['/monthly']}><RecordsProvider today="2026-11-20" initialState={initialState}><App /></RecordsProvider></MemoryRouter>);
  expect(screen.getByText('本月净剩')).toBeInTheDocument();
  expect(screen.getByText('¥ 119.50')).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: '上个月' }));
  expect(screen.getByText('这一页，还是空白的')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '月度明细' })).queryByText('奶茶店排班')).not.toBeInTheDocument();
});
