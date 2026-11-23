import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Bot, Database, Download, GraduationCap, Hourglass, KeyRound, Laptop, LockKeyhole, Smartphone, Sparkles, Sprout } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useRecords } from '../../data/RecordsProvider';
import { downloadText, exportCsv } from '../../domain/csv';
import { probeSamplesToRecords } from '../../domain/probeImport';
import { clearGatewaySession, createPairingCode, defaultGatewayUrl, gatewayFetch, gatewayLogin, gatewayLogout, gatewayMe, gatewayUrl, gatewayUsername, isGatewayConnected } from '../../data/gateway';
import type { GatewayPairingCode } from '../../data/gateway';
import { choosePairingUrl, isLoopbackBase, pairingQrText } from '../../domain/pairing';
import { createAgentToken, listAgentAudit, listAgentTokens, revokeAgentToken } from '../../data/agentTokens';
import type { AgentAuditEntry, AgentToken } from '../../data/agentTokens';
import { getAssistantSettings, saveAssistantSettings, testAssistant } from '../../data/assistant';
import type { AssistantSettings } from '../../data/assistant';
import { toolLabel } from '../../data/agentToolLabels';
import { useCampus } from '../../data/CampusProvider';
import { AccountPanel } from './AccountPanel';
import { McpServicesPanel } from './McpServicesPanel';

