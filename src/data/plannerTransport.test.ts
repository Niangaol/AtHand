import { afterEach, expect, it, vi } from 'vitest';
import { createGatewayPlannerTransport } from './plannerSync';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
it('clears a rejected session so background synchronization pauses after 401', async () => {
  localStorage.setItem('shunshou.gateway.url', 'https://a.example.com');
  localStorage.setItem('shunshou.gateway.token', 'revoked');
  localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 600000));
  let requests = 0;
  vi.stubGlobal('fetch', async () => { requests++; return Response.json({}, { status: 401 }); });
  const transport = createGatewayPlannerTransport();
  await expect(transport.read()).rejects.toThrow(/登录/);
  expect(localStorage.getItem('shunshou.gateway.token')).toBeNull();
  await expect(transport.read()).rejects.toThrow();
  expect(requests).toBe(1);
});
it('never sends an operation to another gateway after credentials change mid-sync', async () => {
  localStorage.setItem('shunshou.gateway.url', 'https://a.example.com');
  localStorage.setItem('shunshou.gateway.token', 'token-a');
  localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 600000));
  const transport = createGatewayPlannerTransport();
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { requests.push(url); return Response.json({}); });
  localStorage.setItem('shunshou.gateway.url', 'https://b.example.com');
  localStorage.setItem('shunshou.gateway.token', 'token-b');
  await expect(transport.send({ operationId: 'one', baseRevision: 0, command: { kind: 'preferences', focusMinutes: 30 } })).rejects.toThrow(/连接/);
  expect(requests).toEqual([]);
});
