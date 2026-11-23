import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BriefcaseBusiness, Info, Wallet } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { backendMode } from '../../data/gateway';
import { useRecords } from '../../data/RecordsProvider';
import { buildRecord } from '../../domain/ledger';
import type { RecordDraft } from '../../domain/ledger';
import { expenseCategories } from '../../domain/records';
import type { RecordEntry } from '../../domain/records';
import { money } from '../../domain/summary';

export function EntryPage() {
  const { id } = useParams();
  const { records } = useRecords();
  const record = records.find((item) => item.id === id);
  if (id && !record) return <section className="panel planned-page"><h1>这笔记录已不存在</h1><p>请回到账单选择其他记录。</p><Link className="button primary" to="/ledger">回到周账单</Link></section>;
  return <EntryForm key={id ?? 'new'} record={record} />;
}

function EntryForm({ record }: { record?: RecordEntry }) {
  const { workplaces, records, today, settings, saveRecord, blocked, saving } = useRecords();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<RecordDraft>(() => ({
    type: record?.type ?? 'work', date: record?.date ?? today, title: record?.title ?? '',
    workplaceId: record?.type === 'work' ? record.workplaceId : workplaces[0]?.id ?? '',
    startTime: record?.type === 'work' ? record.startTime : '09:00',
    endTime: record?.type === 'work' ? record.endTime : '12:00',
    nextDay: record?.type === 'work' ? record.endTime <= record.startTime : false,
    duration: record?.type === 'work' ? String(record.durationMinutes) : '',
    hourlyRate: ((record?.type === 'work' ? record.hourlyRateCents : workplaces[0]?.hourlyRateCents ?? settings.hourlyRateCents) / 100).toFixed(2),
    amount: record?.type === 'expense' ? (record.amountCents / 100).toFixed(2) : '',
    category: record?.type === 'expense' ? record.category : '吃饭',
  }));
  const workRef = useRef<HTMLButtonElement>(null);
  const expenseRef = useRef<HTMLButtonElement>(null);
  function update<K extends keyof RecordDraft>(key: K, value: RecordDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setError('');
  }
  let preview: RecordEntry | null = null;
  try { preview = buildRecord(draft, workplaces, record?.id ?? 'preview'); } catch { /* Incomplete inputs have no preview. */ }
  const hasExamples = records.some((item) => item.source === 'demo');
  const cloudMode = backendMode() === 'cloud';
  const savedNotice = record
    ? (cloudMode ? '记录已更新，同步到云端账号。' : '记录已更新，并保存在本机。')
    : (cloudMode ? '记录已保存，同步到云端账号。' : '记录已保存到本机。');

  return <>
    <PageHeading title={record ? '把这一笔，重新理一理。' : '一笔小事，顺手记下。'} description={cloudMode ? '保存后同步到云端账号。记完后，今天、周账单和月报会一起更新。' : '数据只保存在当前浏览器。记完后，今天、周账单和月报会一起更新。'} action={record ? <Link className="button secondary" to="/ledger">取消编辑</Link> : undefined} />
    <div className="entry-layout"><section className="panel entry-panel">
      <div className="entry-tabs" role="tablist" aria-label="记账类型" onKeyDown={(event) => {
        if (record || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'work' : event.key === 'End' ? 'expense' : draft.type === 'work' ? 'expense' : 'work';
        update('type', next);
        (next === 'work' ? workRef : expenseRef).current?.focus();
      }}>
        <button ref={workRef} id="work-tab" role="tab" aria-selected={draft.type === 'work'} aria-controls="entry-form" disabled={record?.type === 'expense'} tabIndex={draft.type === 'work' ? 0 : -1} onClick={() => update('type', 'work')}><BriefcaseBusiness size={19} />记工时</button>
        <button ref={expenseRef} id="expense-tab" role="tab" aria-selected={draft.type === 'expense'} aria-controls="entry-form" disabled={record?.type === 'work'} tabIndex={draft.type === 'expense' ? 0 : -1} onClick={() => update('type', 'expense')}><Wallet size={19} />记支出</button>
      </div>
      <div role="tabpanel" id="entry-form" aria-labelledby={`${draft.type}-tab`} className="entry-preview" tabIndex={0}>
        {hasExamples ? <div className="inline-notice"><Info size={17} /><span>保存后将移除示例账单，只保留你的真实记录；兼职单位仍可继续使用。</span></div> : null}
        <form noValidate onSubmit={async (event) => { event.preventDefault(); const result = await saveRecord(draft, record?.id); if (result.ok) navigate(`/ledger?date=${draft.date}`, { state: { notice: savedNotice } }); else setError(result.message); }}>
          <div className="form-fields">
            {draft.type === 'work' ? <label>兼职单位<select value={draft.workplaceId} onChange={(event) => { const unit = workplaces.find((item) => item.id === event.target.value); setDraft((previous) => ({ ...previous, workplaceId: event.target.value, hourlyRate: ((unit?.hourlyRateCents ?? settings.hourlyRateCents) / 100).toFixed(2) })); }}><option value="" disabled>选择兼职单位</option>{workplaces.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label> : <label>支出金额（元）<input inputMode="decimal" value={draft.amount} onChange={(event) => update('amount', event.target.value)} placeholder="例如 18.50" autoComplete="off" /></label>}
            {draft.type === 'work' && workplaces.length === 0 ? <p className="form-hint">还没有单位。<Link className="text-link" to="/workplaces">先添加一个兼职单位</Link>，也可以切换到记支出。</p> : null}
            <label>{draft.type === 'work' ? '工作日期' : '消费日期'}<input type="date" min="2000-01-01" max="2100-12-31" value={draft.date} onChange={(event) => update('date', event.target.value)} /></label>
            {draft.type === 'work' ? <>
              <div className="field-pair"><label>开始时间<input type="time" value={draft.startTime} onChange={(event) => setDraft((previous) => ({ ...previous, startTime: event.target.value, duration: '' }))} /></label><label>结束时间<input type="time" value={draft.endTime} onChange={(event) => setDraft((previous) => ({ ...previous, endTime: event.target.value, duration: '' }))} /></label></div>
              <label className="checkbox-label"><input type="checkbox" checked={draft.nextDay} onChange={(event) => setDraft((previous) => ({ ...previous, nextDay: event.target.checked, duration: '' }))} />结束时间在次日（跨午夜）</label>
              <label>每小时时薪（元）<input inputMode="decimal" value={draft.hourlyRate} onChange={(event) => update('hourlyRate', event.target.value)} /></label>
              <details className="duration-options"><summary>调整计薪时长（例如扣除休息）</summary><label>计薪时长（分钟）<input type="number" min="1" max="1440" step="1" value={draft.duration} onChange={(event) => update('duration', event.target.value)} placeholder="留空时按起止时间计算" /></label></details>
            </> : <label>支出分类<select value={draft.category} onChange={(event) => update('category', event.target.value as RecordDraft['category'])}>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></label>}
            <label>备注（选填）<input maxLength={100} value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder={draft.type === 'work' ? '默认使用单位名称' : '例如 食堂午饭'} /></label>
          </div>
          {preview ? <div className="calculation-preview" aria-live="polite">{preview.type === 'work' ? `${(preview.durationMinutes / 60).toFixed(1)} 小时，预计收入` : '这笔支出'}<strong>¥ {money(preview.amountCents)}</strong></div> : null}
          {error ? <p className="form-error" role="alert" data-testid="entry-error">{error}</p> : null}
          <button className="button primary full-width" disabled={saving || blocked || (draft.type === 'work' && workplaces.length === 0)}>{record ? '保存修改' : '保存记录'}</button>
        </form>
      </div>
    </section><aside className="entry-aside"><BriefcaseBusiness size={28} strokeWidth={1.3} /><h2>尽量简单，<br />才能一直记下去。</h2><p>工时只需要告诉顺手：在哪、几点到几点、多少钱一小时。</p><div className="aside-divider" /><h3>记完以后</h3><ul><li>收入和支出自动汇总</li><li>点账单上的编辑可随时修改</li><li>刷新页面后记录仍然保留</li></ul><span className="subtle-tag">{cloudMode ? '保存后同步到云端账号' : '本机保存，不会上传到云端'}</span></aside></div>
  </>;
}
