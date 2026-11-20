import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it } from 'vitest';
import { App } from '../../app/App';
import { RecordsProvider } from '../../data/RecordsProvider';

beforeEach(() => localStorage.clear());
it('keeps the completed form intact when local saving fails', async () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  render(<MemoryRouter initialEntries={['/entry']}><RecordsProvider today="2026-11-20" storage={storage}><App /></RecordsProvider></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: '记支出' }));
  await user.type(screen.getByLabelText('支出金额（元）'), '30');
  await user.click(screen.getByRole('button', { name: '保存记录' }));
  expect(screen.getByLabelText('支出金额（元）')).toHaveValue('30');
  expect(screen.getByTestId('entry-error')).toHaveTextContent('保存失败');
  expect(screen.getByRole('button', { name: '保存记录' })).toBeEnabled();
});
