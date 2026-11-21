import { z } from 'zod';
import { GatewayError, gatewayFetch } from './gateway';

const settingsSchema = z.object({
  ok: z.literal(true), baseUrl: z.string(), model: z.string(), hasApiKey: z.boolean(), updatedAt: z.string().nullable(),
}).strict();
export type AssistantSettings = Omit<z.infer<typeof settingsSchema>, 'ok'>;

const traceSchema = z.object({
  tool: z.string(), arguments: z.unknown().optional(), ok: z.boolean(), summary: z.string().optional(), error: z.string().optional(), message: z.string().optional(),
}).strict();
export type AssistantTrace = z.infer<typeof traceSchema>;

const testSchema = z.object({
  ok: z.literal(true),
  result: z.object({ ok: z.boolean(), models: z.array(z.string()).optional(), modelFound: z.boolean().nullable().optional(), message: z.string().optional(), status: z.number().optional() }).strict(),
}).strict();

async function read(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null);
  if (response.status === 401) throw new GatewayError('登录已失效，请重新连接电脑。', 'unauthorized');
  if (response.status === 403) throw new GatewayError('这个操作需要在网页里登录后完成。', 'forbidden');
  if (!response.ok || !value || value.ok !== true) {
    const message = typeof value?.message === 'string' ? value.message : '助手服务返回异常。';
    const code = typeof value?.error === 'string' ? value.error : 'assistant_error';
    throw new GatewayError(message, code);
  }
  return value;
}

export async function getAssistantSettings(): Promise<AssistantSettings> {
  const parsed = settingsSchema.safeParse(await read(await gatewayFetch('/api/assistant/settings')));
  if (!parsed.success) throw new GatewayError('电脑返回的助手设置格式无效。', 'invalid_response');
  return { baseUrl: parsed.data.baseUrl, model: parsed.data.model, hasApiKey: parsed.data.hasApiKey, updatedAt: parsed.data.updatedAt };
}

export type AssistantSettingsInput = { baseUrl?: string; model?: string; apiKey?: string; clearApiKey?: boolean };
export async function saveAssistantSettings(input: AssistantSettingsInput): Promise<AssistantSettings> {
  const parsed = settingsSchema.safeParse(await read(await gatewayFetch('/api/assistant/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })));
  if (!parsed.success) throw new GatewayError('电脑返回的助手设置格式无效。', 'invalid_response');
  return { baseUrl: parsed.data.baseUrl, model: parsed.data.model, hasApiKey: parsed.data.hasApiKey, updatedAt: parsed.data.updatedAt };
}

export type AssistantTestResult = z.infer<typeof testSchema>['result'];
export async function testAssistant(): Promise<AssistantTestResult> {
  const value = await read(await gatewayFetch('/api/assistant/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  const parsed = testSchema.safeParse(value);
  if (!parsed.success) throw new GatewayError('电脑返回的模型检测结果格式无效。', 'invalid_response');
  return parsed.data.result;
}

export async function sendAssistantMessage(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<{ reply: string; trace: AssistantTrace[] }> {
  const value = await read(await gatewayFetch('/api/assistant/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }),
  }));
  const parsed = z.object({ ok: z.literal(true), reply: z.string(), trace: z.array(traceSchema) }).strict().safeParse(value);
  if (!parsed.success) throw new GatewayError('电脑返回的助手回复格式无效。', 'invalid_response');
  return { reply: parsed.data.reply, trace: parsed.data.trace };
}
