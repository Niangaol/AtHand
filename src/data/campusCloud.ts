import { z } from 'zod';
import { GatewayError, clearGatewaySession, gatewayFetch, isGatewayConnected } from './gateway';

const pendingSchema = z.looseObject({
  userCode: z.string(),
  verificationUri: z.string(),
  verificationUriComplete: z.string(),
  expiresAt: z.number(),
  interval: z.number(),
  scopes: z.array(z.string()),
});

const statusSchema = z.looseObject({
  ok: z.literal(true),
  connected: z.boolean(),
  expired: z.boolean(),
  scopes: z.array(z.string()),
  patId: z.string(),
  connectedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  deviceName: z.string(),
  pending: pendingSchema.nullable(),
  status: z.string().optional(),
});

export type CampusCloudPending = z.infer<typeof pendingSchema>;
export type CampusCloudStatus = z.infer<typeof statusSchema>;

const paramSchema = z.looseObject({
  name: z.string(),
  in: z.string(),
  required: z.boolean(),
  type: z.string(),
  format: z.string().optional(),
});
const bodyFieldSchema = z.looseObject({
  name: z.string(),
  required: z.boolean(),
  type: z.string(),
  format: z.string().optional(),
});
const operationSchema = z.looseObject({
  id: z.string(),
  domain: z.string(),
  command: z.string(),
  summary: z.string(),
  description: z.string(),
  method: z.string(),
  path: z.string(),
  auth: z.string(),
  scopes: z.array(z.string()),
  risk: z.string(),
  sensitive: z.boolean(),
  requiresUser: z.boolean(),
  params: z.array(paramSchema),
  body: z.looseObject({ contentType: z.string(), fields: z.array(bodyFieldSchema) }).nullable(),
});
const catalogSchema = z.looseObject({
  ok: z.literal(true),
  operations: z.array(operationSchema),
  scopes: z.array(z.string()),
  domains: z.array(z.looseObject({ name: z.string(), label: z.string(), operations: z.number() })),
});

export type CampusParameter = z.infer<typeof paramSchema>;
export type CampusBodyField = z.infer<typeof bodyFieldSchema>;
export type CampusOperation = z.infer<typeof operationSchema>;
export type CampusCatalog = z.infer<typeof catalogSchema>;

const resultSchema = z.looseObject({
  ok: z.boolean(),
  status: z.number().optional(),
  operationId: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  data: z.unknown().optional(),
  envelope: z.unknown().optional(),
  missingScopes: z.array(z.string()).optional(),
  risk: z.string().optional(),
  requestId: z.string().nullable().optional(),
});
export type CampusResult = z.infer<typeof resultSchema>;

export type CampusRunInput = {
  operationId: string;
  path?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  confirm?: boolean;
  idempotencyKey?: string;
};

async function campusFetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  if (!isGatewayConnected()) throw new GatewayError('还没有连接后端，请先到设置连接云端后端。', 'not_connected');
  const response = await gatewayFetch(path, init);
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.status === 401) {
    clearGatewaySession();
    throw new GatewayError('登录已失效，请重新连接后端。', 'unauthorized');
  }
  if (!response.ok || !body || typeof body !== 'object') {
    const message = typeof body?.message === 'string' ? body.message : '云端校园服务返回异常。';
    const code = typeof body?.error === 'string' ? body.error : 'campus_error';
    throw new GatewayError(message, code);
  }
  return body;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new GatewayError(message, 'invalid_response');
  return parsed.data;
}

export async function getCampusStatus(): Promise<CampusCloudStatus> {
  return parseOrThrow(statusSchema, await campusFetch('/api/campus/status'), '云端校园状态格式无效。');
}

export async function getCampusCatalog(): Promise<CampusCatalog> {
  return parseOrThrow(catalogSchema, await campusFetch('/api/campus/catalog'), '云端校园操作清单格式无效。');
}

export async function startCampusAuth(scopes?: string[]): Promise<CampusCloudPending & { ok: true }> {
  const body = await campusFetch('/api/campus/auth/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scopes ? { scopes } : {}),
  });
  const started = parseOrThrow(pendingSchema.extend({ ok: z.literal(true) }), body, '授权链接格式无效。');
  return started;
}

export async function pollCampusAuth(): Promise<CampusCloudStatus> {
  return parseOrThrow(statusSchema, await campusFetch('/api/campus/auth/poll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }), '授权结果格式无效。');
}

export async function cancelCampusAuth(): Promise<CampusCloudStatus> {
  return parseOrThrow(statusSchema, await campusFetch('/api/campus/auth/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }), '授权取消结果格式无效。');
}

export async function logoutCampusCloud(localOnly = false): Promise<CampusCloudStatus> {
  return parseOrThrow(statusSchema, await campusFetch('/api/campus/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localOnly }),
  }), '断开校园授权的返回格式无效。');
}

export async function runCampusOperation(input: CampusRunInput): Promise<CampusResult> {
  return parseOrThrow(resultSchema, await campusFetch('/api/campus/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }), '校园操作返回格式无效。');
}