export function SettingsPage() {
  const { records, workplaces, settings, today, rawData, blocked, updateRate, clearExamples, resetLedger, importRecords, remote, refreshRemote, uploadLocalToRemote, adoptRemote, disconnectRemote } = useRecords();
  const [rate, setRate] = useState((settings.hourlyRateCents / 100).toFixed(2));
  const [notice, setNotice] = useState('');
  const [gatewayAddress, setGatewayAddress] = useState(gatewayUrl() || defaultGatewayUrl() || 'http://127.0.0.1:18787');
  const [password, setPassword] = useState('');
  const [account, setAccount] = useState(gatewayUsername());
  const [connected, setConnected] = useState(isGatewayConnected());
  const [connecting, setConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [pairing, setPairing] = useState<(GatewayPairingCode & { url: string }) | null>(null);
  const [pairingStatus, setPairingStatus] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const pairingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const importRecordsRef = useRef(importRecords);
  const [confirm, setConfirm] = useState<'examples' | 'reset' | null>(null);
  const [agents, setAgents] = useState<AgentToken[]>([]);
  const [agentAudit, setAgentAudit] = useState<AgentAuditEntry[]>([]);
  const [agentName, setAgentName] = useState('我的助手');
  const [agentScope, setAgentScope] = useState<AgentToken['scope']>('read');
  const [newAgentToken, setNewAgentToken] = useState('');
  const [newAgentId, setNewAgentId] = useState('');
  const [agentStatus, setAgentStatus] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentToRevoke, setAgentToRevoke] = useState<AgentToken | null>(null);
  const [assistantBaseUrl, setAssistantBaseUrl] = useState('http://127.0.0.1:11434/v1');
  const [assistantModel, setAssistantModel] = useState('');
  const [assistantKey, setAssistantKey] = useState('');
  const [assistantHasKey, setAssistantHasKey] = useState(false);
  const [assistantPrivacy, setAssistantPrivacy] = useState<AssistantSettings['privacyMode']>('redact');
  const [assistantStatus, setAssistantStatus] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const { status: campusStatus, statusLoading: campusLoading, statusError: campusStatusError, disconnect: disconnectCampus, refresh: refreshCampus, startAuth: startCampusAuth } = useCampus();
  const [campusBusy, setCampusBusy] = useState(false);
  const [campusMessage, setCampusMessage] = useState('');
  const hasExamples = records.some((record) => record.source === 'demo') || workplaces.some((unit) => unit.source === 'demo');
  const cloudMode = /\/functions\/v1\/app$/.test(gatewayAddress.trim());

  useEffect(() => {
    if (!connected || !cloudMode) return;
    let active = true;
    gatewayMe()
      .then((user) => { if (!active) return; if (user) setAccount(user.username); else { clearGatewaySession(); setConnected(false); setConnectionStatus('登录已失效，请重新登录。'); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, [connected]);

  async function testService() {
    try {
      const base = gatewayAddress.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//.test(base)) throw new Error('地址需以 http:// 或 https:// 开头。');
      const response = await fetch(`${base}/api/health`);
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || body.ok !== true) throw new Error('服务返回异常。');
      setConnectionStatus('服务在线，可以填口令连接。');
    } catch (error) {
      setConnectionStatus(`连不上：${error instanceof Error ? error.message : '请确认电脑端已运行 npm run sync。'}`);
    }
  }

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setConnecting(true);
    setConnectionStatus('');
    try {
      await gatewayLogin(gatewayAddress, password);
      setConnected(true);
      setAccount(gatewayUsername());
      setPassword('');
      const result = await refreshRemote();
      setConnectionStatus(result.ok ? '已登录，账本已对齐。' : result.message);
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : '登录失败。');
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setConnecting(true);
    try {
      await gatewayLogout();
    } finally {
      disconnectRemote();
      setConnected(false);
      setAccount('');
      setConnecting(false);
      setConnectionStatus('已退出登录，服务端会话已作废。');
    }
  }

  async function disconnectCampusCloud() {
    setCampusBusy(true);
    setCampusMessage('');
    try {
      await disconnectCampus();
      setCampusMessage('已断开校园授权，云端 PAT 已撤销。');
    } catch (error) {
      setCampusMessage(error instanceof Error ? error.message : '断开校园授权失败。');
    } finally {
      setCampusBusy(false);
    }
  }

  async function reauthorizeCampus() {
    setCampusBusy(true);
    setCampusMessage('');
    try {
      await startCampusAuth();
      setCampusMessage('已生成授权链接，请到校园页打开授权页完成确认。');
    } catch (error) {
      setCampusMessage(error instanceof Error ? error.message : '生成授权链接失败。');
    } finally {
      setCampusBusy(false);
    }
  }

  async function refreshCampusCloud() {
    setCampusBusy(true);
    setCampusMessage('');
    try {
      await refreshCampus();
      setCampusMessage('已刷新校园数据。');
    } catch (error) {
      setCampusMessage(error instanceof Error ? error.message : '刷新失败。');
    } finally {
      setCampusBusy(false);
    }
  }

  async function pullSamples() {
    setSyncing(true);
    setSyncStatus('');
    try {
      if (!isGatewayConnected()) throw new Error('请先连接电脑。');
      const response = await gatewayFetch('/api/samples');
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || body.ok !== true || !Array.isArray(body.samples)) {
        throw new Error('同步服务返回异常。');
      }
      const result = probeSamplesToRecords(body.samples);
      const saved = await importRecords(result.records);
      if (!saved.ok) throw new Error(saved.message);
      setSyncStatus(`导入 ${result.records.length} 笔支出；跳过收入 ${result.skippedIncome}、待确认 ${result.skippedPending}、无效 ${result.invalid}。`);
    } catch (error) {
      setSyncStatus(`导入失败：${error instanceof Error ? error.message : '请检查连接。'}`);
    } finally {
      setSyncing(false);
    }
  }

  async function startPairing() {
    setPairingBusy(true);
    setPairingStatus('');
    try {
      const created = await createPairingCode();
      const base = gatewayUrl();
      const url = choosePairingUrl(base, created.urls);
      setPairing({ ...created, url });
      if (isLoopbackBase(url)) {
        setPairingStatus('电脑只监听本机地址，手机可能连不上；请改用隧道地址，或用 HOST=0.0.0.0 启动并放行防火墙。');
      }
    } catch (error) {
      setPairingStatus(error instanceof Error ? error.message : '生成配对码失败。');
    } finally {
      setPairingBusy(false);
    }
  }

  useEffect(() => {
    importRecordsRef.current = importRecords;
  }, [importRecords]);

  useEffect(() => {
    const canvas = pairingCanvasRef.current;
    if (!pairing || !canvas) return;
    QRCode.toCanvas(canvas, pairingQrText(pairing), { width: 200, margin: 2, errorCorrectionLevel: 'M' })
      .catch(() => setPairingStatus('二维码生成失败，请刷新重试。'));
  }, [pairing]);

  useEffect(() => {
    if (!pairing) return;
    let active = true;
    const known = new Set<string>();
    const tick = async (first: boolean) => {
      if (!isGatewayConnected() || Date.now() > pairing.expiresAt) return;
      try {
        const response = await gatewayFetch('/api/samples');
        const body = (await response.json().catch(() => null)) as { ok?: unknown; samples?: unknown } | null;
        if (!response.ok || body?.ok !== true || !Array.isArray(body.samples)) return;
        const samples = body.samples as Array<{ id?: unknown }>;
        if (first) {
          for (const sample of samples) if (sample && typeof sample.id === 'string') known.add(sample.id);
          return;
        }
        const fresh = samples.filter((sample) => sample && typeof sample.id === 'string' && !known.has(sample.id));
        if (fresh.length === 0) return;
        for (const sample of fresh) known.add(sample.id as string);
        const result = probeSamplesToRecords(fresh);
        if (!active) return;
        if (result.records.length === 0) {
          setPairingStatus(`手机发来 ${fresh.length} 条样本，但其中没有可导入的支出。`);
          return;
        }
        const saved = await importRecordsRef.current(result.records);
        if (!active) return;
        setPairingStatus(saved.ok
          ? `已从手机导入 ${result.records.length} 笔支出；跳过收入 ${result.skippedIncome}、待确认 ${result.skippedPending}、无效 ${result.invalid}。`
          : saved.message);
      } catch { /* 配对期间网络抖动不打断二维码。 */ }
    };
    void tick(true);
    const timer = window.setInterval(() => void tick(false), 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pairing]);

  const refreshAgentPanel = useCallback(async () => {
    if (!isGatewayConnected()) return;
    try {
      const [tokens, entries] = await Promise.all([listAgentTokens(), listAgentAudit()]);
      setAgents(tokens);
      setAgentAudit(entries);
    } catch (error) {
      setAgentStatus(error instanceof Error ? error.message : '读取 Agent 令牌失败。');
    }
  }, []);
  useEffect(() => {
    if (!connected) { setAgents([]); setAgentAudit([]); return; }
    void refreshAgentPanel();
  }, [connected, refreshAgentPanel]);
  async function createAgent(event: React.FormEvent) {
    event.preventDefault();
    setAgentBusy(true);
    setAgentStatus('');
    setNewAgentToken('');
    try {
      const created = await createAgentToken(agentName.trim(), agentScope);
      setAgents((current) => [created.agent, ...current.filter((item) => item.id !== created.agent.id)]);
      setNewAgentToken(created.token);
      setNewAgentId(created.agent.id);
      setAgentStatus('令牌已生成，只显示这一次。');
    } catch (error) {
      setAgentStatus(error instanceof Error ? error.message : '生成失败。');
    } finally {
      setAgentBusy(false);
    }
  }
  async function revokeAgent(agent: AgentToken) {
    setAgentBusy(true);
    try {
      await revokeAgentToken(agent.id);
      setAgents((current) => current.filter((item) => item.id !== agent.id));
      if (newAgentId === agent.id) { setNewAgentToken(''); setNewAgentId(''); }
      setAgentStatus(`「${agent.name}」已吊销，使用它的 agent 会立即失去访问权限。`);
    } catch (error) {
      setAgentStatus(error instanceof Error ? error.message : '吊销失败。');
    } finally {
      setAgentBusy(false);
    }
  }
  async function copyAgentToken() {
    try {
      await navigator.clipboard.writeText(newAgentToken);
      setAgentStatus('令牌已复制。');
    } catch {
      setAgentStatus('复制失败，请手动选中令牌。');
    }
  }
  useEffect(() => {
    if (!connected) return;
    let active = true;
    getAssistantSettings().then((settings) => {
      if (!active) return;
      setAssistantBaseUrl(settings.baseUrl);
      setAssistantModel(settings.model);
      setAssistantHasKey(settings.hasApiKey);
      setAssistantPrivacy(settings.privacyMode);
    }).catch((error) => {
      if (active) setAssistantStatus(error instanceof Error ? error.message : '读取助手设置失败。');
    });
    return () => { active = false; };
  }, [connected]);
  async function saveAssistant(event: React.FormEvent) {
    event.preventDefault();
    setAssistantBusy(true);
    setAssistantStatus('');
    try {
      const saved = await saveAssistantSettings({ baseUrl: assistantBaseUrl, model: assistantModel, privacyMode: assistantPrivacy, ...(assistantKey.trim() ? { apiKey: assistantKey.trim() } : {}) });
      setAssistantBaseUrl(saved.baseUrl);
      setAssistantModel(saved.model);
      setAssistantHasKey(saved.hasApiKey);
      setAssistantPrivacy(saved.privacyMode);
      setAssistantKey('');
      setAssistantStatus('助手设置已保存到电脑。');
    } catch (error) {
      setAssistantStatus(error instanceof Error ? error.message : '保存助手设置失败。');
    } finally {
      setAssistantBusy(false);
    }
  }
  async function testAssistantModel() {
    setAssistantBusy(true);
    setAssistantStatus('正在测试模型服务…');
    try {
      const result = await testAssistant();
      setAssistantStatus(result.message || (result.ok ? '模型服务在线。' : '模型服务不可用。'));
    } catch (error) {
      setAssistantStatus(error instanceof Error ? error.message : '测试模型服务失败。');
    } finally {
      setAssistantBusy(false);
    }
  }
  async function clearAssistantKey() {
    setAssistantBusy(true);
    try {
      const saved = await saveAssistantSettings({ clearApiKey: true });
      setAssistantHasKey(saved.hasApiKey);
      setAssistantStatus('API Key 已清除。');
    } catch (error) {
      setAssistantStatus(error instanceof Error ? error.message : '清除 API Key 失败。');
    } finally {
      setAssistantBusy(false);
    }
  }
  const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).toLocaleString('zh-CN') : '';
  const remoteStatus = remote.status === 'synced'
    ? `${remote.message || '已同步'}${remoteTime ? ` · ${remoteTime}` : ''}`
    : remote.message;

  return <>
    <PageHeading title="按自己的节奏来。" description="调整偏好，或者把这一段生活好好存一份。" />
    {notice ? <p className="inline-notice page-notice" role="status">{notice}</p> : null}
    <section className="panel settings-panel"><h2>记录偏好</h2>
      <div className="setting-row"><Hourglass size={22} /><div><h3>消费换算时薪</h3><p>记满三个不同日期后，支出旁会显示估算工时。仅作参考，不改变账目。</p><form className="rate-form" noValidate onSubmit={async (event) => { event.preventDefault(); const result = await updateRate(rate); setNotice(result.ok ? '换算时薪已保存。' : result.message); }}><label>换算时薪（元/小时）<input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} disabled={blocked} /></label><button className="button secondary compact" disabled={blocked}>保存时薪</button></form></div></div>
      <div className="setting-row"><Download size={22} /><div><h3>导出个人数据</h3><p>导出全部记录为 CSV，Excel 可直接打开；示例通过出处列标注。CSV 暂不支持导入恢复。</p></div><div className="setting-actions"><button className="button secondary compact" disabled={blocked} onClick={() => { downloadText(exportCsv(records, workplaces), `顺手账单-${today}.csv`, 'text/csv;charset=utf-8'); setNotice('已发起 CSV 下载，请在浏览器下载列表查看。'); }}>导出 CSV</button></div></div>
      <div className="setting-row"><Database size={22} /><div><h3>本地数据</h3><p>本浏览器保留一份缓存；连接电脑后以电脑上的账本为准。清理浏览器数据会丢失缓存，请定期导出。</p></div><div className="setting-actions"><button className="button secondary compact" disabled={!hasExamples || blocked} onClick={() => setConfirm('examples')}>清空示例数据</button></div></div>
      <div className="setting-row"><LockKeyhole size={22} /><div><h3>备份与重置</h3><p>原始 JSON 可保留完整账本或排查损坏数据；当前不提供自动导入。重置将永久删除此浏览器中的记录和单位。</p></div><div className="setting-actions"><button className="button secondary compact" disabled={rawData === null} onClick={() => { if (rawData !== null) { downloadText(rawData, `顺手原始备份-${today}.json`, 'application/json;charset=utf-8'); setNotice('已发起原始备份下载，请确认文件已保存。'); } }}>下载原始备份</button><button className="button secondary compact danger-text" onClick={() => setConfirm('reset')}>重置账本</button></div></div>
    </section>
    <section className="panel settings-panel">
      <h2>账号与后端</h2>
      <div className="setting-row"><Laptop size={22} /><div><h3>{connected ? `已登录${account || gatewayUsername() ? `：${account || gatewayUsername()}` : ''}` : '登录账号或连接网关'}</h3><p>云端后端使用账号和密码登录；本机网关仍使用启动口令。登录后账本、生活记录和校园授权都按账号隔离。</p>
        {connected ? <>
          <p className="form-hint" role="status">{remoteStatus || '已连接。'}</p>
          <div className="setting-actions">
            <button className="button secondary compact" disabled={blocked} onClick={async () => { const result = await refreshRemote(); setNotice(result.ok ? '已与云端同步。' : result.message); }}>立即同步</button>
            {remote.status === 'conflict' ? <><button className="button secondary compact" disabled={blocked} onClick={async () => { const result = await uploadLocalToRemote(); setNotice(result.ok ? '已用本机账本覆盖云端。' : result.message); }}>用本机覆盖云端</button><button className="button secondary compact" onClick={async () => { const result = await adoptRemote(); setNotice(result.ok ? '已用云端账本覆盖本机。' : result.message); }}>用云端覆盖本机</button></> : null}
            <button className="button secondary compact danger-text" disabled={connecting} onClick={disconnect}>退出登录</button>
          </div>
          {remote.status === 'conflict' ? <p className="form-hint">切换账号时不会自动把上一个账号的本机账本上传。请先导出备份，再选择保留哪一份；要使用全新的空账号，请先重置本机账本。</p> : null}
        </> : cloudMode ? <div className="account-cta">
          <div className="setting-actions">
            <Link className="button primary compact" to="/login">登录账号</Link>
            <Link className="button secondary compact" to="/register">注册新账号</Link>
          </div>
          <p className="form-hint">云端后端使用账号和密码登录。登录后账本、生活记录和校园授权都按账号隔离；首个注册账号会继承此前的单账号数据。</p>
          <details className="auth-advanced">
            <summary>云端服务地址</summary>
            <label>服务地址<input value={gatewayAddress} onChange={(event) => setGatewayAddress(event.target.value)} placeholder="https://你的站点/functions/v1/app" /></label>
            <p className="form-hint">部署在 Qoder Sites 时已自动填好，一般不用改。</p>
          </details>
        </div> : <form className="rate-form" onSubmit={connect}>
          <label>服务地址<input value={gatewayAddress} onChange={(event) => setGatewayAddress(event.target.value)} placeholder="https://xxxx.trycloudflare.com 或 http://127.0.0.1:18787" /></label>
          <label>访问口令<input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="本机首次启动时打印的口令" /></label>
          <button type="button" className="button secondary compact" onClick={testService}>测试服务</button>
          <button type="button" className="button secondary compact" disabled={connecting || password.length < 8}>{connecting ? '正在连接' : '连接'}</button>
          <p className="form-hint">本机网关使用启动时打印的访问口令。</p>
        </form>}
        {connectionStatus ? <p className="form-hint" role="status">{connectionStatus}</p> : null}
      </div></div>
      {connected && cloudMode ? <div className="account-panel-wrap">
        <AccountPanel onLoggedOut={() => { clearGatewaySession(); setConnected(false); setAccount(''); setConnectionStatus('已退出登录，请重新登录。'); }} />
      </div> : null}
      <div className="setting-row"><Smartphone size={22} /><div><h3>手机采集</h3><p>让手机 App 扫码配对，样本会自动传到这里并导入；只导入已确认的支出，收入和待确认会跳过。也可以继续用地址和口令手动同步。</p>
        <div className="setting-actions">
          <button type="button" className="button secondary compact" disabled={pairingBusy || blocked || !connected} onClick={startPairing}>{pairingBusy ? '正在生成' : '手机扫码配对'}</button>
          <button type="button" className="button secondary compact" disabled={syncing || blocked || !connected} onClick={pullSamples}>{syncing ? '正在导入' : '拉取并导入'}</button>
        </div>
        {pairing ? <div className="pairing-box">
          <canvas ref={pairingCanvasRef} className="pairing-qr" aria-label="手机配对二维码" />
          <div className="pairing-meta">
            <p>手机打开「顺手采集」→ 连接设置 → 扫码配对，扫完会自动上传现有样本。</p>
            {pairing.urls.length > 1 ? <label>手机能访问的地址<select value={pairing.url} onChange={(event) => setPairing({ ...pairing, url: event.target.value })}>{pairing.urls.map((item) => <option key={item.url} value={item.url}>{item.label} · {item.url}</option>)}</select></label> : null}
            <p className="form-hint">目标地址：{pairing.url}<br />有效期至 {new Date(pairing.expiresAt).toLocaleTimeString('zh-CN')}，过期后请刷新二维码。</p>
            <div className="setting-actions">
              <button type="button" className="button secondary compact" disabled={pairingBusy} onClick={startPairing}>刷新二维码</button>
              <button type="button" className="button secondary compact" onClick={() => { setPairing(null); setPairingStatus(''); }}>收起</button>
            </div>
            {pairingStatus ? <p className="form-hint" role="status">{pairingStatus}</p> : null}
          </div>
        </div> : pairingStatus ? <p className="form-hint" role="status">{pairingStatus}</p> : null}
        {syncStatus ? <p className="form-hint" role="status">{syncStatus}</p> : null}
      </div></div>
    </section>
    <section className="panel settings-panel" aria-labelledby="mcp-settings-title">
      <h2 id="mcp-settings-title">生活服务</h2>
      <McpServicesPanel connected={connected} cloudMode={cloudMode} />
    </section>
    <section className="panel settings-panel" aria-labelledby="campus-settings-title">
      <h2 id="campus-settings-title"><GraduationCap size={20} /> 校园助手</h2>
      <p className="settings-lead">校园助手运行在云端，通过 HDUHelp 官方设备授权连接；PAT 只保存在云端数据库，网页拿不到。报名、选座、群聊等写操作每次都会要求确认。</p>
      {!connected ? <p className="form-hint">先连接上面的云端后端，再连接校园助手。</p> : campusLoading && !campusStatus ? <p className="form-hint" role="status">正在读取校园授权状态…</p> : campusStatusError ? <p className="form-error" role="alert">{campusStatusError}</p> : campusStatus?.connected ? <>
        <div className="setting-row"><Laptop size={22} /><div><h3>校园授权已连接</h3><p>{campusStatus.scopes.length} 项权限{ campusStatus.expiresAt ? ` · 到期 ${new Date(campusStatus.expiresAt).toLocaleDateString('zh-CN')}` : ' · 长期有效' }。待完成的授权请到校园页查看。</p>
          <div className="setting-actions">
            <button type="button" className="button secondary compact" disabled={campusBusy} onClick={() => void refreshCampusCloud()}>刷新</button>
            <Link className="button secondary compact" to="/campus">打开校园页</Link>
            <button type="button" className="button secondary compact" disabled={campusBusy} onClick={() => void reauthorizeCampus()}>补充全部权限</button>
            <button type="button" className="button secondary compact danger-text" disabled={campusBusy} onClick={() => void disconnectCampusCloud()}>断开校园授权</button>
          </div>
        </div></div>
        {campusStatus.pending ? <p className="form-hint">有一个等待确认的授权，请到校园页打开授权页。</p> : null}
      </> : <div className="setting-row"><Laptop size={22} /><div><h3>还没有连接校园助手</h3><p>到校园页生成 HDUHelp 授权链接，在你的 HDUHelp 账号里确认设备与权限清单；网页不会接收学校密码。</p>
        <div className="setting-actions"><Link className="button secondary compact" to="/campus">去校园页连接</Link></div>
      </div></div>}
      {campusMessage ? <p className="form-hint" role="status">{campusMessage}</p> : null}
    </section>
    <section className="panel settings-panel" aria-labelledby="assistant-settings-title">
      <h2 id="assistant-settings-title"><Sparkles size={20} /> AI 助手</h2>
      <p className="settings-lead">助手页用这里的模型理解你的话，并调用顺手里的工具。API Key 只保存在电脑，不会回传到浏览器；留空表示继续使用已保存的 Key。</p>
      {!connected ? <p className="form-hint">先连接电脑，再配置模型。</p> : <>
        <form className="agent-token-form assistant-settings-form" onSubmit={saveAssistant}>
          <label>模型地址<input value={assistantBaseUrl} onChange={(event) => setAssistantBaseUrl(event.target.value)} placeholder="http://127.0.0.1:11434/v1" disabled={assistantBusy} /></label>
          <label>模型名称<input value={assistantModel} onChange={(event) => setAssistantModel(event.target.value)} placeholder="例如 ling-3.0-tiny:32k" maxLength={200} disabled={assistantBusy} /></label>
          <label>API Key<input type="password" autoComplete="off" value={assistantKey} onChange={(event) => setAssistantKey(event.target.value)} placeholder={assistantHasKey ? '已保存，留空保持不变' : '本机 Ollama 可留空'} disabled={assistantBusy} /></label>
          <label>隐私模式<select value={assistantPrivacy} onChange={(event) => setAssistantPrivacy(event.target.value as AssistantSettings['privacyMode'])} disabled={assistantBusy}><option value="redact">云端脱敏（推荐）</option><option value="local-only">只在本机（云端会拒绝）</option><option value="off">不脱敏</option></select></label>
          <div className="setting-actions">
            <button className="button secondary compact" disabled={assistantBusy}>{assistantBusy ? '正在处理' : '保存模型设置'}</button>
            <button type="button" className="button secondary compact" disabled={assistantBusy} onClick={testAssistantModel}>测试连接</button>
            {assistantHasKey ? <button type="button" className="button secondary compact danger-text" disabled={assistantBusy} onClick={clearAssistantKey}>清除 Key</button> : null}
            <Link className="button secondary compact" to="/assistant">打开助手</Link>
          </div>
        </form>
        {assistantStatus ? <p className="form-hint" role="status">{assistantStatus}</p> : null}
        <p className="form-hint">本机 Ollama 填 <code>http://127.0.0.1:11434/v1</code>；云端填兼容 OpenAI 的地址和 Key。默认“云端脱敏”：姓名、学号、手机、卡号、课程名等先换占位符再发给服务商，回复在本机还原。占位符不是硬隔离，时间和金额结构仍可能被推断；切到云端前请确认这个取舍。</p>
      </>}
    </section>
    <section className="panel settings-panel" aria-labelledby="agent-api-title">
      <h2 id="agent-api-title"><Bot size={20} /> Agent 接口</h2>
      <p className="settings-lead">给以后接入的助手一把可撤销的钥匙：通过电脑上的接口查看安排、账本摘要和校园服务，也可以新建或修改日程、开始专注、加倒计时。删除日程不开放给助手，删除仍在页面里做；助手也不会替你记账、付款、提交申请或签字。</p>
      {!connected ? <p className="form-hint">先在下面连接电脑，再生成 Agent 令牌。</p> : <>
        <form className="agent-token-form" onSubmit={createAgent}>
          <label>令牌名称<input value={agentName} onChange={(event) => setAgentName(event.target.value)} maxLength={40} required disabled={agentBusy} /></label>
          <label>权限<select value={agentScope} onChange={(event) => setAgentScope(event.target.value as AgentToken['scope'])} disabled={agentBusy}><option value="read">只读：查看安排和摘要</option><option value="write">可写：还能新建日程和开始专注</option></select></label>
          <button className="button secondary compact" disabled={agentBusy || !agentName.trim()}>{agentBusy ? '正在处理' : '生成 Agent 令牌'}</button>
        </form>
        {newAgentToken ? <div className="agent-token-once" role="status">
          <p><KeyRound size={16} /><span><strong>新令牌只显示这一次。</strong>复制到 agent 的配置里；离开本页后无法再查看。</span></p>
          <label>新令牌（只显示一次）<input readOnly value={newAgentToken} onFocus={(event) => event.currentTarget.select()} /></label>
          <div className="setting-actions"><button type="button" className="button secondary compact" onClick={copyAgentToken}>复制令牌</button><button type="button" className="button secondary compact" onClick={() => setNewAgentToken('')}>隐藏</button></div>
        </div> : null}
        {agentStatus ? <p className="form-hint" role="status">{agentStatus}</p> : null}
        <div className="planner-section-title"><h3>已生成的令牌</h3><button type="button" className="text-link" onClick={() => void refreshAgentPanel()}>刷新</button></div>
        {agents.length ? <ul className="planner-list agent-token-list">{agents.map((agent) => <li key={agent.id}>
          <div><strong>{agent.name}</strong><p>{agent.scope === 'read' ? '只读' : '可写'} · 创建于 {new Date(agent.createdAt).toLocaleDateString('zh-CN')}{agent.lastUsedAt ? ` · 最近使用 ${new Date(agent.lastUsedAt).toLocaleString('zh-CN')}` : ' · 还没使用过'}</p></div>
          <button type="button" className="button secondary compact danger-text" disabled={agentBusy} aria-label={`吊销 Agent 令牌 ${agent.name}`} onClick={() => setAgentToRevoke(agent)}>吊销</button>
        </li>)}</ul> : <p className="form-hint">还没有 Agent 令牌。先生成一个只读令牌给助手试用。</p>}
        <div className="planner-section-title"><h3>最近操作</h3><span className="form-hint">只记录工具、时间和结果，不保存令牌。</span></div>
        {agentAudit.length ? <ul className="planner-list agent-audit-list">{agentAudit.slice(0, 12).map((entry, index) => <li key={`${entry.at}-${index}`}>
          <div><strong>{toolLabel(entry.tool)}</strong><p>{new Date(entry.at).toLocaleString('zh-CN')} · {entry.actor}{entry.summary && entry.summary !== '{}' ? <> · <code>{entry.summary}</code></> : null}</p></div>
          <span className={`subtle-tag${entry.ok ? '' : ' danger-text'}`}>{entry.ok ? '成功' : entry.error ?? '失败'}</span>
        </li>)}</ul> : <p className="form-hint">还没有助手操作。接入后会在这里留下记录。</p>}
      </>}
      <p className="form-hint">接口说明在 <code>docs/agent-api.md</code>；令牌默认 365 天后过期，也可以随时吊销。</p>
    </section>
    <section className="privacy-note"><LockKeyhole size={21} /><div><h3>数据留在你自己的电脑上。</h3><p>账本和采集样本只存在你的电脑；网页通过加密连接读取，登录令牌 7 天有效。Agent 令牌可以随时吊销，只读令牌不能修改任何内容。页面已打开时，断网也能记账和保存，联网后自动补传。顺手不会替你付款、提交申请或签字。</p></div></section>
    <div className="version-note"><Sprout size={22} /><strong>顺手</strong><span>校园个人助手</span><span>v0.6 AI 工作台与全功能工具</span></div>
    {agentToRevoke ? <ConfirmDialog title="吊销这个 Agent 令牌？" description={`「${agentToRevoke.name}」将立即失去访问权限；它已经写过的日程、专注和倒计时不会删除。`} confirmLabel="确认吊销" onCancel={() => setAgentToRevoke(null)} onConfirm={async () => { const target = agentToRevoke; setAgentToRevoke(null); await revokeAgent(target); }} /> : null}
    {confirm ? <ConfirmDialog title={confirm === 'examples' ? '清空示例数据？' : '永久重置这份账本？'} description={confirm === 'examples' ? '只删除示例记录和未使用的示例单位，不影响你的真实记录。' : '此浏览器的全部记录、单位和时薪设置都会被清空。请先确认备份已下载；此操作不能撤销。'} confirmLabel={confirm === 'examples' ? '确认清空示例' : '确认重置全部数据'} onCancel={() => setConfirm(null)} onConfirm={async () => { const result = await (confirm === 'examples' ? clearExamples() : resetLedger()); if (result.ok && confirm === 'reset') setRate('20.00'); setNotice(result.ok ? (confirm === 'examples' ? '示例数据已清空。' : '账本已重置，可以重新开始记录。') : result.message); setConfirm(null); }} /> : null}
  </>;
}
