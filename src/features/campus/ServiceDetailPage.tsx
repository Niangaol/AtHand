import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePlanner } from '../../data/PlannerProvider';
import { useLocalToday } from '../../data/useLocalToday';
import { serviceEvidence } from '../../domain/serviceDirectory';
import { PageHeading } from '../../components/PageHeading';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PlannerStatus } from '../../components/PlannerStatus';
import { publicServices } from './publicServices';
import { ServiceEditor } from './ServiceEditor';

export function ServiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, dispatch, busy, blocked } = usePlanner();
  const today = useLocalToday();
  const [editing, setEditing] = useState<{ value: import('../../domain/planner').ServiceEntry; expected: import('../../domain/planner').ServiceEntry | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const saved = state.serviceEntries.find((v) => v.id === id);
  const entry = saved ?? publicServices.find((v) => v.id === id);
  if (!entry) return <section className="panel planner-panel"><h1>事项不存在或已删除</h1><Link to="/campus">返回办事总台</Link></section>;
  const evidence = serviceEvidence(entry, today);
  return <><Link className="text-link" to="/campus">返回办事总台</Link><PageHeading title={entry.title} description={entry.category} /><PlannerStatus />
    {notice ? <p role="status">{notice}</p> : null}
    {editing ? <ServiceEditor entry={editing.value} busy={busy} cancel={() => setEditing(null)} save={async (value) => { const result = await dispatch({ kind: 'put', collection: 'serviceEntries', value }, editing.expected); if (result.ok) setEditing(null); return result; }} /> : <>
      <section className="panel planner-panel planner-spaced"><h2>结论</h2><p>{evidence.availability}</p><p>{evidence.sourced ? '以下为公开资料整理的办理路径，请以原办理单位最新说明为准。' : '缺少公开出处，请先核实再办理。'}</p>{evidence.stale ? <p className="form-hint">超过30天未核实，办理前请重新查看出处。</p> : null}<h3>所需材料</h3><p className="service-text">{entry.materials || '所需材料未确认'}</p></section>
      <section className="panel planner-panel planner-spaced"><h2>路径</h2><p className="service-text">{entry.steps || '详细步骤未确认'}</p>{entry.entryType === 'web' ? <a className="button primary" href={entry.entry} target="_blank" rel="noreferrer">打开办理入口</a> : <><p>{entry.entryType === 'wechat' ? '微信内搜索' : '地点或电话'}：{entry.entry}</p><button className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(entry.entry); setNotice('入口已复制，请自行打开或联系。'); } catch { setNotice('复制不可用，请手动选择上方入口文字。'); } }}>复制入口名称</button></>}</section>
      <section className="panel planner-panel planner-spaced"><h2>出处</h2>{entry.sourceUrl ? <a href={entry.sourceUrl} target="_blank" rel="noreferrer">查看原始出处</a> : <p>未提供公开来源</p>}<p>来源更新：{entry.sourceUpdated ?? '未标注'} · 最近核实：{entry.verifiedAt ?? '尚未核实'}</p><p className="form-hint">顺手不代提交、签字或付款，也不代表学校受理。</p></section>
      <div className="planner-actions planner-spaced"><button className="button secondary" disabled={busy || blocked} onClick={() => setEditing({ value: entry, expected: saved ?? null })}>{saved ? '编辑事项' : '保存到我的目录并编辑'}</button>{saved ? <button className="button secondary" disabled={busy || blocked} onClick={() => setDeleting(true)}>删除事项</button> : null}</div>
    </>}
    {deleting ? <ConfirmDialog title="删除这条事项？" description="仅移除你保存的入口，不会影响学校的任何业务。" confirmLabel="确认删除" onCancel={() => setDeleting(false)} onConfirm={async () => { const result = await dispatch({ kind: 'delete', collection: 'serviceEntries', id: entry.id }); if (result.ok) navigate('/campus'); else { setNotice(result.message); setDeleting(false); } }} /> : null}
  </>;
}
