import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { guardedSave } from './guardedSave';
import { useLocalToday } from './useLocalToday';
import { buildRecord, buildWorkplace, parseAmount } from '../domain/ledger';
import type { RecordDraft } from '../domain/ledger';
import type { LedgerState, RecordEntry } from '../domain/records';
import { backendNoun, clearGatewayAccountChanged, clearGatewaySession, gatewayAccountChanged, gatewayFetch, isGatewayConnected } from './gateway';
import { createInitialState, isLedgerState, ledgerByteLength, loadLedger, MAX_SYNC_LEDGER_BYTES, saveLedger, STORAGE_KEY } from './storage';

type Result = { ok: true } | { ok: false; message: string };
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export type RemoteState = { status: 'off' | 'syncing' | 'synced' | 'conflict' | 'error'; message: string; updatedAt: string | null };
type RecordsData = LedgerState & {
  today: string; error: string; rawData: string | null; blocked: boolean; saving: boolean;
  saveRecord: (draft: RecordDraft, id?: string) => Promise<Result>;
  deleteRecord: (id: string) => Promise<Result>;
  saveWorkplace: (name: string, rate: string, id?: string) => Promise<Result>;
  deleteWorkplace: (id: string) => Promise<Result>;
  updateRate: (rate: string) => Promise<Result>;
  clearExamples: () => Promise<Result>;
  resetLedger: () => Promise<Result>;
  importRecords: (records: RecordEntry[]) => Promise<Result>;
  remote: RemoteState;
  refreshRemote: () => Promise<Result>;
  uploadLocalToRemote: () => Promise<Result>;
  adoptRemote: () => Promise<Result>;
  disconnectRemote: () => void;
};
const RecordsContext = createContext<RecordsData | null>(null);
const PENDING_KEY = 'shunshou.ledger.pending';
const SYNC_TOO_LARGE = '照片总量太大，云端无法一次保存。请先删掉几张照片，再重新保存。';
const browserStorage: StoragePort = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

