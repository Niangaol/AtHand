import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlanner } from '../../data/PlannerProvider';
import { useLocalToday } from '../../data/useLocalToday';
import { findServices, serviceEvidence } from '../../domain/serviceDirectory';
import { PlannerStatus } from '../../components/PlannerStatus';
import { publicServices } from './publicServices';
import { ServiceEditor } from './ServiceEditor';

export function ServiceDirectory() {
  const { state, dispatch, busy, blocked } = usePlanner();
  const today = useLocalToday();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [adding, setAdding] = useState(false);
  const catalog = [...state.serviceEntries, ...publicServices.filter((v) => !state.serviceEntries.some((saved) => saved.id === v.id))];
  const entries = findServices(catalog, query, category);
  return <section className="planner-spaced" aria-label="办事目录"><PlannerStatus />
    <div className="planner-section-title"><div><h2>先找入口，再办事情</h2><p>材料、路径和出处放在一起；未知信息不猜。</p></div><button className="button primary" disabled={blocked} onClick={() => setAdding(true)}>新增事项</button></div>
    {adding ? <ServiceEditor busy={busy} cancel={() => setAdding(false)} save={async (value, expected) => { const result = await dispatch({ kind: 'put', collection: 'serviceEntries', value }, expected); if (result.ok) setAdding(false); return result; }} /> : null}
    <div className="planner-toolbar"><label>搜索事项<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名称、入口或办理步骤" /></label><label>筛选分类<select value={category} onChange={(e) => setCategory(e.target.value)}><option>全部</option>{[...new Set(catalog.map((e) => e.category))].sort().map((v) => <option key={v}>{v}</option>)}</select></label></div>
    <div className="service-grid">{entries.map((entry) => { const evidence = serviceEvidence(entry, today); return <article className={`panel planner-panel${evidence.stale ? ' service-stale' : ''}`} key={entry.id}><span className="subtle-tag">{entry.category}</span><h3><Link to={`/campus/services/${encodeURIComponent(entry.id)}`}>{entry.title}</Link></h3><p>{entry.entry}</p><p className="form-hint">{!evidence.sourced ? '缺少公开出处' : evidence.stale ? '超过30天未核实' : entry.verifiedAt ? `核实于 ${entry.verifiedAt}` : '尚未核实'}</p></article>; })}</div>
    {!entries.length ? <p className="planner-empty">{state.serviceEntries.length ? '没有匹配事项，换个关键词或新增一条。' : '还没有保存事项，可以先记录自己常用的入口。'}</p> : null}
  </section>;
}
