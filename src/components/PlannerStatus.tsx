import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { backendNoun, gatewayUrl } from '../data/gateway';
import { usePlanner } from '../data/PlannerProvider';
import { downloadText } from '../domain/csv';
import { ConfirmDialog } from './ConfirmDialog';
import { plannerSchema } from '../domain/planner';
import type { PlannerState } from '../domain/planner';
import { envelopeSchema, projectedState } from '../data/plannerStorage';

export function PlannerStatus() {
  const planner = usePlanner();
  const [serverChoice, setServerChoice] = useState<string | null>(null);
  const [choice, setChoice] = useState<'local' | 'remote' | null>(null);
  const [backup, setBackup] = useState<PlannerState | null>(null);
  const [importError, setImportError] = useState('');
  return <>
    <section className="planner-status" aria-label="生活记录同步">
      <div><p role="status">{planner.status}{planner.pending ? ` · ${planner.pending} 项待同步` : ''}</p>{planner.error ? <p className="form-error" role="alert">{planner.error}</p> : null}</div>
      <div className="planner-actions"><button className="button secondary compact" disabled={planner.busy || planner.blocked} onClick={() => void planner.sync()}><RefreshCw size={15} />同步生活记录</button>
        <button className="button secondary compact" onClick={() => downloadText(planner.raw ?? JSON.stringify(planner.state), '顺手生活记录备份.json', 'application/json')}>备份生活记录</button>
        {planner.serverBound ? <button className="button secondary compact" disabled={planner.busy || planner.blocked} onClick={() => setServerChoice(gatewayUrl())}>切换生活记录来源</button> : null}
        {(planner.error.includes('冲突') || planner.status.includes('冲突')) ? <><button className="button secondary compact" onClick={() => setChoice('local')}>保留这项本机修改</button><button className="button secondary compact" onClick={() => setChoice('remote')}>采用这项{backendNoun()}修改</button></> : null}
      </div>
    </section>
    <details className="planner-backup"><summary>从备份恢复生活记录</summary><p className="form-hint">不会修改账本。恢复前自动保留当前生活记录；绑定{backendNoun()}后不支持整份覆盖。</p><label>导入生活记录备份<input type="file" accept=".json,application/json" disabled={planner.busy || planner.serverBound} onChange={async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setImportError('');
      try {
        if (file.size > 5_000_000) throw new Error('备份不能超过5MB。');
        const data: unknown = JSON.parse(await file.text());
        const envelope = envelopeSchema.safeParse(data);
        const parsed = envelope.success ? projectedState(envelope.data) : plannerSchema.parse(data);
        if (parsed.focusSessions.some((s) => s.status === 'running' || s.status === 'paused')) throw new Error('备份包含未结束的专注，暂不能恢复。');
        setBackup(parsed);
      } catch (error) { setImportError(error instanceof Error && error.name !== 'ZodError' ? error.message : '备份格式不正确，当前数据未改动。'); }
    }} /></label>{importError ? <p className="form-error" role="alert">{importError}</p> : null}</details>
    {serverChoice !== null ? <ConfirmDialog title="切换到当前连接的生活记录？" description={`目标：${serverChoice || '当前站点'}。建议先导出备份。原来源记录和待同步队列会单独保留，不上传到新服务器；重新连接旧来源并确认切换即可恢复。账本不在此操作范围内。`} confirmLabel="确认切换来源" onCancel={() => setServerChoice(null)} onConfirm={async () => { const result = await planner.switchServer(serverChoice); if (result.ok) setServerChoice(null); }} /> : null}
    {backup ? <ConfirmDialog title="恢复这份生活记录？" description={`将覆盖本浏览器的生活记录：${backup.events.length}条日程、${backup.focusSessions.length}段专注、${backup.trips.length}趟旅行。当前数据会先备份。`} confirmLabel="确认恢复" onCancel={() => setBackup(null)} onConfirm={async () => { const result = await planner.restore(backup); if (result.ok) setBackup(null); else setImportError(result.message); }} /> : null}
    {choice ? <ConfirmDialog title="处理第一项冲突？" description="先导出备份；本操作只处理队列里的第一项，不会整份覆盖账本。" confirmLabel="确认处理" onCancel={() => setChoice(null)} onConfirm={async () => { await planner.resolve(choice); setChoice(null); }} /> : null}
  </>;
}
