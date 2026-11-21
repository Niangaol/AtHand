import { useState } from 'react';
import { Database, Download, Hourglass, Laptop, LockKeyhole, Smartphone, Sprout } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useRecords } from '../../data/RecordsProvider';
import { downloadText, exportCsv } from '../../domain/csv';
import { probeSamplesToRecords } from '../../domain/probeImport';
import { gatewayFetch, gatewayLogin, gatewayLogout, gatewayUrl, isGatewayConnected } from '../../data/gateway';

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
    <section className="privacy-note"><LockKeyhole size={21} /><div><h3>数据留在你自己的电脑上。</h3><p>账本和采集样本只存在你的电脑；网页通过加密连接读取，登录令牌 7 天有效。页面已打开时，断网也能记账和保存，联网后自动补传。顺手不会替你付款、提交申请或签字。</p></div></section>
    <div className="version-note"><Sprout size={22} /><strong>顺手</strong><span>校园个人助手</span><span>v0.3 电脑作服务器</span></div>
    {confirm ? <ConfirmDialog title={confirm === 'examples' ? '清空示例数据？' : '永久重置这份账本？'} description={confirm === 'examples' ? '只删除示例记录和未使用的示例单位，不影响你的真实记录。' : '此浏览器的全部记录、单位和时薪设置都会被清空。请先确认备份已下载；此操作不能撤销。'} confirmLabel={confirm === 'examples' ? '确认清空示例' : '确认重置全部数据'} onCancel={() => setConfirm(null)} onConfirm={async () => { const result = await (confirm === 'examples' ? clearExamples() : resetLedger()); if (result.ok && confirm === 'reset') setRate('20.00'); setNotice(result.ok ? (confirm === 'examples' ? '示例数据已清空。' : '账本已重置，可以重新开始记录。') : result.message); setConfirm(null); }} /> : null}
  </>;
}
