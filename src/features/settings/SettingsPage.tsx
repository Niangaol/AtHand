import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Database, Download, Hourglass, KeyRound, Laptop, LockKeyhole, Smartphone, Sparkles, Sprout } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useRecords } from '../../data/RecordsProvider';
import { downloadText, exportCsv } from '../../domain/csv';
import { probeSamplesToRecords } from '../../domain/probeImport';
import { gatewayFetch, gatewayLogin, gatewayLogout, gatewayUrl, isGatewayConnected } from '../../data/gateway';
import { createAgentToken, listAgentAudit, listAgentTokens, revokeAgentToken } from '../../data/agentTokens';
import type { AgentAuditEntry, AgentToken } from '../../data/agentTokens';
import { getAssistantSettings, saveAssistantSettings, testAssistant } from '../../data/assistant';
import { toolLabel } from '../../data/agentToolLabels';

export function SettingsPage() {
  const { records, workplaces, settings, today, rawData, blocked, updateRate, clearExamples, resetLedger, importRecords, remote, refreshRemote, uploadLocalToRemote, adoptRemote, disconnectRemote } = useRecords();
  const [rate, setRate] = useState((settings.hourlyRateCents / 100).toFixed(2));
  const [notice, setNotice] = useState('');
  const [gatewayAddress, setGatewayAddress] = useState(gatewayUrl() || 'http://127.0.0.1:18787');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(isGatewayConnected());
  const [connecting, setConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
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
  const [assistantStatus, setAssistantStatus] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const hasExamples = records.some((record) => record.source === 'demo') || workplaces.some((unit) => unit.source === 'demo');

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
      setPassword('');
      const result = await refreshRemote();
      setConnectionStatus(result.ok ? '已连接电脑，账本已对齐。' : result.message);
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : '连接失败。');
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
      setConnecting(false);
      setConnectionStatus('已断开，电脑上的登录令牌也已作废。');
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
      const saved = await saveAssistantSettings({ baseUrl: assistantBaseUrl, model: assistantModel, ...(assistantKey.trim() ? { apiKey: assistantKey.trim() } : {}) });
      setAssistantBaseUrl(saved.baseUrl);
      setAssistantModel(saved.model);
      setAssistantHasKey(saved.hasApiKey);
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
      <h2>电脑与网页</h2>
      <div className="setting-row"><Laptop size={22} /><div><h3>{connected ? '已连接电脑' : '连接我的电脑'}</h3><p>把电脑当作服务器：网页、手机和电脑共用同一份账本。远程访问时填隧道的 HTTPS 地址；口令在电脑第一次启动 <code>npm run sync</code> 时打印，之后不再显示。</p>
        {connected ? <>
          <p className="form-hint" role="status">{remoteStatus || '已连接。'}</p>
          <div className="setting-actions">
            <button className="button secondary compact" disabled={blocked} onClick={async () => { const result = await refreshRemote(); setNotice(result.ok ? '已与电脑同步。' : result.message); }}>立即同步</button>
            {remote.status === 'conflict' ? <><button className="button secondary compact" disabled={blocked} onClick={async () => { const result = await uploadLocalToRemote(); setNotice(result.ok ? '已用本机账本覆盖电脑。' : result.message); }}>用本机覆盖电脑</button><button className="button secondary compact" onClick={async () => { const result = await adoptRemote(); setNotice(result.ok ? '已用电脑账本覆盖本机。' : result.message); }}>用电脑覆盖本机</button></> : null}
            <button className="button secondary compact danger-text" disabled={connecting} onClick={disconnect}>断开连接</button>
          </div>
        </> : <form className="rate-form" onSubmit={connect}>
          <label>电脑地址<input value={gatewayAddress} onChange={(event) => setGatewayAddress(event.target.value)} placeholder="https://xxxx.trycloudflare.com 或 http://127.0.0.1:18787" /></label>
          <label>访问口令<input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="首次启动时打印的口令" /></label>
          <button type="button" className="button secondary compact" onClick={testService}>测试服务</button>
          <button className="button secondary compact" disabled={connecting || password.length < 8}>{connecting ? '正在连接' : '连接'}</button>
        </form>}
        {connectionStatus ? <p className="form-hint" role="status">{connectionStatus}</p> : null}
      </div></div>
      <div className="setting-row"><Smartphone size={22} /><div><h3>手机采集</h3><p>手机 App 填同一个地址和口令后上传样本；这里只导入已确认的支出，收入和待确认会跳过。</p><div className="setting-actions"><button type="button" className="button secondary compact" disabled={syncing || blocked || !connected} onClick={pullSamples}>拉取并导入</button></div>{syncStatus ? <p className="form-hint" role="status">{syncStatus}</p> : null}</div></div>
    </section>
    <section className="panel settings-panel" aria-labelledby="assistant-settings-title">
      <h2 id="assistant-settings-title"><Sparkles size={20} /> AI 助手</h2>
      <p className="settings-lead">助手页用这里的模型理解你的话，并调用顺手里的工具。API Key 只保存在电脑，不会回传到浏览器；留空表示继续使用已保存的 Key。</p>
      {!connected ? <p className="form-hint">先连接电脑，再配置模型。</p> : <>
        <form className="agent-token-form assistant-settings-form" onSubmit={saveAssistant}>
          <label>模型地址<input value={assistantBaseUrl} onChange={(event) => setAssistantBaseUrl(event.target.value)} placeholder="http://127.0.0.1:11434/v1" disabled={assistantBusy} /></label>
          <label>模型名称<input value={assistantModel} onChange={(event) => setAssistantModel(event.target.value)} placeholder="例如 ling-3.0-tiny:32k" maxLength={200} disabled={assistantBusy} /></label>
          <label>API Key<input type="password" autoComplete="off" value={assistantKey} onChange={(event) => setAssistantKey(event.target.value)} placeholder={assistantHasKey ? '已保存，留空保持不变' : '本机 Ollama 可留空'} disabled={assistantBusy} /></label>
          <div className="setting-actions">
            <button className="button secondary compact" disabled={assistantBusy}>{assistantBusy ? '正在处理' : '保存模型设置'}</button>
            <button type="button" className="button secondary compact" disabled={assistantBusy} onClick={testAssistantModel}>测试连接</button>
            {assistantHasKey ? <button type="button" className="button secondary compact danger-text" disabled={assistantBusy} onClick={clearAssistantKey}>清除 Key</button> : null}
            <Link className="button secondary compact" to="/assistant">打开助手</Link>
          </div>
        </form>
        {assistantStatus ? <p className="form-hint" role="status">{assistantStatus}</p> : null}
        <p className="form-hint">本机 Ollama 填 <code>http://127.0.0.1:11434/v1</code>；云端填兼容 OpenAI 的地址和 Key。接云端时，日程和账本摘要会发给服务商。</p>
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
