import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearGatewaySession, gatewayFetch, gatewayLogin, gatewayToken, normalizeGatewayUrl } from './gateway';

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
});
