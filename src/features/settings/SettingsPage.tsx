import { useState } from 'react';
import { Database, Download, Hourglass, LockKeyhole, Smartphone, Sprout } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useRecords } from '../../data/RecordsProvider';
import { downloadText, exportCsv } from '../../domain/csv';
import { probeSamplesToRecords } from '../../domain/probeImport';

export function SettingsPage() {
  const { records, workplaces, settings, today, rawData, blocked, updateRate, clearExamples, resetLedger, importRecords } = useRecords();
  const [rate, setRate] = useState((settings.hourlyRateCents / 100).toFixed(2));
  const [notice, setNotice] = useState('');
  const [syncUrl, setSyncUrl] = useState('http://127.0.0.1:18787');
  const [syncStatus, setSyncStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [confirm, setConfirm] = useState<'examples' | 'reset' | null>(null);
  const hasExamples = records.some((record) => record.source === 'demo') || workplaces.some((unit) => unit.source === 'demo');

  function serviceUrl(): string {
    const url = syncUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) throw new Error('地址需以 http:// 或 https:// 开头。');
    return url;
  }

  async function testSync() {
    setSyncing(true);
    setSyncStatus('');
    try {
      const response = await fetch(`${serviceUrl()}/api/health`);
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || body.ok !== true) throw new Error('服务返回异常。');
      setSyncStatus(`已连接，本机服务有 ${Number(body.samples) || 0} 条样本。`);
    } catch (error) {
      setSyncStatus(`连接失败：${error instanceof Error ? error.message : '请确认电脑端已运行 npm run sync。'}`);
    } finally {
      setSyncing(false);
    }
  }

  async function pullSamples(event: React.FormEvent) {
    event.preventDefault();
    setSyncing(true);
    setSyncStatus('');
    try {
      const response = await fetch(`${serviceUrl()}/api/samples`);
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || body.ok !== true || !Array.isArray(body.samples)) {
        throw new Error('同步服务返回异常。');
      }
      const result = probeSamplesToRecords(body.samples);
      const saved = await importRecords(result.records);
      if (!saved.ok) throw new Error(saved.message);
      setSyncStatus(`导入 ${result.records.length} 笔支出；跳过收入 ${result.skippedIncome}、待确认 ${result.skippedPending}、无效 ${result.invalid}。`);
    } catch (error) {
      setSyncStatus(`导入失败：${error instanceof Error ? error.message : '请检查同步地址。'}`);
    } finally {
      setSyncing(false);
    }
  }
  return <>
    <PageHeading title="按自己的节奏来。" description="调整偏好，或者把这一段生活好好存一份。" />
    {notice ? <p className="inline-notice page-notice" role="status">{notice}</p> : null}
    <section className="panel settings-panel"><h2>记录偏好</h2>
      <div className="setting-row"><Hourglass size={22} /><div><h3>消费换算时薪</h3><p>记满三个不同日期后，支出旁会显示估算工时。仅作参考，不改变账目。</p><form className="rate-form" noValidate onSubmit={async (event) => { event.preventDefault(); const result = await updateRate(rate); setNotice(result.ok ? '换算时薪已保存。' : result.message); }}><label>换算时薪（元/小时）<input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} disabled={blocked} /></label><button className="button secondary compact" disabled={blocked}>保存时薪</button></form></div></div>
      <div className="setting-row"><Download size={22} /><div><h3>导出个人数据</h3><p>导出全部记录为 CSV，Excel 可直接打开；示例通过出处列标注。CSV 暂不支持导入恢复。</p></div><div className="setting-actions"><button className="button secondary compact" disabled={blocked} onClick={() => { downloadText(exportCsv(records, workplaces), `顺手账单-${today}.csv`, 'text/csv;charset=utf-8'); setNotice('已发起 CSV 下载，请在浏览器下载列表查看。'); }}>导出 CSV</button></div></div>
      <div className="setting-row"><Database size={22} /><div><h3>本地数据</h3><p>数据仅保存在当前浏览器，不会跨设备同步。清理浏览器数据会丢失账本，请定期导出。</p></div><div className="setting-actions"><button className="button secondary compact" disabled={!hasExamples || blocked} onClick={() => setConfirm('examples')}>清空示例数据</button></div></div>
      <div className="setting-row"><LockKeyhole size={22} /><div><h3>备份与重置</h3><p>原始 JSON 可保留完整账本或排查损坏数据；当前不提供自动导入。重置将永久删除此浏览器中的记录和单位。</p></div><div className="setting-actions"><button className="button secondary compact" disabled={rawData === null} onClick={() => { if (rawData !== null) { downloadText(rawData, `顺手原始备份-${today}.json`, 'application/json;charset=utf-8'); setNotice('已发起原始备份下载，请确认文件已保存。'); } }}>下载原始备份</button><button className="button secondary compact danger-text" onClick={() => setConfirm('reset')}>重置账本</button></div></div>
    </section>
    <section className="panel settings-panel">
      <h2>手机采集同步</h2>
      <div className="setting-row"><Smartphone size={22} /><div><h3>本机同步</h3><p>电脑运行 <code>npm run sync</code> 后填地址；手机同一 Wi-Fi，或用 adb reverse。只导入已确认的支出，收入和待确认会跳过。</p><form className="rate-form" noValidate onSubmit={pullSamples}><label>同步地址<input value={syncUrl} onChange={(event) => setSyncUrl(event.target.value)} placeholder="http://127.0.0.1:18787" /></label><button type="button" className="button secondary compact" disabled={syncing} onClick={testSync}>测试连接</button><button className="button secondary compact" disabled={syncing || blocked}>拉取并导入</button></form>{syncStatus ? <p className="form-hint" role="status">{syncStatus}</p> : null}</div></div>
    </section>
    <section className="privacy-note"><LockKeyhole size={21} /><div><h3>不需要账号，也不会把账单上传。</h3><p>页面已打开时，断网也能记账和保存；当前未提供离线启动或云同步。顺手不会替你付款、提交申请或签字。</p></div></section>
    <div className="version-note"><Sprout size={22} /><strong>顺手</strong><span>校园个人助手</span><span>v0.2 本机记账版</span></div>
    {confirm ? <ConfirmDialog title={confirm === 'examples' ? '清空示例数据？' : '永久重置这份账本？'} description={confirm === 'examples' ? '只删除示例记录和未使用的示例单位，不影响你的真实记录。' : '此浏览器的全部记录、单位和时薪设置都会被清空。请先确认备份已下载；此操作不能撤销。'} confirmLabel={confirm === 'examples' ? '确认清空示例' : '确认重置全部数据'} onCancel={() => setConfirm(null)} onConfirm={async () => { const result = await (confirm === 'examples' ? clearExamples() : resetLedger()); if (result.ok && confirm === 'reset') setRate('20.00'); setNotice(result.ok ? (confirm === 'examples' ? '示例数据已清空。' : '账本已重置，可以重新开始记录。') : result.message); setConfirm(null); }} /> : null}
  </>;
}
