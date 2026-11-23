import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAuthHeaders, clearGatewayAccountChanged, clearGatewaySession, gatewayAccountChanged, gatewayFetch, gatewayLogin, gatewayRegister, gatewayToken, gatewayUsername, normalizeGatewayUrl } from './gateway';

afterEach(() => {
  clearGatewaySession();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('gateway client', () => {
  it('normalizes addresses and rejects unsupported schemes', () => {
    expect(normalizeGatewayUrl(' https://abc.trycloudflare.com/ ')).toBe('https://abc.trycloudflare.com');
    expect(normalizeGatewayUrl('')).toBe('');
    expect(() => normalizeGatewayUrl('ftp://host')).toThrow('http://');
    expect(() => normalizeGatewayUrl('abc.trycloudflare.com')).toThrow();
  });

  it('stores a token on login and sends it on later requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, token: 't'.repeat(43), expiresAt: Date.now() + 3600_000 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const session = await gatewayLogin('https://abc.trycloudflare.com/', 'password123');
    expect(session.token).toBe('t'.repeat(43));
    expect(gatewayToken()).toBe(session.token);
    await gatewayFetch('/api/ledger');
    const headers = fetchMock.mock.calls[1][1].headers as Headers;
    expect(headers.get('Authorization')).toBe(`Bearer ${session.token}`);
    localStorage.clear();
  });

  it('maps a wrong password to a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'invalid_password' }), { status: 401 })));
    await expect(gatewayLogin('http://127.0.0.1:18787', 'wrongpassword')).rejects.toThrow('口令不对');
    expect(gatewayToken()).toBe('');
  });

  it('logs in with an account and flags account switches', async () => {
    const now = Date.now() + 3600_000;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, token: 'a'.repeat(43), expiresAt: now, user: { id: 'u1', username: '甲同学' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, token: 'b'.repeat(43), expiresAt: now, user: { id: 'u2', username: '乙同学' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, token: 'c'.repeat(43), expiresAt: now, user: { id: 'u3', username: '丙同学' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await gatewayLogin('https://cloud.test/functions/v1/app', 'password123', '甲同学');
    expect(gatewayUsername()).toBe('甲同学');
    expect(gatewayAccountChanged()).toBe(false);
    clearGatewaySession();
    await gatewayLogin('https://cloud.test/functions/v1/app', 'password123', '乙同学');
    expect(gatewayAccountChanged()).toBe(true);
    clearGatewayAccountChanged();
    expect(gatewayAccountChanged()).toBe(false);
    const registered = await gatewayRegister('https://cloud.test/functions/v1/app', '丙同学', 'password123');
    expect(registered.user?.username).toBe('丙同学');
  });

  it('sends both auth headers to cloud and only Authorization to local gateway', () => {
    // 云端网关剥离 Authorization，只认 X-Shunshou-Session；本机网关相反。
    const cloud = applyAuthHeaders(new Headers(), 'https://x.test/functions/v1/app', 'tok-1');
    expect(cloud.get('Authorization')).toBe('Bearer tok-1');
    expect(cloud.get('X-Shunshou-Session')).toBe('tok-1');

    const local = applyAuthHeaders(new Headers(), 'http://127.0.0.1:18787', 'tok-2');
    expect(local.get('Authorization')).toBe('Bearer tok-2');
    expect(local.get('X-Shunshou-Session')).toBeNull();
  });
});
