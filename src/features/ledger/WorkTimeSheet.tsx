import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, Clock, Coffee, Coins, Image as ImageIcon, Pencil, SlidersHorizontal, X } from 'lucide-react';
import { useRecords } from '../../data/RecordsProvider';
import type { RecordDraft } from '../../domain/ledger';
import { filesToPhotos } from './photo';
import { ensureWorkplace } from './workplace';

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return <button type="button" className={`wb-switch${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={onClick}><i /></button>;
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** 图 2「记工时」：设置时薪、可自定义的休息与可编辑数字、照片。 */
export function WorkTimeSheet({ date, open, onClose, onSaved }: {
  date: string; open: boolean; onClose: () => void; onSaved: (message: string) => void;
}) {
  const { workplaces, settings, saveWorkplace, saveRecord, saving, blocked, updateRate } = useRecords();
  const [mode, setMode] = useState<'range' | 'direct'>('range');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [hoursDirect, setHoursDirect] = useState('9');
  const [rest, setRest] = useState(false);
  const [restMinutes, setRestMinutes] = useState('60');
  const [rate, setRate] = useState((settings.hourlyRateCents / 100).toFixed(2));
  const [rateInput, setRateInput] = useState((settings.hourlyRateCents / 100).toFixed(2));
  const [rateMsg, setRateMsg] = useState('');
  const [durationOverride, setDurationOverride] = useState('');
  const [editing, setEditing] = useState<'' | 'rate' | 'duration'>('');
  const [editValue, setEditValue] = useState('');
  const [bonus, setBonus] = useState('');
  const [remark, setRemark] = useState('');
  const [settled, setSettled] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const value = (settings.hourlyRateCents / 100).toFixed(2);
    setRate(value);
    setRateInput(value);
  }, [settings.hourlyRateCents]);

  const elapsed = useMemo(() => {
    if (mode === 'direct') return Math.max(0, Math.round((parseFloat(hoursDirect) || 0) * 60));
    let value = minutesOf(endTime) - minutesOf(startTime);
    if (value < 0) value += 1440;
    return value;
  }, [mode, hoursDirect, startTime, endTime]);
  const restValue = Math.min(1440, Math.max(0, Math.round(parseFloat(restMinutes) || 0)));
  const charged = durationOverride ? Math.max(1, Number(durationOverride)) : Math.max(1, elapsed - (rest ? restValue : 0));
  const effectiveRateCents = Math.round((parseFloat(rate) || 0) * 100);
  const incomeYuan = (Math.round(charged * effectiveRateCents / 60) / 100).toFixed(2);

  async function confirmRate() {
    const value = Number.parseFloat(rateInput);
    if (!Number.isFinite(value) || value <= 0) { setRateMsg('请输入大于 0 的时薪数字。'); return; }
    const text = value.toFixed(2);
    const result = await updateRate(text);
    if (!result.ok) { setRateMsg(result.message); return; }
    setRate(text);
    setRateInput(text);
    setRateMsg(`已保存：¥${text} / 小时`);
  }

  function openEdit(kind: 'rate' | 'duration') {
    setEditing(kind);
    setEditValue(kind === 'rate' ? rate : String(charged));
    setError('');
  }
  function applyEdit() {
    const value = Number.parseFloat(editValue);
    if (!Number.isFinite(value) || value <= 0) { setError('请输入大于 0 的数字。'); return; }
    if (editing === 'rate') { setRate(value.toFixed(2)); setRateInput(value.toFixed(2)); }
    else setDurationOverride(String(Math.round(value)));
    setEditing('');
  }

  async function submit() {
    setError('');
    if (charged < 1) { setError('请填写有效的时长。'); return; }
    if (effectiveRateCents <= 0) { setError('请先在上方确认工作时薪。'); return; }
    setBusy(true);
    try {
      // 「生活收入」是收入记录的载体，不能拿来记工时，否则会被工时统计排除。
      const unitId = workplaces.find((unit) => unit.name !== '生活收入')?.id
        ?? await ensureWorkplace('顺手工时', (effectiveRateCents / 100).toFixed(2), workplaces, saveWorkplace);
      const title = [remark.trim() || '工时记录', bonus.trim() ? `奖励 ${bonus.trim()}` : ''].filter(Boolean).join(' · ');
      const draft: RecordDraft = {
        type: 'work', date, title, workplaceId: unitId,
        startTime, endTime, nextDay: endTime <= startTime,
        duration: String(charged), hourlyRate: (effectiveRateCents / 100).toFixed(2),
        amount: '', category: '其他', photos: photos.length ? photos : undefined,
      };
      const result = await saveRecord(draft);
      if (!result.ok) throw new Error(result.message);
      onSaved(`已添加工时记录${photos.length ? `（含 ${photos.length} 张照片）` : ''}`);
      setRemark(''); setBonus(''); setPhotos([]); setDurationOverride(''); setSettled(false);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className={`wb-mask${open ? ' show' : ''}`} onClick={onClose} />
    <div className={`wb-sheet wb-work-sheet${open ? ' open' : ''}`} role="dialog" aria-label="记工时" aria-hidden={!open}>
      <div className="wb-handle" onClick={onClose} />
      <div className="wb-ws-head">
        <div className="wb-ws-title">记工时 <SlidersHorizontal size={17} /></div>
        <div className="wb-ws-date">{date.replace(/-/g, ' / ')}</div>
      </div>

      {/* 设置工作时薪：数字输入 + 确认，写入软件设置 */}
      <div className="wb-rate-box">
        <div className="wb-rate-head"><Coins size={16} /><b>设置工作时薪</b><span>用于自动计算预计收入</span></div>
        <div className="wb-rate-row">
          <span className="wb-rate-unit">¥</span>
          <input type="number" min="0.01" step="0.01" inputMode="decimal" aria-label="工作时薪（元每小时）" value={rateInput} onChange={(event) => { setRateInput(event.target.value); setRateMsg(''); }} onKeyDown={(event) => { if (event.key === 'Enter') void confirmRate(); }} />
          <span className="wb-rate-unit tail">元 / 小时</span>
          <button type="button" onClick={() => void confirmRate()}><Check size={14} />确认</button>
        </div>
        {rateMsg ? <p className={rateMsg.startsWith('已保存') ? 'wb-rate-msg ok' : 'wb-rate-msg'}>{rateMsg}</p> : null}
      </div>

      <div className="wb-seg">
        <button className={mode === 'range' ? 'on' : ''} onClick={() => { setMode('range'); setDurationOverride(''); }}>按时间段</button>
        <button className={mode === 'direct' ? 'on' : ''} onClick={() => { setMode('direct'); setDurationOverride(''); }}>直接选时长</button>
      </div>

      {mode === 'range' ? <div className="wb-time-row" style={{ marginTop: 8 }}>
        <div className="wb-time-box"><label>开始时间</label><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div>
        <ArrowRight className="wb-time-arrow" size={19} />
        <div className="wb-time-box"><label>结束时间 <span className="wb-time-tag">次日</span></label><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div>
      </div> : <div className="wb-duration show" style={{ marginTop: 8 }}>
        <span style={{ fontSize: 12.5 }}>时长</span>
        <input type="number" min="0" step="0.5" value={hoursDirect} onChange={(event) => setHoursDirect(event.target.value)} />
        <span style={{ fontSize: 12.5, color: '#9aa3af' }}>小时</span>
      </div>}

      {/* 中途休息：打开后展开可自定义的休息时长 */}
      <div className="wb-ws-row" style={{ padding: '12px 0 4px' }}>
        <div className="wb-ws-left"><Coffee size={17} /><span>中途休息</span></div>
        <Switch on={rest} onClick={() => { setRest(!rest); setDurationOverride(''); }} label="中途休息" />
      </div>
      {rest ? <div className="wb-rest-row">
        <span>休息时长</span>
        <input type="number" min="0" max="1440" step="5" inputMode="numeric" aria-label="休息时长（分钟）" value={restMinutes} onChange={(event) => { setRestMinutes(event.target.value); setDurationOverride(''); }} />
        <span>分钟</span>
        <small>已从计薪时长中扣除</small>
      </div> : null}

      <div className="wb-calc">
        <div className="wb-calc-main">
          <Clock size={15} className="blue" />
          <button type="button" className="blue wb-calc-num" onClick={() => openEdit('duration')} aria-label="点击修改计薪时长">{(charged / 60).toFixed(1)}h</button><span>×</span>
          <button type="button" className="blue wb-calc-num" onClick={() => openEdit('rate')} aria-label="点击修改时薪">¥{(effectiveRateCents / 100).toFixed(2)}/时</button>
          <button type="button" className="wb-edit-btn" onClick={() => openEdit('rate')} aria-label="修改时薪"><Pencil size={13} /></button>
          <span>= 预计收入</span><span className="green">¥{incomeYuan}</span>
          <button type="button" className="wb-edit-btn" onClick={() => openEdit('duration')} aria-label="修改计薪时长"><Pencil size={13} /></button>
        </div>
        {editing ? <div className="wb-edit-row">
          <b>{editing === 'rate' ? '修改时薪（元 / 小时）' : '修改计薪时长（分钟）'}</b>
          <input type="number" min="0.01" step={editing === 'rate' ? '0.01' : '1'} autoFocus aria-label={editing === 'rate' ? '输入时薪' : '输入计薪时长'} value={editValue} onChange={(event) => setEditValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyEdit(); }} />
          <button type="button" onClick={applyEdit}>确定</button>
          <button type="button" onClick={() => setEditing('')} aria-label="取消编辑"><X size={14} /></button>
        </div> : null}
        <div className="wb-calc-sub"><span style={{ whiteSpace: 'nowrap' }}>额外奖励/提成</span><input value={bonus} onChange={(event) => setBonus(event.target.value)} placeholder="可选填写奖..." /></div>
      </div>

      <div className="wb-remark-row">
        <div className="wb-remark"><input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="备注（可选）" maxLength={90} /><ArrowRight size={15} style={{ transform: 'rotate(-45deg)' }} /></div>
        <button type="button" className={`wb-settle${settled ? ' on' : ''}`} onClick={() => setSettled(!settled)}><span className="circle" />已结算</button>
      </div>

      <div className="wb-photos">
        <div className="wb-photos-title"><ImageIcon size={15} />添加照片<em>（可选 · 支持拍照或相册）</em></div>
        <div className="wb-photo-list">
          {photos.map((src, index) => <div className="wb-photo-thumb" key={index}><img src={src} alt={`照片 ${index + 1}`} /><button type="button" onClick={() => setPhotos((list) => list.filter((_, i) => i !== index))} aria-label="删除照片"><X size={12} /></button></div>)}
          <button type="button" className="wb-photo-add" onClick={() => fileRef.current?.click()}><Camera size={19} />拍照/选图</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={async (event) => {
          const picked = Array.from(event.target.files ?? []);
          const converted = await filesToPhotos(picked);
          if (converted.length) setPhotos((list) => [...list, ...converted]);
          event.target.value = '';
        }} />
      </div>

      {error ? <p role="alert" style={{ color: '#c34a3c', fontSize: 12, margin: '0 0 8px' }}>{error}</p> : null}
      <button type="button" className="wb-btn-primary" disabled={busy || saving || blocked} onClick={submit}>添加</button>
    </div>
  </>;
}
