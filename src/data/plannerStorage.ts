import { z } from 'zod';
import { applyCommand, commandKey, commandSchema, createPlannerState, plannerSchema } from '../domain/planner';
import type { PlannerCommand } from '../domain/planner';

export const PLANNER_KEY = 'shunshou.planner.v1';
export type PlannerStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const remoteDocumentSchema = z.object({
  state: plannerSchema, revision: z.number().int().nonnegative(), serverId: z.string().min(1).max(160),
  entityVersions: z.record(z.string(), z.number().int().nonnegative()),
}).strict();
export type RemoteDocument = z.infer<typeof remoteDocumentSchema>;
const pendingSchema = z.object({
  operationId: z.string().min(1).max(160), command: commandSchema, at: z.number().int(),
  expectedVersion: z.number().int().nonnegative(), sentRevision: z.number().int().nonnegative().nullable(),
}).strict();
export const envelopeSchema = z.object({
  version: z.literal(1), base: plannerSchema, revision: z.number().int().nonnegative(),
  serverId: z.string().max(160).nullable(), serverUrl: z.string().max(2048).nullable(),
  entityVersions: z.record(z.string(), z.number().int().nonnegative()),
  pending: z.array(pendingSchema).max(10000),
}).strict();
export type PlannerEnvelope = z.infer<typeof envelopeSchema>;
export type PendingOperation = z.infer<typeof pendingSchema>;

export function emptyEnvelope(): PlannerEnvelope {
  return { version: 1, base: createPlannerState(), revision: 0, serverId: null, serverUrl: null, entityVersions: {}, pending: [] };
}
export function projectedState(envelope: PlannerEnvelope) {
  return envelope.pending.reduce((state, op) => envelope.serverId && (op.command.kind === 'focus.start' || op.command.kind === 'focus.control')
    ? state : applyCommand(state, op.command, op.at), envelope.base);
}
export function enqueue(envelope: PlannerEnvelope, command: PlannerCommand, at: number, operationId: string): PlannerEnvelope {
  const parsed = commandSchema.parse(command);
  const key = commandKey(parsed);
  const next = { ...envelope, pending: [...envelope.pending, { operationId, command: parsed, at, expectedVersion: envelope.entityVersions[key] ?? 0, sentRevision: null }] };
  envelopeSchema.parse(next);
  projectedState(next);
  return next;
}
export function loadPlanner(storage: PlannerStorage): { envelope: PlannerEnvelope; raw: string | null; error: string } {
  let raw: string | null = null;
  try {
    raw = storage.getItem(PLANNER_KEY);
    if (raw === null) return { envelope: emptyEnvelope(), raw, error: '' };
    const envelope = envelopeSchema.parse(JSON.parse(raw));
    projectedState(envelope);
    return { envelope, raw, error: '' };
  } catch {
    return { envelope: emptyEnvelope(), raw, error: '生活记录无法读取，已暂停写入。请先下载原始备份，不会覆盖损坏的数据。' };
  }
}
export function savePlanner(storage: PlannerStorage, envelope: PlannerEnvelope, expectedRaw: string | null): string {
  envelopeSchema.parse(envelope);
  projectedState(envelope);
  if (storage.getItem(PLANNER_KEY) !== expectedRaw) throw new Error('其他窗口已修改生活记录，请刷新后重试。');
  const raw = JSON.stringify(envelope);
  storage.setItem(PLANNER_KEY, raw);
  return raw;
}
