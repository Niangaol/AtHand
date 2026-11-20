import { useState } from 'react';
import { GraduationCap, Plus, Store } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useRecords } from '../../data/RecordsProvider';
import { money } from '../../domain/summary';
import type { Workplace } from '../../domain/records';

export function WorkplacesPage() {
  const { workplaces, records, saveWorkplace, deleteWorkplace, blocked } = useRecords();
  const [editing, setEditing] = useState<Workplace | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Workplace | null>(null);
  const [notice, setNotice] = useState('');
  return <>
    <PageHeading title="每一份努力，都有个去处。" description="保存常做的兼职和时薪，记工时的时候就不必反复填写。" action={<button className="button primary" disabled={blocked} onClick={() => setEditing('new')}><Plus size={18} />新增单位</button>} />
    {notice ? <p role="status" className="inline-notice page-notice">{notice}</p> : null}
    {editing ? <WorkplaceForm key={editing === 'new' ? 'new' : editing.id} workplace={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSave={async (name, rate) => { const result = await saveWorkplace(name, rate, editing === 'new' ? undefined : editing.id); if (result.ok) { setEditing(null); setNotice('单位已保存，历史工时保持原单价。'); return ''; } return result.message; }} /> : null}
    {workplaces.length === 0 ? <section className="panel empty-state"><Store size={32} /><h2>还没有兼职单位</h2><p>点击“新增单位”，填上名称和时薪，就能开始记工时。</p></section> : <div className="workplace-grid">{workplaces.map((workplace, index) => {
      const count = records.filter((record) => record.type === 'work' && record.workplaceId === workplace.id).length;
      return <article className="panel workplace-card" key={workplace.id}><div className="section-heading"><span className="workplace-icon">{index % 2 === 0 ? <Store size={25} /> : <GraduationCap size={25} />}</span><span className="subtle-tag">{workplace.source === 'demo' ? '示例单位' : `${count} 笔工时`}</span></div><h2>{workplace.name}</h2>{workplace.description ? <p>{workplace.description}</p> : null}<div className="workplace-rate"><strong>¥ {money(workplace.hourlyRateCents)}</strong><span>/ 小时</span></div><div className="workplace-status workplace-actions"><button className="text-button" disabled={blocked} aria-label={`编辑单位 ${workplace.name}`} onClick={() => setEditing(workplace)}>编辑单位</button><button className="text-button danger-text" disabled={blocked || count > 0} title={count > 0 ? '单位仍有关联工时，暂不能删除' : undefined} aria-label={`删除单位 ${workplace.name}`} onClick={() => setDeleting(workplace)}>删除</button></div>{count > 0 ? <p className="form-hint">有关联工时，不能直接删除单位。</p> : null}</article>;
    })}</div>}
    <p className="page-caption">修改时薪仅影响新记录。历史记录会保留当时的单价；有关联工时的单位不能直接删除。</p>
    {deleting ? <ConfirmDialog title="删除这个兼职单位？" description={`“${deleting.name}”将从单位列表移除。`} onCancel={() => setDeleting(null)} onConfirm={async () => { const result = await deleteWorkplace(deleting.id); setNotice(result.ok ? '单位已删除。' : result.message); setDeleting(null); }} /> : null}
  </>;
}

function WorkplaceForm({ workplace, onSave, onCancel }: { workplace?: Workplace; onSave: (name: string, rate: string) => Promise<string>; onCancel: () => void }) {
  const [name, setName] = useState(workplace?.name ?? '');
  const [rate, setRate] = useState(workplace ? (workplace.hourlyRateCents / 100).toFixed(2) : '');
  const [error, setError] = useState('');
  return <form className="panel unit-form" noValidate onSubmit={async (event) => { event.preventDefault(); setError(await onSave(name, rate)); }}><h2>{workplace ? '编辑单位' : '添加一份兼职'}</h2><div className="form-fields field-pair"><label>单位名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="例如 校园奶茶店" /></label><label>单位时薪（元）<input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="例如 20" /></label></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="dialog-actions"><button type="button" className="button secondary" onClick={onCancel}>取消</button><button className="button primary">保存单位</button></div></form>;
}
