import { commandKey } from '../domain/planner';
import type { PlannerCommand } from '../domain/planner';
import { remoteDocumentSchema } from './plannerStorage';
import type { PlannerEnvelope, RemoteDocument } from './plannerStorage';
import { clearGatewaySession, gatewayUrl, gatewayToken } from './gateway';

export type PlannerTransport = {
  read: () => Promise<RemoteDocument>;
  send: (op: { operationId: string; baseRevision: number; command: PlannerCommand }) => Promise<RemoteDocument & { appliedRevision: number }>;
};
export class PlannerSyncError extends Error {
  code: string;
  constructor(message: string, code: string) { super(message); this.code = code; }
}
async function responseBody(response: Response) {
  if (response.status === 401) { clearGatewaySession(); throw new PlannerSyncError('登录已失效，生活记录保留在本机，请重新登录。', 'unauthorized'); }
  if (response.status === 409) throw new PlannerSyncError('生活记录存在冲突，请保留备份并选择版本。', 'conflict');
  if (!response.ok) throw new PlannerSyncError('服务未接受操作，本机内容已保留。', 'rejected');
  return response.json();
}
export function createGatewayPlannerTransport(): PlannerTransport {
  const base = gatewayUrl();
  const token = gatewayToken();
  const request = async (path: string, init: RequestInit = {}) => {
    if (!token || gatewayUrl() !== base || gatewayToken() !== token) throw new PlannerSyncError('连接已改变，请重新同步；不会向其他服务器发送旧操作。', 'server_changed');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (/\/functions\/v1\/app$/.test(base)) headers.set('X-Shunshou-Session', token);
    const response = await fetch(`${base}${path}`, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (gatewayUrl() !== base || gatewayToken() !== token) throw new PlannerSyncError('连接已改变，旧请求确认保留至重新连接后处理。', 'server_changed');
    return responseBody(response);
  };
  return {
    read: async () => remoteDocumentSchema.parse(await request('/api/planner')),
    send: async (op) => {
      const body = await request('/api/planner/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(op) });
      const { appliedRevision, ...doc } = body;
      if (!Number.isSafeInteger(appliedRevision) || appliedRevision < 1) throw new Error('同步确认格式无效。');
      return { ...remoteDocumentSchema.parse(doc), appliedRevision };
    },
  };
}

export async function syncPlanner(initial: PlannerEnvelope, url: string, transport: PlannerTransport, persist: (next: PlannerEnvelope) => void | Promise<void>): Promise<PlannerEnvelope> {
  let envelope = structuredClone(initial);
  if (envelope.serverUrl !== null && envelope.serverUrl !== url) throw new PlannerSyncError('服务器地址已更换，请先备份并确认切换。', 'server_changed');
  if (!envelope.serverId && envelope.base.focusSessions.some((s) => s.status === 'running' || s.status === 'paused')) throw new PlannerSyncError('请先结束本机专注，再连接服务器。', 'local_focus');
  let remote = await transport.read();
  if (envelope.serverId && envelope.serverId !== remote.serverId) throw new PlannerSyncError('服务器身份已变化，不会自动上传旧数据。', 'server_changed');
  envelope = { ...envelope, serverId: remote.serverId, serverUrl: url };
  await persist(envelope);
  let races = 0;
  while (envelope.pending.length > 0) {
    const op = envelope.pending[0];
    const key = commandKey(op.command);
    if (op.sentRevision === null) {
      if ((remote.entityVersions[key] ?? 0) !== op.expectedVersion) throw new PlannerSyncError('同一条生活记录存在冲突，本机修改已保留。', 'conflict');
      envelope = { ...envelope, pending: [{ ...op, sentRevision: remote.revision }, ...envelope.pending.slice(1)] };
      await persist(envelope);
    }
    try {
      const result = await transport.send({ operationId: op.operationId, baseRevision: envelope.pending[0].sentRevision!, command: op.command });
      if (result.serverId !== envelope.serverId) throw new PlannerSyncError('服务器身份已变化。', 'server_changed');
      const { appliedRevision, ...doc } = result;
      remote = doc;
      const pending = envelope.pending.slice(1).map((item) => commandKey(item.command) === key && item.expectedVersion === op.expectedVersion
        ? { ...item, expectedVersion: appliedRevision } : item);
      envelope = { ...envelope, base: doc.state, revision: doc.revision, entityVersions: doc.entityVersions, pending };
      await persist(envelope);
      races = 0;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'conflict' && races++ < 3) {
        remote = await transport.read();
        if (remote.serverId !== envelope.serverId) throw new PlannerSyncError('服务器身份已变化。', 'server_changed');
        envelope = { ...envelope, pending: [{ ...envelope.pending[0], sentRevision: null }, ...envelope.pending.slice(1)] };
        await persist(envelope);
      } else throw error;
    }
  }
  envelope = { ...envelope, base: remote.state, revision: remote.revision, entityVersions: remote.entityVersions };
  await persist(envelope);
  return envelope;
}
