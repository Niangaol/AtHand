import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayError, gatewayLogin } from './gateway';
import { createAgentToken, listAgentAudit, listAgentTokens, revokeAgentToken } from './agentTokens';

const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const agent = { id: 'agent-1', name: '只读助手', scope: 'read', createdAt: '2026-11-21T02:00:00.000Z', lastUsedAt: null, expiresAt: 1800000000000 };
const requests: { url: string; init?: RequestInit }[] = [];

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    return handler(url, init);
  }));
}
const login = (url: string) => url.endsWith('/api/login')
  ? reply({ ok: true, token: 'session-token', expiresAt: Date.now() + 3600_000 })
  : null;

beforeEach(() => { localStorage.clear(); requests.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('agent token client', () => {
  it('lists tokens with the web session token', async () => {
    mockFetch((url) => login(url) ?? reply({ ok: true, agents: [agent] }));
    await gatewayLogin('http://gateway.test', 'password123');
    const tokens = await listAgentTokens();
    expect(tokens).toEqual([agent]);
    expect(requests.at(-1)?.url).toBe('http://gateway.test/api/agent/tokens');
    expect(new Headers(requests.at(-1)?.init?.headers).get('Authorization')).toBe('Bearer session-token');
  });

  it('creates a scoped token and revokes it by encoded id', async () => {
    mockFetch((url, init) => login(url) ?? (init?.method === 'POST'
      ? reply({ ok: true, token: 'secret-token', agent: { ...agent, id: 'a/b', scope: 'write' } })
      : reply({ ok: true })));
    await gatewayLogin('http://gateway.test', 'password123');
    const created = await createAgentToken('可写助手', 'write');
    expect(created.token).toBe('secret-token');
    const post = requests.find((request) => request.url.endsWith('/api/agent/tokens') && request.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ name: '可写助手', scope: 'write' });
    await revokeAgentToken('a/b');
    expect(requests.at(-1)?.url).toBe('http://gateway.test/api/agent/tokens/a%2Fb');
    expect(requests.at(-1)?.init?.method).toBe('DELETE');
  });

  it('parses recent agent actions', async () => {
    mockFetch((url) => login(url) ?? reply({ ok: true, entries: [{ at: '2026-11-21T02:05:00.000Z', actor: '可写助手', actorKind: 'agent', tool: 'schedule_create', summary: '{"title":"复习"}', ok: true, error: null, revision: 3 }] }));
    await gatewayLogin('http://gateway.test', 'password123');
    const entries = await listAgentAudit();
    expect(entries[0]).toMatchObject({ tool: 'schedule_create', ok: true, actor: '可写助手' });
  });

  it('surfaces a login that cannot manage tokens', async () => {
    mockFetch((url) => login(url) ?? reply({ ok: false, error: 'forbidden' }, 403));
    await gatewayLogin('http://gateway.test', 'password123');
    await expect(listAgentTokens()).rejects.toBeInstanceOf(GatewayError);
    await expect(listAgentTokens()).rejects.toMatchObject({ code: 'forbidden' });
  });
});
