import { afterEach, describe, expect, it, vi } from 'vitest';
import { askHdu, HduError, resetHduSession } from './hduClient';

const password = 'a'.repeat(32);
const reply = { request_id: 'r', state: 'COMPLETED', route: 'timetable_today', text: '今天 3 节课', sources: [], notices: [], warnings: [], is_demo: false, truncated: false };
const csrf = 'c'.repeat(32);

function mockFetch(handlers: { login?: () => Response; messages?: () => Response }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/login')) return handlers.login?.() ?? Response.json({ csrf_token: csrf, mode: 'demo', capabilities: { personal_queries: true } });
    return handlers.messages?.() ?? Response.json(reply);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); resetHduSession(); });

describe('HDU helper client', () => {
  it('logs in, keeps the cookie, and forwards the csrf token', async () => {
    const fetchMock = mockFetch({});
    const answer = await askHdu({ password, text: '今天有什么课' });
    expect(answer).toMatchObject({ text: '今天 3 节课', route: 'timetable_today', isDemo: false });
    const messageInit = fetchMock.mock.calls[1][1]!;
    expect(new Headers(messageInit.headers).get('X-CSRF-Token')).toBe(csrf);
    expect(JSON.parse(String(messageInit.body))).toMatchObject({ text: '今天有什么课' });
  });
  it('reuses the session instead of logging in for every question', async () => {
    const fetchMock = mockFetch({});
    await askHdu({ password, text: '第一问' });
    await askHdu({ password, text: '第二问' });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/login'))).toHaveLength(1);
  });
  it('reports a wrong access password without sending a question', async () => {
    const fetchMock = mockFetch({ login: () => Response.json({ detail: '口令无效' }, { status: 401 }) });
    await expect(askHdu({ password, text: '课表' })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not retry duplicate or timed-out questions', async () => {
    mockFetch({ messages: () => Response.json({ detail: 'duplicate' }, { status: 409 }) });
    await expect(askHdu({ password, text: '课表' })).rejects.toMatchObject({ code: 'duplicate' });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
  it.each([[429, 'busy'], [504, 'server_timeout'], [403, 'forbidden']])('maps status %s', async (status, code) => {
    mockFetch({ messages: () => Response.json({ detail: 'x' }, { status }) });
    await expect(askHdu({ password, text: '课表' })).rejects.toBeInstanceOf(HduError);
    await expect(askHdu({ password, text: '课表' })).rejects.toMatchObject({ code });
  });
  it('rejects a malformed answer instead of rendering it', async () => {
    mockFetch({ messages: () => Response.json({ ok: true }) });
    await expect(askHdu({ password, text: '课表' })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('never logs the access password', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetch({ messages: () => Response.json({ detail: 'x' }, { status: 500 }) });
    await askHdu({ password, text: '课表' }).catch(() => undefined);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(password);
    spy.mockRestore();
  });
});
