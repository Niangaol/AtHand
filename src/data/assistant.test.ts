import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayError, gatewayLogin } from './gateway';
import { getAssistantSettings, saveAssistantSettings, sendAssistantMessage, testAssistant } from './assistant';

const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const requests: { url: string; init?: RequestInit }[] = [];
function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    return handler(url, init);
  }));
}
const login = (url: string) => url.endsWith('/api/login') ? reply({ ok: true, token: 'session-token', expiresAt: Date.now() + 3600_000 }) : null;
const settings = { ok: true, baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen', hasApiKey: true, updatedAt: '2026-11-21T03:00:00.000Z' };

beforeEach(() => { localStorage.clear(); requests.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('assistant client', () => {
  it('reads settings without an API key field', async () => {
    mockFetch((url) => login(url) ?? reply(settings));
    await gatewayLogin('http://gateway.test', 'password123');
    const value = await getAssistantSettings();
    expect(value).toMatchObject({ baseUrl: settings.baseUrl, model: 'qwen', hasApiKey: true });
    expect('apiKey' in value).toBe(false);
    expect(new Headers(requests.at(-1)?.init?.headers).get('Authorization')).toBe('Bearer session-token');
  });

  it('saves provider settings and tests the model service', async () => {
    mockFetch((url, init) => login(url) ?? (init?.method === 'PUT' ? reply({ ...settings, hasApiKey: false }) : reply({ ok: true, result: { ok: true, models: ['qwen'], modelFound: true, message: 'ok' } })));
    await gatewayLogin('http://gateway.test', 'password123');
    const saved = await saveAssistantSettings({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen', apiKey: '' });
    expect(saved.hasApiKey).toBe(false);
    const put = requests.find((request) => request.init?.method === 'PUT');
    expect(JSON.parse(String(put?.init?.body))).toEqual({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen', apiKey: '' });
    const tested = await testAssistant();
    expect(tested).toMatchObject({ ok: true, modelFound: true });
  });

  it('sends a conversation and parses tool traces', async () => {
    mockFetch((url, init) => login(url) ?? (init?.method === 'POST' ? reply({ ok: true, reply: '已经安排好了。', trace: [{ tool: 'schedule_create', arguments: { title: '复习' }, ok: true, summary: '复习' }] }) : reply(settings)));
    await gatewayLogin('http://gateway.test', 'password123');
    const result = await sendAssistantMessage([{ role: 'user', content: '安排复习' }]);
    expect(result.reply).toBe('已经安排好了。');
    expect(result.trace[0]).toMatchObject({ tool: 'schedule_create', ok: true });
    const post = requests.find((request) => request.url.endsWith('/api/assistant/chat') && request.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toEqual({ messages: [{ role: 'user', content: '安排复习' }] });
  });

  it('surfaces the provider error message', async () => {
    mockFetch((url) => login(url) ?? reply({ ok: false, error: 'provider_not_configured', message: '还没有配置模型。' }, 409));
    await gatewayLogin('http://gateway.test', 'password123');
    await expect(sendAssistantMessage([{ role: 'user', content: '你好' }])).rejects.toBeInstanceOf(GatewayError);
    await expect(sendAssistantMessage([{ role: 'user', content: '你好' }])).rejects.toMatchObject({ code: 'provider_not_configured', message: '还没有配置模型。' });
  });
});
