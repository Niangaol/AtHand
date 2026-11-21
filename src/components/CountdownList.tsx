import { useState } from 'react';
import type { CountdownItem } from '../domain/countdowns';

export function CountdownList({ items, limit = 3, onEdit, onDelete }: { items: CountdownItem[]; limit?: number; onEdit?: (id: string) => void; onDelete?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const current = items.filter((item) => item.days >= 0);
  const past = items.filter((item) => item.days < 0);
  const shown = expanded ? items : current.slice(0, limit);
  return <>
    {shown.length ? <ul className="planner-list countdown-list">{shown.map((item) => <li key={item.id}>
      <div><strong>{item.title}</strong><p>{item.date}{item.note ? ` · ${item.note}` : ''}</p></div>
      <span className={`countdown-days${item.days < 0 ? ' is-past' : ''}`}>{item.days === 0 ? '今天' : item.days > 0 ? `还有${item.days}天` : `已过去${-item.days}天`}</span>
      {onEdit && onDelete && !item.id.startsWith('event:') ? <div className="planner-actions"><button className="button secondary compact" aria-label={`修改 ${item.title}`} onClick={() => onEdit(item.id)}>修改</button><button className="button secondary compact" aria-label={`删除倒计时 ${item.title}`} onClick={() => onDelete(item.id)}>删除</button></div> : null}
    </li>)}</ul> : <p className="planner-empty">暂时没有临近的重要日子。</p>}
    {items.length > limit || past.length ? <button className="button secondary compact" onClick={() => setExpanded(!expanded)}>{expanded ? '收起倒计时' : `查看全部${items.length}条（含已过期${past.length}条）`}</button> : null}
  </>;
}
