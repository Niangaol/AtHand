import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../../app/App';
import { RecordsProvider } from '../../data/RecordsProvider';
import { STORAGE_KEY } from '../../data/storage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
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
it('offers an Android APK download in the phone collection settings', () => {
  render(<MemoryRouter initialEntries={['/settings']}><RecordsProvider today="2026-11-23"><App /></RecordsProvider></MemoryRouter>);

  const download = screen.getByRole('link', { name: '下载安卓 APK' });
  expect(download).toHaveAttribute('href', 'https://github.com/Niangaol/AtHand-Releases/releases/latest/download/shunshou.apk');
  expect(download.closest('.setting-row')).toHaveTextContent('手机采集');
});
it('cloud mode shows read-only model info instead of key inputs', async () => {
  localStorage.setItem('shunshou.gateway.url', 'https://demo.qoder.zone/functions/v1/app');
  localStorage.setItem('shunshou.gateway.token', 'cloud-token');
  localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 3600_000));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes('/api/assistant/settings')) {
      return Response.json({ ok: true, baseUrl: 'https://api.test/v1', model: 'm1', hasApiKey: true, privacyMode: 'redact', updatedAt: null, managedBy: 'site' });
    }
    if (url.includes('/api/me')) return Response.json({ ok: true, user: { id: 'u1', username: '甲' } });
    return Response.json({ ok: true, ledger: null, updatedAt: null });
  }));
  render(<MemoryRouter initialEntries={['/settings']}><RecordsProvider today="2026-11-23"><App /></RecordsProvider></MemoryRouter>);

  expect(await screen.findByText('m1')).toBeInTheDocument();
  expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
  expect(screen.getByLabelText('隐私模式')).toBeInTheDocument();
});
