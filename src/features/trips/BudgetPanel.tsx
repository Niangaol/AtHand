import { useState } from 'react';
import type { Trip } from '../../domain/planner';
import { money } from '../../domain/summary';
import { tripBudgetCents } from '../../domain/tripPlan';

export function parseMoney(value: string): number {
  const normalized = value.trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(normalized)) throw new Error('金额请填 0 至 99999999.99 元，最多两位小数。');
  const [yuan, decimal = ''] = normalized.split('.');
  return Number(yuan) * 100 + Number(decimal.padEnd(2, '0'));
}

const yuan = (cents: number) => (cents / 100).toFixed(2);

type Item = Trip['budget']['items'][number];

function ItemForm({ value, busy, error, onSubmit, cancel, submitLabel }: {
  value?: Item; busy: boolean; error: string;
  onSubmit: (item: Item, amount: string) => void; cancel?: () => void; submitLabel: string;
}) {
  const [label, setLabel] = useState(value?.label ?? '');
  const [amount, setAmount] = useState(value ? yuan(value.amountCents) : '');
  const [note, setNote] = useState(value?.note ?? '');
  return <form className="trip-add trip-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ id: value?.id ?? crypto.randomUUID(), label: label.trim(), amountCents: 0, note: note.trim() }, amount); }}>
    <label>预算项<input required maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="车票、住宿、门票…" /></label>
    <label>金额（元）<input type="text" inputMode="decimal" required placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
    <label>备注<input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <div className="planner-actions"><button className="button secondary" disabled={busy || !label.trim() || amount.trim() === ''}>{submitLabel}</button>{cancel ? <button type="button" className="button secondary" onClick={cancel}>取消</button> : null}</div>
  </form>;
}

export function BudgetPanel({ trip, busy, save, remove }: {
  trip: Trip; busy: boolean; save: (value: Trip) => Promise<boolean>;
  remove: (value: Trip, description: string) => void;
}) {
  const [planned, setPlanned] = useState(trip.budget.totalCents ? yuan(trip.budget.totalCents) : '');
  const [editing, setEditing] = useState<Item | null>(null);
  const [error, setError] = useState('');
  const itemized = tripBudgetCents(trip);
  const remaining = trip.budget.totalCents - itemized;
  async function submit(raw: Item, amount: string) {
    try {
      const amountCents = parseMoney(amount);
      if (await save({ ...trip, budget: { ...trip.budget, items: trip.budget.items.some((item) => item.id === raw.id) ? trip.budget.items.map((item) => item.id === raw.id ? { ...raw, amountCents } : item) : [...trip.budget.items, { ...raw, amountCents }] } })) { setEditing(null); setError(''); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '金额格式不正确。'); }
  }
  return <section className="trip-plan-block" aria-label="预算">
    <h3>花多少钱，心里有数</h3>
    <p className="trip-plan-summary">已列 {trip.budget.items.length} 项，计划合计 <strong>¥ {money(itemized)}</strong>{trip.budget.totalCents ? ` · 总预算 ¥ ${money(trip.budget.totalCents)} · ${remaining >= 0 ? `余量 ¥ ${money(remaining)}` : `计划超出 ¥ ${money(-remaining)}`}` : ' · 还没设总预算'}</p>
    <p className="form-hint">这里记录的是计划金额，不是实际花费。</p>
    {trip.budget.items.map((item) => editing?.id === item.id
      ? <ItemForm key={item.id} value={editing} busy={busy} error={error} onSubmit={(value, amount) => void submit(value, amount)} cancel={() => { setEditing(null); setError(''); }} submitLabel="保存预算项" />
      : <div className="trip-item" key={item.id}>
        <div><strong>{item.label}</strong><p>¥ {money(item.amountCents)}{item.note ? ` · ${item.note}` : ''}</p></div>
        <div className="planner-actions"><button className="button secondary compact" aria-label={`编辑预算项 ${item.label}`} disabled={busy} onClick={() => { setEditing({ ...item }); setError(''); }}>编辑</button><button className="button secondary compact" aria-label={`删除预算项 ${item.label}`} disabled={busy} onClick={() => remove({ ...trip, budget: { ...trip.budget, items: trip.budget.items.filter((value) => value.id !== item.id) } }, '删除这条预算，只影响本次旅行的估算。')}>删除</button></div>
      </div>)}
    {!editing ? <ItemForm busy={busy} error={error} onSubmit={(value, amount) => void submit(value, amount)} submitLabel="添加预算项" /> : null}
    {!editing ? <form className="trip-add trip-form" onSubmit={async (event) => {
      event.preventDefault();
      try {
        const totalCents = planned.trim() === '' ? 0 : parseMoney(planned);
        if (await save({ ...trip, budget: { ...trip.budget, totalCents } })) setError('');
      } catch (reason) { setError(reason instanceof Error ? reason.message : '金额格式不正确。'); }
    }}>
      <label>整趟预算（元，可留空）<input type="text" inputMode="decimal" placeholder="例如 800" value={planned} onChange={(e) => setPlanned(e.target.value)} /></label>
      <button className="button secondary" disabled={busy}>保存总预算</button>
    </form> : null}
    {error && !editing ? <p role="alert" className="form-error">{error}</p> : null}
  </section>;
}
