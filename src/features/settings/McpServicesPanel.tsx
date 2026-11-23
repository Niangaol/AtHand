import { useCallback, useEffect, useState } from 'react';
import { PlugZap, RefreshCw } from 'lucide-react';
import {
  listMcpServices, maskHeadersText, mcpStateLabel, parseHeadersText, probeMcpService, saveMcpService,
} from '../../data/mcpServices';
import type { McpServiceView } from '../../data/mcpServices';
import { GatewayError } from '../../data/gateway';

type Draft = { enabled: boolean; url: string; headers: string };

function initialDrafts(services: McpServiceView[]): Record<string, Draft> {
  return Object.fromEntries(services.map((service) => [service.name, {
    enabled: service.enabled,
    url: '',
    headers: '',
  }]));
}

function toneClass(tone: 'ok' | 'warn' | 'idle'): string {
  return tone === 'ok' ? 'state-badge' : tone === 'warn' ? 'state-badge warn' : 'state-badge idle';
}

function errorText(error: unknown): string {
  if (error instanceof GatewayError) return error.message;
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后再试。';
}

export function McpServicesPanel({ connected, cloudMode }: { connected: boolean; cloudMode: boolean }) {
  const [services, setServices] = useState<McpServiceView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [expanded, setExpanded] = useState('');
  const [message, setMessage] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!connected || cloudMode) return;
    setLoading(true);
    setError('');
    try {
      const list = await listMcpServices();
      setServices(list);
      setDrafts(initialDrafts(list));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [connected, cloudMode]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!connected) return <p className="form-hint">先连接上面的本机网关，再配置生活服务。</p>;
  if (cloudMode) {
    return <p className="form-hint">当前连接的是云端后端。生活服务 MCP 跑在你自己电脑上的本机网关里，请把服务地址改回 http://127.0.0.1:18787 再配置。</p>;
  }

  function updateDraft(name: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [name]: { ...current[name], ...patch } }));
  }

  async function save(service: McpServiceView) {
    const draft = drafts[service.name];
    if (!draft) return;
    setBusy(service.name);
    setMessage((current) => ({ ...current, [service.name]: '' }));
    try {
      const headers = draft.headers.trim() ? parseHeadersText(draft.headers) : undefined;
      const patch: { enabled: boolean; url?: string; headers?: Record<string, string> } = { enabled: draft.enabled };
      if (draft.url.trim()) patch.url = draft.url.trim();
      if (headers) patch.headers = headers;
      const updated = await saveMcpService(service.name, patch);
      setServices((current) => current.map((item) => (item.name === updated.name ? updated : item)));
      setDrafts((current) => ({ ...current, [service.name]: { enabled: updated.enabled, url: '', headers: '' } }));
      setMessage((current) => ({ ...current, [service.name]: `已保存。状态：${updated.state.message || updated.state.status}` }));
    } catch (caught) {
      setMessage((current) => ({ ...current, [service.name]: errorText(caught) }));
    } finally {
      setBusy('');
    }
  }

  async function probe(service: McpServiceView) {
    setBusy(service.name);
    setMessage((current) => ({ ...current, [service.name]: '正在连接…' }));
    try {
      const result = await probeMcpService(service.name);
      const updated = await listMcpServices();
      setServices(updated);
      setMessage((current) => ({
        ...current,
        [service.name]: result.toolCount > 0
          ? `连接成功，可用工具 ${result.toolCount} 个${result.tools.length ? `：${result.tools.slice(0, 6).join('、')}${result.toolCount > 6 ? ' 等' : ''}` : ''}`
          : (result.message || '连接成功，但这个服务没有列出工具。'),
      }));
    } catch (caught) {
      setMessage((current) => ({ ...current, [service.name]: errorText(caught) }));
    } finally {
      setBusy('');
    }
  }

  return <>
    <div className="mcp-toolbar">
      <p className="settings-lead">这些服务跑在电脑上的本机网关里：填好地址（或带 Key 的地址）和请求头、打开开关，助手才会拿到对应工具。没有配置的服务保持「未配置」，助手不会假装能用。</p>
      <button type="button" className="button secondary compact" disabled={loading} onClick={() => { void refresh(); }}>
        <RefreshCw size={15} /> {loading ? '正在读取' : '刷新'}
      </button>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {!error && !loading && services.length === 0 ? <p className="form-hint">还没有可配置的服务。</p> : null}
    <div className="mcp-list">
      {services.map((service) => {
        const draft = drafts[service.name] ?? { enabled: service.enabled, url: '', headers: '' };
        const open = expanded === service.name;
        const state = mcpStateLabel(service.state.status);
        const headerHint = maskHeadersText(service.headerNames);
        return <div className={`mcp-service ${open ? 'open' : ''}`} key={service.name}>
          <div className="mcp-service-head">
            <div>
              <h3>{service.label}
                <span className={toneClass(state.tone)}>{state.text}</span>
              </h3>
              <p>{service.setup || '按服务要求填写地址与鉴权信息。'}{service.urlMasked ? ` 当前地址：${service.urlMasked}` : ''}{service.state.message ? ` · ${service.state.message}` : ''}</p>
            </div>
            <div className="setting-actions">
              <button type="button" className="button secondary compact" onClick={() => setExpanded(open ? '' : service.name)}>{open ? '收起' : '配置'}</button>
            </div>
          </div>
          {open ? <div className="mcp-service-editor">
            <label>连接地址
              <input value={draft.url} onChange={(event) => updateDraft(service.name, { url: event.target.value })} placeholder={service.configured ? (service.urlMasked || '已保存，留空保持不变') : 'http(s)://…'} />
            </label>
            <label>请求头（每行 Name: value；留空保持已保存的值）
              <textarea rows={2} value={draft.headers} onChange={(event) => updateDraft(service.name, { headers: event.target.value })} placeholder={headerHint || '例如 Authorization: Bearer …'} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft(service.name, { enabled: event.target.checked })} />
              启用这个服务
            </label>
            <div className="setting-actions">
              <button type="button" className="button secondary compact" disabled={busy === service.name} onClick={() => { void save(service); }}>保存配置</button>
              <button type="button" className="button secondary compact" disabled={busy === service.name || !service.configured && !draft.url.trim()} onClick={() => { void probe(service); }}>
                <PlugZap size={15} /> 测试连接
              </button>
            </div>
            {message[service.name] ? <p className="form-hint" role="status">{message[service.name]}</p> : null}
          </div> : null}
        </div>;
      })}
    </div>
  </>;
}
