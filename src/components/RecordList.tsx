import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, BriefcaseBusiness, Coffee, NotebookPen, Pencil, ShoppingBag, TrainFront, Trash2, Utensils, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RecordEntry } from '../domain/records';
import { shortDate } from '../domain/dates';
import { money } from '../domain/summary';
import { canShowTimeCost } from '../domain/ledger';
import { useRecords } from '../data/RecordsProvider';
import { ConfirmDialog } from './ConfirmDialog';

const expenseIcons: Record<string, LucideIcon> = { 吃饭: Utensils, 交通: TrainFront, 日用: ShoppingBag, 娱乐: Coffee, 学习: BookOpen, 其他: Wallet, 日用品: ShoppingBag, 餐饮: Utensils, 零食: Coffee, 水果: Utensils, 医疗: Wallet, 配饰: ShoppingBag, 旅行: TrainFront, 衣服: ShoppingBag, 饮料: Coffee };

export function RecordList({ records, editable = false }: { records: readonly RecordEntry[]; editable?: boolean }) {
  const { records: allRecords, settings, today, deleteRecord, blocked } = useRecords();
  const [deleting, setDeleting] = useState<RecordEntry | null>(null);
  const [notice, setNotice] = useState('');
  const showTimeCost = canShowTimeCost(allRecords, today);
  if (records.length === 0) return <div className="empty-state"><NotebookPen size={32} strokeWidth={1.4} /><h3>这一页，还是空白的</h3><p>当前范围内没有记录，可以换个周次或筛选条件。</p><Link className="text-link" to="/entry">去记一笔</Link></div>;
  const grouped = new Map<string, RecordEntry[]>();
  for (const record of [...records].sort((a, b) => b.date.localeCompare(a.date))) {
    const group = grouped.get(record.date) ?? [];
    group.push(record);
    grouped.set(record.date, group);
  }
  return <div className="record-list">
    {notice ? <p role="status" className="form-hint">{notice}</p> : null}
    {[...grouped].map(([date, entries]) => <section className="record-day" key={date}><h3>{shortDate(date)}<span>{entries.length} 笔</span></h3>{entries.map((record) => {
      const Icon = record.type === 'work' ? BriefcaseBusiness : (expenseIcons[record.category] ?? Wallet);
      return <div className="record-row" key={record.id}>
        <span className={`record-icon ${record.type}`}><Icon size={19} strokeWidth={1.65} /></span>
        <div className="record-description"><strong>{record.title}</strong><span>{record.type === 'work' ? `${record.startTime}–${record.endTime <= record.startTime ? '次日 ' : ''}${record.endTime} · ${(record.durationMinutes / 60).toFixed(1)} 小时` : record.category}</span>{record.type === 'expense' && showTimeCost ? <span>约 {(record.amountCents / settings.hourlyRateCents).toFixed(1)} 小时 · 基准时薪估算</span> : null}{record.photos?.length ? <span>含 {record.photos.length} 张照片</span> : null}</div>
        <strong className={`record-amount ${record.type === 'work' ? 'income' : ''}`}>{record.type === 'work' ? '+' : '−'} {money(record.amountCents)}<small>元</small></strong>
        {editable ? <div className="record-actions"><Link className="icon-button" to={`/entry/${encodeURIComponent(record.id)}`} aria-label={`编辑 ${record.title}`}><Pencil size={15} /></Link><button className="icon-button danger-text" disabled={blocked} onClick={() => setDeleting(record)} aria-label={`删除 ${record.title}`}><Trash2 size={15} /></button></div> : null}
      </div>;
    })}</section>)}
    {deleting ? <ConfirmDialog title="删除这笔记录？" description={`“${deleting.title}”共 ${money(deleting.amountCents)} 元，删除后会重新计算收支，无法撤销。`} onCancel={() => setDeleting(null)} onConfirm={async () => { const result = await deleteRecord(deleting.id); if (result.ok) { setDeleting(null); setNotice('记录已删除。'); } else { setDeleting(null); setNotice(result.message); } }} /> : null}
  </div>;
}
