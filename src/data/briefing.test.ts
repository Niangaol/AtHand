import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayError, gatewayLogin } from './gateway';
import { fetchBriefing } from './briefing';

const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const dayFacts = {
  date: '2026-11-23', items: [], next: null, countdowns: [], expenseCents: 0, workMinutes: 0, focusMinutes: 0, activeFocus: null, warnings: [],
};
const okBody = {
  ok: true, scope: 'day', date: '2026-11-23', facts: dayFacts, narrative: '今天没有安排。',
  degraded: false, warning: null, model: 'm', generatedAt: '2026-11-23T08:00:00.000Z',
};

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('briefing client', () => {
  it('requests the scope and parses the response', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/api/login')) return reply({ ok: true, token: 'session-token', expiresAt: Date.now() + 3600_000 });
      return reply(okBody);
    }));
    await gatewayLogin('http://gateway.test', 'password123');
    const value = await fetchBriefing('day', { fresh: true });
    expect(value.narrative).toBe('今天没有安排。');
    expect(value.degraded).toBe(false);
    expect(requests.at(-1)).toContain('/api/assistant/briefing?scope=day');
    expect(requests.at(-1)).toContain('fresh=1');
  });

  it('normalises a missing warning and model to null', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/login')) return reply({ ok: true, token: 'session-token', expiresAt: Date.now() + 3600_000 });
      const { warning: _warning, model: _model, ...rest } = okBody;
      return reply(rest);
    }));
    await gatewayLogin('http://gateway.test', 'password123');
    const value = await fetchBriefing('day');
    expect(value.warning).toBeNull();
    expect(value.model).toBeNull();
    expect(value.narrative).toBe('今天没有安排。');
  });

  it('throws a gateway error on bad payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/login')) return reply({ ok: true, token: 'session-token', expiresAt: Date.now() + 3600_000 });
      return reply({ ok: true, scope: 'day' });
    }));
    await gatewayLogin('http://gateway.test', 'password123');
    await expect(fetchBriefing('day')).rejects.toThrow(/格式/);
  });

  it('reports an expired session as a gateway error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/login')) return reply({ ok: true, token: 'session-token', expiresAt: Date.now() + 3600_000 });
      return reply({ ok: false, error: 'unauthorized', message: '登录已失效。' }, 401);
    }));
    await gatewayLogin('http://gateway.test', 'password123');
    await expect(fetchBriefing('day')).rejects.toBeInstanceOf(GatewayError);
    await expect(fetchBriefing('day')).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(fetchBriefing('day')).rejects.toThrow(/登录已失效/);
  });
});
