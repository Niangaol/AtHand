import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { calendarSnapshotSchema, type CalendarSnapshot } from '../domain/calendar';
import { applyAuthHeaders, gatewayToken, gatewayUrl } from './gateway';

const documentSchema = z.object({ serverId: z.string().min(1), sources: z.array(calendarSnapshotSchema).max(30) }).strict();
const Context = createContext<{ sources: CalendarSnapshot[]; status: string; busy: boolean; refresh: () => Promise<void> }>({ sources: [], status: '', busy: false, refresh: async () => {} });

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<CalendarSnapshot[]>([]);
  const [status, setStatus] = useState('尚未连接手机日历');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const url = gatewayUrl();
    const token = gatewayToken();
    setSources([]);
    if (!token) { setStatus('连接电脑后可读取手机日历'); setBusy(false); return; }
    const key = `shunshou.calendar.v1:${encodeURIComponent(url)}`;
    let cached: z.infer<typeof documentSchema> | null = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) { cached = documentSchema.parse(JSON.parse(raw)); setSources(cached.sources); }
    } catch { setStatus('日历缓存无法读取，正在重新获取'); }
    setBusy(true);
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${url}/api/calendar`, {
        headers: applyAuthHeaders(new Headers(), url, token),
        signal: controller.signal,
      });
      if (response.status === 401) throw new Error('登录已过期，请重新连接电脑');
      if (!response.ok) throw new Error('手机日历读取失败');
      const next = documentSchema.parse(await response.json());
      if (active.current !== controller || gatewayUrl() !== url || gatewayToken() !== token) return;
      if (cached && cached.serverId !== next.serverId) { setSources([]); throw new Error('该地址的服务器身份已改变，请确认连接地址'); }
      setSources(next.sources);
      try { localStorage.setItem(key, JSON.stringify(next)); }
      catch { setStatus('日历已读取，但离线缓存保存失败'); return; }
      setStatus(next.sources.length ? '已读取手机日历来源' : '尚无手机日历上传，请在手机端同步');
    } catch (error) {
      if (active.current === controller) setStatus(`${error instanceof Error && error.name !== 'AbortError' ? error.message : '手机日历连接超时'}${cached ? '；保留上次缓存，请留意更新时间' : ''}`);
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const storage = (event: StorageEvent) => { if (event.key?.startsWith('shunshou.gateway.')) void refresh(); };
    void refresh();
    window.addEventListener('shunshou-gateway-change', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(visible, 60000);
    return () => { active.current?.abort(); active.current = null; window.clearInterval(interval); window.removeEventListener('shunshou-gateway-change', refresh); window.removeEventListener('online', refresh); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  return <Context.Provider value={{ sources, status, busy, refresh }}>{children}</Context.Provider>;
}

export function useCalendar() { return useContext(Context); }

export function CalendarStatus() {
  const { sources, status, busy, refresh } = useCalendar();
  return <section className="panel planner-panel planner-spaced" aria-label="手机日历同步"><div className="planner-section-title"><h2>手机日历</h2><button className="button secondary compact" disabled={busy} onClick={() => void refresh()}>刷新手机日历</button></div><p role="status">{status}</p>{sources.map((source, index) => <p key={source.sourceId}>来源 {index + 1} · {source.calendarAvailable ? source.complete ? `${source.events.length} 条日程` : '读取不完整，保留旧记录' : '日历权限已撤销，暂不展示此来源'} · 最近读取 {new Date(source.fetchedAt).toLocaleString('zh-CN')}{Date.now() - source.fetchedAt > 86400_000 ? ' · 超过一天未更新' : ''}</p>)}</section>;
}
