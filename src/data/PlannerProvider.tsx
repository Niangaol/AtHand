import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { guardedSave, readGuardedRaw } from './guardedSave';
import { applyCommand, commandKey, plannerSchema } from '../domain/planner';
import type { Entity, PlannerCommand, PlannerState } from '../domain/planner';
import { gatewayUrl, isGatewayConnected } from './gateway';
import { emptyEnvelope, enqueue, envelopeSchema, loadPlanner, PLANNER_KEY, projectedState, savePlanner } from './plannerStorage';
import type { PlannerEnvelope, PlannerStorage } from './plannerStorage';
import { createGatewayPlannerTransport, syncPlanner } from './plannerSync';

type Result = { ok: true } | { ok: false; message: string };
type PlannerContextValue = {
  state: PlannerState; owner: string; busy: boolean; blocked: boolean; error: string; status: string;
  pending: number; raw: string | null; serverBound: boolean;
  dispatch: (command: PlannerCommand, expected?: Entity | null) => Promise<Result>;
  sync: () => Promise<Result>;
  resolve: (choice: 'local' | 'remote') => Promise<Result>;
  restore: (state: PlannerState) => Promise<Result>;
  switchServer: (expectedUrl?: string) => Promise<Result>;
};
const Context = createContext<PlannerContextValue | null>(null);
const browserStorage: PlannerStorage = { getItem: (key) => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) };
const errorMessage = (error: unknown) => error instanceof Error && error.name !== 'ZodError' ? error.message : '内容格式不正确，请检查日期、时长和必填项。';

