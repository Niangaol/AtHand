import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AssistantPage } from './AssistantPage';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('shunshou.gateway.url', 'https://demo.qoder.zone/functions/v1/app');
  localStorage.setItem('shunshou.gateway.token', 'cloud-token');
  localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 3600_000));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes('/api/assistant/settings')) {
      return Response.json({ ok: true, baseUrl: 'https://api.test/v1', model: 'm1', hasApiKey: true, privacyMode: 'redact', updatedAt: null, managedBy: 'site' });
    }
    return Response.json({ ok: true });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('cloud mode renders the composer instead of the gateway notice', async () => {
  render(<MemoryRouter><AssistantPage /></MemoryRouter>);
  expect(await screen.findByLabelText('告诉助手要做什么')).toBeInTheDocument();
  expect(screen.queryByText('云端账号暂不运行助手')).not.toBeInTheDocument();
});
