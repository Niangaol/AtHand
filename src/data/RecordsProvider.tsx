import { createContext, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toDateKey } from '../domain/dates';
import { buildRecord, buildWorkplace, parseAmount } from '../domain/ledger';
import type { RecordDraft } from '../domain/ledger';
import type { LedgerState } from '../domain/records';
import { createInitialState, loadLedger, saveLedger, STORAGE_KEY } from './storage';

type Result = { ok: true } | { ok: false; message: string };
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
type RecordsData = LedgerState & {
  today: string; error: string; rawData: string | null; blocked: boolean; saving: boolean;
  saveRecord: (draft: RecordDraft, id?: string) => Promise<Result>;
  deleteRecord: (id: string) => Promise<Result>;
  saveWorkplace: (name: string, rate: string, id?: string) => Promise<Result>;
  deleteWorkplace: (id: string) => Promise<Result>;
  updateRate: (rate: string) => Promise<Result>;
  clearExamples: () => Promise<Result>;
  resetLedger: () => Promise<Result>;
};
const RecordsContext = createContext<RecordsData | null>(null);
const browserStorage: StoragePort = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

export function RecordsProvider({ initialState, today: fixedToday, storage = browserStorage, children }: {
  initialState?: LedgerState; today?: string; storage?: StoragePort; children: ReactNode;
}) {
  const today = fixedToday ?? toDateKey(new Date());
  const [loaded] = useState(() => initialState ? { state: initialState, raw: null, error: '' } : loadLedger(storage, today));
  const [state, setState] = useState(loaded.state);
  const [error, setError] = useState(loaded.error);
  const [blocked, setBlocked] = useState(Boolean(loaded.error));
  const stateRef = useRef(state);
  const rawRef = useRef(loaded.raw);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  async function commit(change: (previous: LedgerState) => LedgerState, recovery = false): Promise<Result> {
    if (savingRef.current) return { ok: false, message: '上一笔操作正在保存，请稍候再试。' };
    savingRef.current = true;
    setSaving(true);
    try {
      if (blocked && !recovery) throw new Error(loaded.error || '账本暂不可写入，请刷新后重试。');
      if (!navigator.locks) throw new Error('当前浏览器不支持安全的本地写入，请使用新版 Chrome、Edge、Firefox 或 Safari，并通过本机地址或 HTTPS 打开。');
      return await navigator.locks.request(STORAGE_KEY, () => {
        const next = change(stateRef.current);
        rawRef.current = saveLedger(storage, next, rawRef.current);
        stateRef.current = next;
        setState(next);
        setError('');
        setBlocked(false);
        return { ok: true } as const;
      });
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
    });
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

  return <RecordsContext.Provider value={{ ...state, today, error, blocked, saving, rawData: rawRef.current, saveRecord, deleteRecord, saveWorkplace, deleteWorkplace, updateRate, clearExamples, resetLedger }}>{children}</RecordsContext.Provider>;
}

export function useRecords(): RecordsData {
  const data = useContext(RecordsContext);
  if (!data) throw new Error('useRecords must be used within RecordsProvider');
  return data;
}