function readPending(): boolean {
  try { return window.localStorage.getItem(PENDING_KEY) === '1'; } catch { return false; }
}
function writePending(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(PENDING_KEY, '1');
    else window.localStorage.removeItem(PENDING_KEY);
  } catch { /* 存储不可用时只影响下次提示。 */ }
}
function sameLedger(left: LedgerState, right: LedgerState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function RecordsProvider({ initialState, today: fixedToday, storage = browserStorage, children }: {
  initialState?: LedgerState; today?: string; storage?: StoragePort; children: ReactNode;
}) {
  const localToday = useLocalToday();
  const today = fixedToday ?? localToday;
  const [loaded] = useState(() => initialState ? { state: initialState, raw: null, error: '' } : loadLedger(storage, today));
  const [state, setState] = useState(loaded.state);
  const [error, setError] = useState(loaded.error);
  const [blocked, setBlocked] = useState(Boolean(loaded.error));
  const stateRef = useRef(state);
  const rawRef = useRef(loaded.raw);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const connected = isGatewayConnected();
  const noun = backendNoun();
  const [remote, setRemote] = useState<RemoteState>(() => connected
    ? { status: 'syncing', message: `正在读取${noun}上的账本…`, updatedAt: null }
    : { status: 'off', message: '', updatedAt: null });
  const updatedAtRef = useRef<string | null>(null);
  const pendingRef = useRef(readPending());
  const pushChainRef = useRef<Promise<unknown>>(Promise.resolve());

  async function applyExternal(next: LedgerState): Promise<Result> {
    try {
      if (!navigator.locks) throw new Error('当前浏览器不支持安全的本地写入，请使用新版浏览器并通过 HTTPS 打开。');
      return await navigator.locks.request(STORAGE_KEY, async () => {
        rawRef.current = storage === browserStorage ? await guardedSave(STORAGE_KEY, rawRef.current, () => saveLedger(storage, next, rawRef.current)) : saveLedger(storage, next, rawRef.current);
        stateRef.current = next;
        setState(next);
        setError('');
        setBlocked(false);
        return { ok: true } as const;
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '写入本机失败。';
      setError(message);
      return { ok: false, message };
    }
  }

  async function pushRemote(force = false): Promise<Result> {
    if (!isGatewayConnected()) return { ok: false, message: `还没有连接${noun}。` };
    if (ledgerByteLength(stateRef.current) > MAX_SYNC_LEDGER_BYTES) {
      pendingRef.current = true;
      writePending(true);
      setRemote({ status: 'error', message: SYNC_TOO_LARGE, updatedAt: updatedAtRef.current });
      return { ok: false, message: SYNC_TOO_LARGE };
    }
    setRemote({ status: 'syncing', message: `正在保存到${noun}…`, updatedAt: updatedAtRef.current });
    try {
      const response = await gatewayFetch('/api/ledger', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledger: stateRef.current, baseUpdatedAt: updatedAtRef.current, force }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: unknown; updatedAt?: unknown; ledger?: unknown } | null;
      if (response.status === 401) {
        clearGatewaySession();
        setRemote({ status: 'error', message: `登录已过期，请重新连接${noun}。`, updatedAt: updatedAtRef.current });
        return { ok: false, message: `登录已过期，请重新连接${noun}。` };
      }
      if (response.status === 409) {
        pendingRef.current = true;
        writePending(true);
        setRemote({ status: 'conflict', message: `${noun}上的账本已被其他设备更新，请选择保留哪一份。`, updatedAt: updatedAtRef.current });
        return { ok: false, message: `${noun}上的账本已被更新，请选择保留哪一份。` };
      }
      if (!response.ok || body?.ok !== true || typeof body.updatedAt !== 'string') throw new Error(`${noun}上的服务返回异常。`);
      updatedAtRef.current = body.updatedAt;
      pendingRef.current = false;
      writePending(false);
      if (force) clearGatewayAccountChanged();
      setRemote({ status: 'synced', message: '已同步到后端。', updatedAt: body.updatedAt });
      return { ok: true };
    } catch (reason) {
      pendingRef.current = true;
      writePending(true);
      const detail = reason instanceof Error ? reason.message : `连不上${noun}。`;
      setRemote({ status: 'error', message: `${detail} 修改仍保存在本机，联网后可再试。`, updatedAt: updatedAtRef.current });
      return { ok: false, message: detail };
    }
  }

  function queuePush(): void {
    if (!isGatewayConnected()) return;
    pushChainRef.current = pushChainRef.current
      .then(() => (isGatewayConnected() ? pushRemote(false) : undefined))
      .catch(() => undefined);
  }

  async function refreshRemote(): Promise<Result> {
    if (!isGatewayConnected()) {
      setRemote({ status: 'off', message: '', updatedAt: null });
      return { ok: true };
    }
    setRemote({ status: 'syncing', message: `正在读取${noun}上的账本…`, updatedAt: updatedAtRef.current });
    try {
      const response = await gatewayFetch('/api/ledger');
      const body = (await response.json().catch(() => null)) as { ok?: unknown; ledger?: unknown; updatedAt?: unknown } | null;
      if (response.status === 401) {
        clearGatewaySession();
        setRemote({ status: 'off', message: `登录已过期，请重新连接${noun}。`, updatedAt: null });
        return { ok: false, message: `登录已过期，请重新连接${noun}。` };
      }
      if (!response.ok || body?.ok !== true) throw new Error('读取后端账本失败。');
      const updatedAt = typeof body.updatedAt === 'string' ? body.updatedAt : null;
      if (gatewayAccountChanged()) {
        pendingRef.current = false;
        writePending(false);
        const detail = body.ledger === null || body.ledger === undefined
          ? '检测到切换账号；本机账本属于上一个账号，不会自动上传。请先导出备份，再用本机账本明确覆盖新账号，或重置本机账本。'
          : '检测到切换账号；本机账本与当前账号的云端账本不会自动合并，请选择保留哪一份。';
        setRemote({ status: 'conflict', message: detail, updatedAt });
        return { ok: false, message: detail };
      }
      if (body.ledger === null || body.ledger === undefined) {
        const pushed = await pushRemote(false);
        if (pushed.ok) setRemote({ status: 'synced', message: `已把本机账本上传到${noun}。`, updatedAt: updatedAtRef.current });
        return pushed;
      }
      if (!isLedgerState(body.ledger)) throw new Error(`${noun}上的账本格式无法识别。`);
      const serverLedger = body.ledger;
      if (sameLedger(serverLedger, stateRef.current)) {
        updatedAtRef.current = updatedAt;
        pendingRef.current = false;
        writePending(false);
        setRemote({ status: 'synced', message: `已与${noun}一致。`, updatedAt });
        return { ok: true };
      }
      if (pendingRef.current) {
        setRemote({ status: 'conflict', message: `本机有未同步的修改，${noun}上也有新内容，请选择保留哪一份。`, updatedAt });
        return { ok: false, message: '本机有未同步的修改，请选择保留哪一份。' };
      }
      const applied = await applyExternal(serverLedger);
      if (!applied.ok) return applied;
      updatedAtRef.current = updatedAt;
      pendingRef.current = false;
      writePending(false);
      setRemote({ status: 'synced', message: `已读取${noun}上的账本。`, updatedAt });
      return { ok: true };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `读取${noun}账本失败。`;
      setRemote({ status: 'error', message, updatedAt: updatedAtRef.current });
      return { ok: false, message };
    }
  }

  async function uploadLocalToRemote(): Promise<Result> {
    const result = await pushRemote(true);
    return result;
  }

  async function adoptRemote(): Promise<Result> {
    if (!isGatewayConnected()) return { ok: false, message: `还没有连接${noun}。` };
    setRemote({ status: 'syncing', message: `正在读取${noun}上的账本…`, updatedAt: updatedAtRef.current });
    try {
      const response = await gatewayFetch('/api/ledger');
      const body = (await response.json().catch(() => null)) as { ok?: unknown; ledger?: unknown; updatedAt?: unknown } | null;
      if (!response.ok || body?.ok !== true) throw new Error(`读取${noun}账本失败。`);
      if (!isLedgerState(body.ledger)) throw new Error(`${noun}上还没有账本。`);
      const applied = await applyExternal(body.ledger);
      if (!applied.ok) return applied;
      updatedAtRef.current = typeof body.updatedAt === 'string' ? body.updatedAt : null;
      pendingRef.current = false;
      writePending(false);
      clearGatewayAccountChanged();
      setRemote({ status: 'synced', message: '已用云端账本覆盖本机。', updatedAt: updatedAtRef.current });
      return { ok: true };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : `读取${noun}账本失败。`;
      setRemote({ status: 'error', message, updatedAt: updatedAtRef.current });
      return { ok: false, message };
    }
  }

  function disconnectRemote(): void {
    clearGatewaySession();
    setRemote({ status: 'off', message: '已断开；本机账本仍保留。', updatedAt: null });
  }

  useEffect(() => {
    if (isGatewayConnected()) void refreshRemote();
    // 只在首次挂载时尝试读取远端账本。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function commit(change: (previous: LedgerState) => LedgerState, recovery = false, checkSyncSize = false): Promise<Result> {
    if (savingRef.current) return { ok: false, message: '上一笔操作正在保存，请稍候再试。' };
    savingRef.current = true;
    setSaving(true);
    try {
      if (blocked && !recovery) throw new Error(loaded.error || '账本暂不可写入，请刷新后重试。');
      if (!navigator.locks) throw new Error('当前浏览器不支持安全的本地写入，请使用新版 Chrome、Edge、Firefox 或 Safari，并通过本机地址或 HTTPS 打开。');
      const result = await navigator.locks.request(STORAGE_KEY, async () => {
        const next = change(stateRef.current);
        if (checkSyncSize && isGatewayConnected() && ledgerByteLength(next) > MAX_SYNC_LEDGER_BYTES) {
          throw new Error(SYNC_TOO_LARGE);
        }
        rawRef.current = storage === browserStorage ? await guardedSave(STORAGE_KEY, rawRef.current, () => saveLedger(storage, next, rawRef.current), recovery) : saveLedger(storage, next, rawRef.current);
        stateRef.current = next;
        setState(next);
        setError('');
        setBlocked(false);
        return { ok: true } as const;
      });
      queuePush();
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '操作失败，请重试。';
      setError(message);
      return { ok: false, message };
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function saveRecord(draft: RecordDraft, id?: string): Promise<Result> {
    return commit((previous) => {
      if (id && !previous.records.some((record) => record.id === id)) throw new Error('这笔记录已不存在，请返回账单。');
      const record = buildRecord(draft, previous.workplaces, id ?? crypto.randomUUID());
      const records = previous.records.filter((item) => item.source !== 'demo' && item.id !== id);
      return { ...previous, records: [...records, record], workplaces: previous.workplaces.map((unit) => record.type === 'work' && unit.id === record.workplaceId ? { ...unit, source: 'manual' } : unit) };
    }, false, true);
  }
  function deleteRecord(id: string): Promise<Result> {
    return commit((previous) => ({ ...previous, records: previous.records.filter((record) => record.id !== id) }));
  }
  function saveWorkplace(name: string, rate: string, id?: string): Promise<Result> {
    return commit((previous) => {
      if (id && !previous.workplaces.some((unit) => unit.id === id)) throw new Error('这个单位已不存在，请刷新页面。');
      const workplace = buildWorkplace(name, rate, id ?? crypto.randomUUID());
      if (previous.workplaces.some((unit) => unit.id !== id && unit.name === workplace.name)) throw new Error('已有同名单位，请使用不同的名称。');
      const workplaces = id ? previous.workplaces.map((unit) => unit.id === id ? workplace : unit) : [...previous.workplaces, workplace];
      return { ...previous, workplaces };
    });
  }
  function deleteWorkplace(id: string): Promise<Result> {
    return commit((previous) => {
      if (previous.records.some((record) => record.type === 'work' && record.workplaceId === id)) throw new Error('这个单位还有关联工时，请先删除或调整对应记录。');
      return { ...previous, workplaces: previous.workplaces.filter((unit) => unit.id !== id) };
    });
  }
  function updateRate(rate: string): Promise<Result> {
    return commit((previous) => ({ ...previous, settings: { hourlyRateCents: parseAmount(rate) } }));
  }
  function clearExamples(): Promise<Result> {
    return commit((previous) => {
      const records = previous.records.filter((record) => record.source !== 'demo');
      const referenced = new Set(records.flatMap((record) => record.type === 'work' ? [record.workplaceId] : []));
      return { ...previous, records, workplaces: previous.workplaces.filter((unit) => unit.source !== 'demo' || referenced.has(unit.id)) };
    });
  }
  function resetLedger(): Promise<Result> {
    return commit(() => createInitialState(today, false), true);
  }
  function importRecords(records: RecordEntry[]): Promise<Result> {
    return commit((previous) => {
      const existing = new Set(previous.records.map((record) => record.id));
      const fresh = records.filter((record) => !existing.has(record.id));
      if (fresh.length === 0) return previous;
      return {
        ...previous,
        records: [...previous.records.filter((record) => record.source !== 'demo'), ...fresh],
      };
    });
  }

  return <RecordsContext.Provider value={{ ...state, today, error, blocked, saving, rawData: rawRef.current, saveRecord, deleteRecord, saveWorkplace, deleteWorkplace, updateRate, clearExamples, resetLedger, importRecords, remote, refreshRemote, uploadLocalToRemote, adoptRemote, disconnectRemote }}>{children}</RecordsContext.Provider>;
}

export function useRecords(): RecordsData {
  const data = useContext(RecordsContext);
  if (!data) throw new Error('useRecords must be used within RecordsProvider');
  return data;
}
