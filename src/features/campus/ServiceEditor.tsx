import { useState } from 'react';
import { serviceSchema, type ServiceEntry } from '../../domain/planner';

export function ServiceEditor({ entry, busy, cancel, save }: { entry?: ServiceEntry; busy: boolean; cancel: () => void; save: (entry: ServiceEntry, expected: ServiceEntry | null) => Promise<{ ok: true } | { ok: false; message: string }> }) {
  const [draft, setDraft] = useState<ServiceEntry>(() => entry ?? { id: crypto.randomUUID(), title: '', category: '', entryType: 'web', entry: '', materials: '', hours: '', steps: '', sourceUrl: '', sourceUpdated: null, verifiedAt: null, miniProgramQr: '' });
  const [original] = useState(entry ?? null);
  const [error, setError] = useState('');
  const set = (key: keyof ServiceEntry, value: string | null) => setDraft((old) => ({ ...old, [key]: value }));
  return <form className="panel planner-panel planner-form planner-spaced" aria-label="事项编辑" onSubmit={async (event) => {
    event.preventDefault();
    const parsed = serviceSchema.safeParse(draft);
    if (!parsed.success) { setError('请检查必填内容、日期和网址；链接仅支持不含账号密码的 http(s) 地址。'); return; }
    const result = await save(parsed.data, original);
    if (!result.ok) setError(result.message);
  }}>
    <h2>{entry ? '编辑事项' : '新增事项'}</h2>
    <div className="form-grid"><label>事项名称<input required maxLength={100} value={draft.title} onChange={(e) => set('title', e.target.value)} /></label><label>事项分类<input required maxLength={40} value={draft.category} onChange={(e) => set('category', e.target.value)} /></label>
    <label>入口形式<select value={draft.entryType} onChange={(e) => set('entryType', e.target.value)}><option value="web">网页</option><option value="wechat">微信名称</option><option value="offline">线下地点或电话</option></select></label><label>入口地址或名称<input required maxLength={2048} value={draft.entry} onChange={(e) => set('entry', e.target.value)} /></label></div>
    <label>所需材料<textarea maxLength={10000} value={draft.materials} onChange={(e) => set('materials', e.target.value)} placeholder="留空表示未确认" /></label>
    <label>办理时间<textarea maxLength={10000} value={draft.hours} onChange={(e) => set('hours', e.target.value)} placeholder="只填有出处的接待时间" /></label>
    <label>办理步骤<textarea maxLength={10000} value={draft.steps} onChange={(e) => set('steps', e.target.value)} /></label>
    <label>来源网址<input type="url" maxLength={2048} value={draft.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} /></label>
    <div className="form-grid"><label>来源更新日期<input type="date" value={draft.sourceUpdated ?? ''} onChange={(e) => set('sourceUpdated', e.target.value || null)} /></label><label>核实日期<input type="date" value={draft.verifiedAt ?? ''} onChange={(e) => set('verifiedAt', e.target.value || null)} /></label></div>
    <p className="form-hint">日期代表你核对原始资料的时间，不代表学校保证今日可办。未知内容请留空。</p>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    <div className="planner-actions"><button className="button primary" disabled={busy}>保存事项</button><button type="button" className="button secondary" onClick={cancel}>取消</button></div>
  </form>;
}
