import { z } from 'zod';
import { GatewayError, gatewayFetch } from './gateway';

const agentSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(40),
  scope: z.enum(['read', 'write']),
  createdAt: z.string().min(1),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.number().int().positive(),
}).strict();
export type AgentToken = z.infer<typeof agentSchema>;
const auditSchema = z.object({
  at: z.string().min(1),
  actor: z.string(),
  actorKind: z.enum(['session', 'agent']),
  tool: z.string(),
  summary: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  revision: z.number().int().nullable(),
}).strict();
export type AgentAuditEntry = z.infer<typeof auditSchema>;

async function body(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => null);
  if (response.status === 401) throw new GatewayError('登录已失效，请重新连接电脑。', 'unauthorized');
  if (response.status === 403) throw new GatewayError('这个操作需要在网页里登录后完成。', 'forbidden');
  if (!response.ok || !value || value.ok !== true) throw new GatewayError('电脑上的 Agent 接口返回异常。', 'invalid_response');
  return value;
}

export async function listAgentTokens(): Promise<AgentToken[]> {
  const parsed = z.object({ ok: z.literal(true), agents: z.array(agentSchema) }).strict().safeParse(await body(await gatewayFetch('/api/agent/tokens')));
  if (!parsed.success) throw new GatewayError('电脑返回的令牌列表格式无效。', 'invalid_response');
  return parsed.data.agents;
}

export async function createAgentToken(name: string, scope: AgentToken['scope']): Promise<{ token: string; agent: AgentToken }> {
  const response = await gatewayFetch('/api/agent/tokens', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scope }),
  });
  const parsed = z.object({ ok: z.literal(true), token: z.string().min(1), agent: agentSchema }).strict().safeParse(await body(response));
  if (!parsed.success) throw new GatewayError('电脑返回的令牌格式无效。', 'invalid_response');
  return { token: parsed.data.token, agent: parsed.data.agent };
}

export async function revokeAgentToken(id: string): Promise<void> {
  await body(await gatewayFetch(`/api/agent/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export async function listAgentAudit(): Promise<AgentAuditEntry[]> {
  const parsed = z.object({ ok: z.literal(true), entries: z.array(auditSchema) }).strict().safeParse(await body(await gatewayFetch('/api/agent/audit')));
  if (!parsed.success) throw new GatewayError('电脑返回的操作记录格式无效。', 'invalid_response');
  return parsed.data.entries;
}
