import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it } from 'vitest';
import { App } from '../../app/App';
import { RecordsProvider } from '../../data/RecordsProvider';
import { STORAGE_KEY } from '../../data/storage';

beforeEach(() => localStorage.clear());
it('saves a custom conversion rate and requires confirmation before clearing examples', async () => {
  render(<MemoryRouter initialEntries={['/settings']}><RecordsProvider today="2026-11-20"><App /></RecordsProvider></MemoryRouter>);
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('换算时薪（元/小时）'));
  await user.type(screen.getByLabelText('换算时薪（元/小时）'), '25');
  await user.click(screen.getByRole('button', { name: '保存时薪' }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings.hourlyRateCents).toBe(2500);
  await user.click(screen.getByRole('button', { name: '清空示例数据' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '取消' }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).records.length).toBeGreaterThan(0);
  await user.click(screen.getByRole('button', { name: '清空示例数据' }));
  await user.click(screen.getByRole('button', { name: '确认清空示例' }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).records).toEqual([]);
  expect(await screen.findByText('本机账本')).toBeInTheDocument();
});