export function PlannerProvider({ children, storage = browserStorage }: { children: ReactNode; storage?: PlannerStorage }) {
  const [snapshot, setSnapshot] = useState(() => loadPlanner(storage));
  const [owner] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('仅本机；尚未连接电脑');
  const working = useRef(false);
  const syncRef = useRef<() => Promise<Result>>(async () => ({ ok: true }));
  const reload = useCallback(() => setSnapshot(loadPlanner(storage)), [storage]);

  const run = useCallback(async (action: (envelope: PlannerEnvelope, persist: (next: PlannerEnvelope) => Promise<void>) => Promise<void>, recovery = false): Promise<Result> => {
    if (working.current) return { ok: false, message: '生活记录正在保存，请稍候。' };
    working.current = true;
    setBusy(true);
    try {
      if (!navigator.locks) throw new Error('请使用新版浏览器，通过本机地址或HTTPS访问。');
      await navigator.locks.request(PLANNER_KEY, async () => {
        const loaded = loadPlanner(storage);
        if (loaded.error && !recovery) throw new Error(loaded.error);
        let raw = loaded.raw;
        const persist = async (next: PlannerEnvelope) => {
          raw = storage === browserStorage ? await guardedSave(PLANNER_KEY, raw, () => savePlanner(storage, next, raw), recovery) : savePlanner(storage, next, raw);
          setSnapshot({ envelope: next, raw, error: '' });
          window.dispatchEvent(new Event('shunshou-planner-change'));
        };
        await action(loaded.envelope, persist);
      });
      setError('');
      return { ok: true };
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      reload();
      return { ok: false, message };
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, [storage, reload]);

  const sync = useCallback(() => run(async (envelope, persist) => {
    if (!isGatewayConnected()) {
      setStatus(envelope.serverId ? '未登录；本机改动待同步' : '仅本机；尚未连接电脑');
      return;
    }
    setStatus('正在同步生活记录…');
    await syncPlanner(envelope, gatewayUrl(), createGatewayPlannerTransport(), persist);
    setStatus('生活记录已同步');
  }), [run]);
  syncRef.current = sync;

  const dispatch = useCallback((command: PlannerCommand, expected?: Entity | null) => run(async (initial, persist) => {
    if (expected !== undefined && (command.kind === 'put' || command.kind === 'delete')) {
      const id = command.kind === 'delete' ? command.id : (command.value as Entity).id;
      const current = projectedState(initial)[command.collection].find((item) => item.id === id) ?? null;
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('这条记录在编辑期间已被修改或删除，请保留草稿，重新打开记录后再编辑。');
    }
    const isControl = command.kind === 'focus.start' || command.kind === 'focus.control';
    const activeLocal = !initial.serverId && initial.base.focusSessions.some((s) => s.status === 'running' || s.status === 'paused');
    if (isControl && !initial.serverId && (!isGatewayConnected() || activeLocal)) {
      const before = projectedState(initial);
      const after = applyCommand(before, command, Date.now());
      const changed = after.focusSessions.find((s) => s.id === (command as { id: string }).id)!;
      if (changed.status === 'completed' || changed.status === 'cancelled') {
        const base = { ...initial.base, focusSessions: initial.base.focusSessions.filter((s) => s.id !== changed.id) };
        await persist(enqueue({ ...initial, base }, { kind: 'focus.import', value: changed }, Date.now(), crypto.randomUUID()));
      } else {
        const base = { ...initial.base, preferences: after.preferences,
          focusSessions: [...initial.base.focusSessions.filter((s) => s.id !== changed.id), changed] };
        await persist({ ...initial, base });
      }
      setStatus('专注已保存在本机');
      return;
    }
    let envelope = initial;
    if (isControl) {
      if (!isGatewayConnected() || !navigator.onLine) throw new Error('连接电脑后才能控制同步中的专注；当前计时仍会继续。');
      envelope = await syncPlanner(envelope, gatewayUrl(), createGatewayPlannerTransport(), persist);
      applyCommand(projectedState(envelope), command, Date.now());
    }
    envelope = enqueue(envelope, command, Date.now(), crypto.randomUUID());
    await persist(envelope);
    setStatus('已保存在本机，等待同步');
    if (isControl) {
      await syncPlanner(envelope, gatewayUrl(), createGatewayPlannerTransport(), persist);
      setStatus('专注操作已由电脑确认');
    } else if (isGatewayConnected()) {
      try {
        await syncPlanner(envelope, gatewayUrl(), createGatewayPlannerTransport(), persist);
        setStatus('生活记录已同步');
      } catch (reason) {
        setStatus(`本机已保存，尚未同步：${errorMessage(reason)}`);
      }
    }
  }), [run]);

  const resolve = useCallback((choice: 'local' | 'remote') => run(async (initial, persist) => {
    if (!isGatewayConnected()) throw new Error('请先连接电脑。');
    if (!initial.pending.length) return;
    const doc = await createGatewayPlannerTransport().read();
    if (initial.serverId !== doc.serverId || initial.serverUrl !== gatewayUrl()) throw new Error('服务器已更换，请先导出备份，不能覆盖另一台电脑。');
    const [first, ...rest] = initial.pending;
    const key = commandKey(first.command);
    const version = doc.entityVersions[key] ?? 0;
    const pending = choice === 'local' ? [{ ...first, operationId: crypto.randomUUID(), expectedVersion: version, sentRevision: null }, ...rest] : rest;
    const next = { ...initial, base: doc.state, revision: doc.revision, entityVersions: doc.entityVersions, pending };
    await persist(next);
    await syncPlanner(next, gatewayUrl(), createGatewayPlannerTransport(), persist);
    setStatus('冲突已处理，生活记录已同步');
  }), [run]);

  const switchServer = useCallback((expectedUrl = gatewayUrl()) => run(async (initial, persist) => {
    if (!isGatewayConnected() || gatewayUrl() !== expectedUrl) throw new Error('连接地址已改变，请重新确认。');
    if (!initial.serverId && initial.base.focusSessions.some((s) => s.status === 'running' || s.status === 'paused')) throw new Error('请先结束本机专注再切换来源。');
    const doc = await createGatewayPlannerTransport().read();
    if (initial.serverId === doc.serverId && initial.serverUrl === expectedUrl) { setStatus('当前已经是这个生活记录来源'); return; }
    const archiveKey = (url: string | null, serverId: string | null) => `${PLANNER_KEY}.source:${encodeURIComponent(url ?? 'local')}:${encodeURIComponent(serverId ?? 'local')}`;
    await persist(initial);
    const previousKey = archiveKey(initial.serverUrl, initial.serverId);
    const previousRaw = JSON.stringify(initial);
    if (storage === browserStorage) await guardedSave(previousKey, await readGuardedRaw(previousKey), () => { storage.setItem(previousKey, previousRaw); return previousRaw; });
    else storage.setItem(previousKey, previousRaw);
    const targetKey = archiveKey(expectedUrl, doc.serverId);
    const archived = storage === browserStorage ? await readGuardedRaw(targetKey) : storage.getItem(targetKey);
    const next = archived ? envelopeSchema.parse(JSON.parse(archived)) : { ...emptyEnvelope(), base: doc.state, revision: doc.revision, entityVersions: doc.entityVersions, serverId: doc.serverId, serverUrl: expectedUrl };
    if (next.serverId !== doc.serverId || next.serverUrl !== expectedUrl) throw new Error('来源存档身份不一致，未切换。');
    await persist(next);
    setStatus('已切换生活记录来源；原来源与待同步队列已单独保留，不会复制到新服务器');
  }), [run, storage]);

  const restore = useCallback((state: PlannerState) => run(async (initial, persist) => {
    const parsed = plannerSchema.parse(state);
    if (initial.serverId || isGatewayConnected()) throw new Error('同步中的记录不能整份覆盖。请保留备份，在未绑定电脑的浏览器恢复。');
    if (parsed.focusSessions.some((s) => s.status === 'running' || s.status === 'paused')) throw new Error('备份含进行中的专注，请先结束计时再导出。');
    let next = emptyEnvelope();
    for (const value of parsed.events) {
      if (value.source === 'trip') continue;
      next = enqueue(next, { kind: 'put', collection: 'events', value }, Date.now(), crypto.randomUUID());
    }
    for (const collection of ['courseRules', 'countdowns', 'trips', 'serviceEntries'] as const) {
      for (const value of parsed[collection]) {
        next = enqueue(next, { kind: 'put', collection, value }, Date.now(), crypto.randomUUID());
      }
    }
    for (const value of parsed.focusSessions) next = enqueue(next, { kind: 'focus.import', value }, Date.now(), crypto.randomUUID());
    next = enqueue(next, { kind: 'preferences', focusMinutes: parsed.preferences.focusMinutes }, Date.now(), crypto.randomUUID());
    for (const key of parsed.reminderReceipts) next = enqueue(next, { kind: 'reminder', key }, Date.now(), crypto.randomUUID());
    storage.setItem(`${PLANNER_KEY}.before-restore`, storage.getItem(PLANNER_KEY) ?? JSON.stringify(initial));
    await persist(next);
    setStatus('生活记录已恢复，导入前备份已保留');
  }, true), [run, storage]);

  useEffect(() => {
    const onStorage = () => reload();
    const onOnline = () => { void syncRef.current(); };
    const onVisible = () => { if (document.visibilityState === 'visible') { reload(); void syncRef.current(); } };
    window.addEventListener('storage', onStorage);
    window.addEventListener('shunshou-planner-change', onStorage);
    window.addEventListener('online', onOnline);
    window.addEventListener('shunshou-gateway-change', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    if (isGatewayConnected()) void syncRef.current();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible' && isGatewayConnected() && !working.current) void syncRef.current(); }, 30000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('shunshou-planner-change', onStorage);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('shunshou-gateway-change', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [reload]);

  const state = useMemo(() => projectedState(snapshot.envelope), [snapshot.envelope]);
  return <Context.Provider value={{ state, owner, busy, blocked: Boolean(snapshot.error), error: snapshot.error || error, status,
    pending: snapshot.envelope.pending.length, raw: snapshot.raw, serverBound: Boolean(snapshot.envelope.serverId), dispatch, sync, resolve, restore, switchServer }}>{children}</Context.Provider>;
}
export function usePlanner() {
  const value = useContext(Context);
  if (!value) throw new Error('PlannerProvider is required.');
  return value;
}
