import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle, Bell, BookOpen, ChevronRight, Cloud, Copy, ExternalLink, GraduationCap,
  KeyRound, Library, ListFilter, LogOut, MessageCircle, Play, RefreshCw, Search, ShieldCheck,
  Sparkles, UserRound, Wallet, X,
} from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { useCampus } from '../../data/CampusProvider';
import type { CampusCloudPending, CampusCloudStatus, CampusOperation, CampusResult } from '../../data/campusCloud';
import { money } from '../../domain/summary';
import { ServiceDirectory } from './ServiceDirectory';
import { courseWhen, examWhen, nextCourse, nextExam } from './campusSummary';
import { campusErrorHint } from './campusErrors';

const DOMAIN_ICON: Record<string, LucideIcon> = {
  academic: BookOpen,
  campuslife: Wallet,
  librarybooking: Library,
  emptyschedule: ListFilter,
  feed: Sparkles,
  groupchat: MessageCircle,
  identity: UserRound,
  reminder: Bell,
  knowledge: Search,
  messaging: MessageCircle,
  moments: Sparkles,
  upload: Cloud,
  graduate: GraduationCap,
  agentops: Sparkles,
};

const RISK_LABEL: Record<string, { label: string; tone: 'ok' | 'read' | 'write' | 'danger' }> = {
  read: { label: '只读', tone: 'read' },
  'sensitive-read': { label: '敏感只读', tone: 'ok' },
  write: { label: '写入', tone: 'write' },
  'high-risk-write': { label: '高风险写入', tone: 'danger' },
};

type RunnerDefaults = { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: Record<string, unknown> };
type QuickAction = {
  id: string;
  label: string;
  hint?: string;
  auto?: boolean;
  defaults?: (summary: ReturnType<typeof useCampus>['summary']) => RunnerDefaults;
};

const QUICK: Record<string, QuickAction[]> = {
  academic: [
    { id: 'AcademicService_ScheduleNow', label: '今明课程', auto: true },
    { id: 'AcademicService_SchoolTime', label: '当前教学周', auto: true },
    {
      id: 'AcademicService_StudentExam', label: '学期考试', auto: true,
      defaults: (summary) => summary.calendar?.schoolYear ? { query: { schoolYear: summary.calendar.schoolYear, semester: summary.calendar.semester ?? undefined } } : {},
    },
    {
      id: 'AcademicService_StudentGrade', label: '成绩与绩点', auto: true,
      defaults: (summary) => summary.calendar?.schoolYear ? { query: { schoolYear: summary.calendar.schoolYear, semester: summary.calendar.semester ?? undefined } } : {},
    },
    { id: 'AcademicService_ListChaoxingHomework', label: '学习通作业', auto: true, defaults: () => ({ query: { page: 1, limit: 20 } }) },
    { id: 'AcademicService_GetClassrooms', label: '教室列表' },
  ],
  campuslife: [
    { id: 'CampusLifeService_CardBalance', label: '校园卡余额', auto: true },
    { id: 'CampusLifeService_CardConsume', label: '消费流水', auto: true },
    { id: 'CampusLifeService_ElectricBalance', label: '宿舍电费', auto: true },
    { id: 'CampusLifeService_ElectricBinding', label: '电表绑定', auto: true },
    { id: 'CampusLifeService_ListMyActivities', label: '我的二课', auto: true },
    { id: 'CampusLifeService_ListPopularActivities', label: '热门二课', auto: true },
    { id: 'CampusLifeService_ListActivities', label: '活动列表' },
    { id: 'CampusLifeService_RealTime', label: '实时天气', auto: true },
  ],
  librarybooking: [
    { id: 'LibraryBookingService_ListSpaceCategories', label: '座位空间', auto: true },
    { id: 'LibraryBookingService_ListMyBookings', label: '我的预约', auto: true },
    { id: 'LibraryBookingService_GetBookingOptions', label: '可约日期' },
    { id: 'LibraryBookingService_SearchAvailableSeats', label: '实时空座', hint: '需要先选空间、日期和时间' },
  ],
  emptyschedule: [
    { id: 'EmptyScheduleService_MyRooms', label: '我的空课表房间', auto: true },
    { id: 'EmptyScheduleService_Favorites', label: '收藏的排班', auto: true },
    { id: 'EmptyScheduleService_Status', label: '空课表状态', auto: true },
  ],
  feed: [
    { id: 'FeedService_Feed', label: '首页信息流', auto: true },
    { id: 'FeedService_IcsLink', label: '课表 ICS 订阅' },
  ],
  groupchat: [
    { id: 'GroupChatService_CourseGroups', label: '我的课程群', auto: true },
    { id: 'GroupChatService_MyGroups', label: '我创建的群', auto: true },
  ],
  identity: [
    { id: 'IdentityService_Me', label: '我的身份', auto: true },
    { id: 'IdentityService_GetBindStatus', label: '绑定状态', auto: true },
    { id: 'IdentityService_GetMyCampus', label: '当前校区', auto: true },
  ],
  reminder: [
    { id: 'ReminderService_SunrunOverview', label: '阳光长跑概览', auto: true },
    { id: 'ReminderService_ListSubscriptions', label: '提醒订阅', auto: true },
    { id: 'ReminderService_SunrunDetail', label: '跑步记录', auto: true },
  ],
  knowledge: [
    { id: 'KnowledgeService_KnowledgeRetrieve', label: '知识检索', hint: '输入要查的问题' },
    { id: 'KnowledgeService_KnowledgeServiceChat', label: '快速问答', hint: '输入要问的问题' },
  ],
};

function hasRequiredDefaults(operation: CampusOperation, defaults?: RunnerDefaults): boolean {
  const path = defaults?.path ?? {};
  const query = defaults?.query ?? {};
  const body = defaults?.body ?? {};
  return operation.params.every((param) => {
    if (!param.required) return true;
    const value = param.in === 'path' ? path[param.name] : param.in === 'query' ? query[param.name] : undefined;
    return value !== undefined && value !== null && value !== '';
  }) && (operation.body?.fields ?? []).every((field) => field.required ? body[field.name] !== undefined : true);
}

function RiskBadge({ risk }: { risk: string }) {
  const value = RISK_LABEL[risk] ?? { label: risk, tone: 'read' as const };
  return <span className={`campus-risk campus-risk-${value.tone}`}>{value.label}</span>;
}

function ScopeSummary({ scopes }: { scopes: string[] }) {
  if (!scopes.length) return <span className="subtle-tag">公开接口</span>;
  return <span className="subtle-tag">{scopes.length} 项权限</span>;
}

function PendingAuthCard({ pending, busy, onPoll, onCancel }: {
  pending: CampusCloudPending; busy: boolean; onPoll: () => Promise<unknown>; onCancel: () => Promise<unknown>;
}) {
  const link = pending.verificationUriComplete || pending.verificationUri;
  useEffect(() => {
    const timer = window.setInterval(() => { void onPoll().catch(() => undefined); }, Math.max(5, pending.interval) * 1000);
    return () => window.clearInterval(timer);
  }, [pending.userCode, pending.interval, onPoll]);
  return <section className="panel campus-auth-pending" aria-label="等待校园授权">
    <div className="campus-auth-head"><KeyRound size={21} /><div><h2>等待你确认授权</h2><p>授权页会显示设备「顺手云端」，确认后这里会自动继续。</p></div></div>
    <div className="campus-user-code"><span>授权码</span><strong>{pending.userCode}</strong></div>
    <p className="form-hint">有效期至 {new Date(pending.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}。每 {pending.interval} 秒检查一次。</p>
    <div className="campus-auth-actions">
      <a className="button primary compact" href={link} target="_blank" rel="noreferrer">打开 HDUHelp 授权页 <ExternalLink size={14} /></a>
      <button type="button" className="button secondary compact" disabled={busy} onClick={() => void onPoll()}>我已确认，立即检查</button>
      <button type="button" className="button secondary compact" disabled={busy} onClick={() => void onCancel()}>取消</button>
    </div>
  </section>;
}

function AuthStartCard({ scopes, busy, onStart }: {
  scopes: string[]; busy: boolean;
  onStart: (scopes: string[]) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<'all' | 'read'>('all');
  const readScopes = useMemo(() => scopes.filter((scope) => /:(read|readonly)$/.test(scope)), [scopes]);
  const selected = mode === 'all' ? scopes : readScopes;
  return <section className="panel campus-auth-card" aria-label="连接云端校园助手">
    <div className="campus-auth-head"><GraduationCap size={22} /><div><h2>连接云端校园助手</h2><p>用 HDUHelp 官方设备授权。网页不接收你的学校密码，PAT 只保存在云端数据库，不会回到浏览器。</p></div></div>
    <div className="campus-scope-choices">
      <label className={mode === 'all' ? 'selected' : ''}><input type="radio" name="scope-mode" checked={mode === 'all'} onChange={() => setMode('all')} /><span><strong>全部功能</strong><small>{scopes.length} 项权限，包含报名、选座、群聊等写操作；每次写操作仍会单独确认。</small></span></label>
      <label className={mode === 'read' ? 'selected' : ''}><input type="radio" name="scope-mode" checked={mode === 'read'} onChange={() => setMode('read')} /><span><strong>先只读</strong><small>{readScopes.length} 项读取权限；需要写操作时再补充授权。</small></span></label>
    </div>
    <p className="form-hint">授权页由 neo.hduhelp.com 打开，确认后手机会显示设备与权限清单。生成链接后请在新页面完成确认，再回来。</p>
    <div className="campus-auth-actions">
      <button type="button" className="button primary" disabled={busy || selected.length === 0} onClick={() => void onStart(selected)}><KeyRound size={16} />{busy ? '正在生成' : '生成授权链接'}</button>
      <span className="subtle-tag">已选 {selected.length} 项权限</span>
    </div>
  </section>;
}

function ConnectedCard({ status, busy, onRefresh, onReauth, onLogout }: {
  status: CampusCloudStatus; busy: boolean;
  onRefresh: () => Promise<unknown>; onReauth: (scopes?: string[]) => Promise<unknown>; onLogout: () => Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  return <section className="panel campus-connected" aria-label="校园授权状态">
    <div className="campus-auth-head"><ShieldCheck size={22} /><div><h2>校园助手已连接</h2><p>设备 {status.deviceName} · {status.scopes.length} 项权限 · {status.connectedAt ? `连接于 ${new Date(status.connectedAt).toLocaleDateString('zh-CN')}` : '已连接'}{status.expiresAt ? ` · 到期 ${new Date(status.expiresAt).toLocaleDateString('zh-CN')}` : ' · 长期有效'}。</p></div></div>
    <div className="campus-auth-actions">
      <button type="button" className="button secondary compact" disabled={busy} onClick={() => void onRefresh()}><RefreshCw size={15} />刷新</button>
      <button type="button" className="button secondary compact" disabled={busy} onClick={() => void onReauth()}><KeyRound size={15} />补充全部权限</button>
      {!confirming ? <button type="button" className="button secondary compact danger-text" disabled={busy} onClick={() => setConfirming(true)}><LogOut size={15} />断开</button>
        : <><button type="button" className="button secondary compact danger-text" disabled={busy} onClick={() => void onLogout()}>确认断开</button><button type="button" className="button secondary compact" onClick={() => setConfirming(false)}>取消</button></>}
    </div>
    <p className="form-hint">断开会在服务端撤销 PAT，并清除云端保存的授权。</p>
  </section>;
}

function SummaryStrip({ summary }: { summary: ReturnType<typeof useCampus>['summary'] }) {
  const course = nextCourse(summary.courses);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const exam = nextExam(summary.exams, todayKey);
  return <section className="panel campus-summary-strip" aria-label="校园概览">
    <div className="planner-section-title"><h2>校园概览</h2><span className="subtle-tag">{summary.loading ? '正在刷新' : summary.loadedAt ? `更新于 ${new Date(summary.loadedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}</span></div>
    <dl className="campus-facts">
      <div><dt>教学周</dt><dd>{summary.calendar?.weekNow ? `第 ${summary.calendar.weekNow} 周` : '未取到'}</dd></div>
      <div><dt>下一节课</dt><dd>{course ? `${course.name} · ${courseWhen(course)}` : '未取到或没有课程'}</dd></div>
      <div><dt>最近考试</dt><dd>{exam ? `${exam.course} · ${examWhen(exam)}` : '未取到或没有考试'}</dd></div>
      <div><dt>校园卡</dt><dd>{summary.card ? `¥ ${money(summary.card.balanceCents)}` : '未取到'}</dd></div>
    </dl>
    {summary.errors.length ? <p className="form-hint"><AlertCircle size={14} /> {summary.errors.slice(0, 3).join('；')}</p> : null}
  </section>;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

function DataTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8);
  return <div className="campus-table-wrap"><table className="campus-result-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
    <tbody>{rows.slice(0, 50).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{cell(row[column])}</td>)}</tr>)}</tbody></table></div>;
}

function ResultView({ result, onAuthorize, onReconnect, onRetry }: {
  result: CampusResult;
  onAuthorize: (scopes: string[]) => void;
  onReconnect: () => void;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const data = result.data;
  const rows = Array.isArray(data) && data.length && data.every((item) => item && typeof item === 'object' && !Array.isArray(item))
    ? data as Array<Record<string, unknown>> : null;
  const object = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
  const raw = JSON.stringify(result.envelope ?? result.data ?? result, null, 2);
  async function copy() {
    try { await navigator.clipboard.writeText(raw); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* 浏览器不允许时保持原样。 */ }
  }
  if (!result.ok) {
    const hint = campusErrorHint(result.error, result.missingScopes ?? []);
    return <div className="campus-result campus-result-error" role="alert">
      <p><AlertCircle size={16} /> {hint.title}：{result.message ?? result.error ?? '操作没有完成。'}</p>
      <p className="form-hint">{hint.detail}</p>
      {hint.action === 'reconnect' ? <button type="button" className="button secondary compact" onClick={onReconnect}><KeyRound size={14} />{hint.actionLabel}</button> : null}
      {hint.action === 'authorize' ? <button type="button" className="button secondary compact" onClick={() => onAuthorize(result.missingScopes ?? [])}><KeyRound size={14} />{hint.actionLabel}</button> : null}
      {hint.action === 'retry' && onRetry ? <button type="button" className="button secondary compact" onClick={onRetry}>{hint.actionLabel}</button> : null}
      {result.requestId ? <p className="form-hint">请求编号 {result.requestId}</p> : null}
      <details><summary>原始返回</summary><pre className="campus-json">{raw}</pre></details>
    </div>;
  }
  return <div className="campus-result">
    {rows ? <><p className="form-hint">共 {rows.length} 条，显示前 {Math.min(50, rows.length)} 条。</p><DataTable rows={rows} /></>
      : object ? <dl className="campus-kv">{Object.entries(object).slice(0, 30).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{cell(value)}</dd></div>)}</dl>
        : typeof data === 'string' && /^https?:\/\//.test(data) ? <p><a className="text-link" href={data} target="_blank" rel="noreferrer">{data} <ExternalLink size={13} /></a></p>
          : data === null || data === undefined ? <p className="form-hint">操作完成，没有返回内容。</p>
            : <p className="campus-result-plain">{cell(data)}</p>}
    {result.requestId ? <p className="form-hint">请求编号 {result.requestId}</p> : null}
    <div className="campus-result-actions"><button type="button" className="button secondary compact" onClick={() => void copy()}><Copy size={14} />{copied ? '已复制' : '复制 JSON'}</button></div>
    <details><summary>查看原始返回</summary><pre className="campus-json">{raw}</pre></details>
  </div>;
}

type RunnerProps = {
  operation: CampusOperation;
  defaults?: RunnerDefaults;
  autoRun?: boolean;
  onClose: () => void;
  onRun: ReturnType<typeof useCampus>['run'];
  onAuthorize: (scopes: string[]) => void;
  onReconnect: () => void;
};

function initialValues(fields: Array<{ name: string; type: string }>, defaults?: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const field of fields) {
    const value = defaults?.[field.name];
    output[field.name] = value === undefined || value === null ? ''
      : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  }
  return output;
}

function convertField(value: string, type: string): unknown {
  if (value.trim() === '') return undefined;
  if (type === 'integer') return Number.isSafeInteger(Number(value)) ? Number(value) : Number(value);
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === 'true';
  if (type === 'object' || type === 'array') return JSON.parse(value);
  return value;
}

function OperationRunner({ operation, defaults, autoRun, onClose, onRun, onAuthorize, onReconnect }: RunnerProps) {
  const pathParams = operation.params.filter((param) => param.in === 'path');
  const queryParams = operation.params.filter((param) => param.in === 'query');
  const bodyFields = operation.body?.fields ?? [];
  const [pathValues, setPathValues] = useState(() => initialValues(pathParams, defaults?.path));
  const [queryValues, setQueryValues] = useState(() => initialValues(queryParams, defaults?.query));
  const [bodyValues, setBodyValues] = useState(() => initialValues(bodyFields, defaults?.body));
  const [rawBody, setRawBody] = useState(() => operation.body && bodyFields.length === 0 && defaults?.body ? JSON.stringify(defaults.body, null, 2) : '');
  const [confirm, setConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CampusResult | null>(null);
  const [formError, setFormError] = useState('');
  const autoRef = useRef(Boolean(autoRun));
  const risky = operation.risk === 'write' || operation.risk === 'high-risk-write';
  const highRisk = operation.risk === 'high-risk-write';

  const missingRequired = useMemo(() => {
    for (const param of operation.params) {
      const value = param.in === 'path' ? pathValues[param.name] : param.in === 'query' ? queryValues[param.name] : undefined;
      if (param.required && !value) return param.name;
    }
    for (const field of bodyFields) if (field.required && !bodyValues[field.name]) return field.name;
    return '';
  }, [operation.params, pathValues, queryValues, bodyFields, bodyValues]);

  async function execute() {
    if (busy) return;
    setFormError('');
    if (missingRequired) { setFormError(`请填写 ${missingRequired}。`); return; }
    if (risky && !confirm) { setFormError('写操作需要先勾选确认。'); return; }
    if (highRisk && confirmText !== '确认执行') { setFormError('高风险操作需要输入「确认执行」。'); return; }
    setBusy(true);
    try {
      const path: Record<string, string | number> = {};
      for (const param of pathParams) {
        const value = convertField(pathValues[param.name], param.type);
        if (value !== undefined) path[param.name] = value as string | number;
      }
      const query: Record<string, unknown> = {};
      for (const param of queryParams) {
        const value = convertField(queryValues[param.name], param.type);
        if (value !== undefined) query[param.name] = value;
      }
      let body: Record<string, unknown> | undefined;
      if (operation.body) {
        if (bodyFields.length) {
          body = {};
          for (const field of bodyFields) {
            const value = convertField(bodyValues[field.name], field.type);
            if (value !== undefined) body[field.name] = value;
          }
        } else if (rawBody.trim()) {
          const parsed = JSON.parse(rawBody);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体需要是 JSON 对象。');
          body = parsed as Record<string, unknown>;
        }
      }
      setResult(await onRun({ operationId: operation.id, path, query, body, confirm: risky ? confirm : undefined }));
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : '参数格式不对。');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoRef.current) return;
    autoRef.current = false;
    if (missingRequired || risky) return;
    void execute();
    // 只自动执行一次；依赖 intentionally 只取首次渲染的默认值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function field(value: string, setValue: (next: string) => void, name: string, type: string, required: boolean) {
    const label = <>{name}{required ? ' *' : ''}</>;
    if (type === 'boolean') {
      return <label key={name}>{label}<select value={value} onChange={(event) => { setValue(event.target.value); setResult(null); }}><option value="">未设置</option><option value="true">true</option><option value="false">false</option></select></label>;
    }
    if (type === 'object' || type === 'array') {
      return <label key={name}>{label}<textarea rows={4} value={value} onChange={(event) => { setValue(event.target.value); setResult(null); }} placeholder={type === 'array' ? 'JSON 数组' : 'JSON 对象'} /></label>;
    }
    return <label key={name}>{label}<input type={type === 'integer' || type === 'number' ? 'number' : 'text'} value={value} onChange={(event) => { setValue(event.target.value); setResult(null); }} placeholder={type} /></label>;
  }

  return <div className="campus-runner-backdrop" role="dialog" aria-modal="true" aria-label={operation.summary}>
    <div className="campus-runner">
      <div className="campus-runner-head">
        <div><span className="subtle-tag">{operation.domain}</span><h2>{operation.summary}</h2><p>{operation.description || operation.command}</p></div>
        <button type="button" className="campus-close" aria-label="关闭" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="campus-runner-meta">
        <RiskBadge risk={operation.risk} />
        <span className="subtle-tag">{operation.method} {operation.path}</span>
        <ScopeSummary scopes={operation.scopes} />
      </div>
      <div className="campus-runner-fields">
        {pathParams.length ? <fieldset><legend>路径参数</legend><div className="campus-field-grid">{pathParams.map((param) => field(pathValues[param.name] ?? '', (next) => setPathValues((previous) => ({ ...previous, [param.name]: next })), param.name, param.type, param.required))}</div></fieldset> : null}
        {queryParams.length ? <fieldset><legend>查询参数</legend><div className="campus-field-grid">{queryParams.map((param) => field(queryValues[param.name] ?? '', (next) => setQueryValues((previous) => ({ ...previous, [param.name]: next })), param.name, param.type, param.required))}</div></fieldset> : null}
        {bodyFields.length ? <fieldset><legend>请求体</legend><div className="campus-field-grid">{bodyFields.map((fieldValue) => field(bodyValues[fieldValue.name] ?? '', (next) => setBodyValues((previous) => ({ ...previous, [fieldValue.name]: next })), fieldValue.name, fieldValue.type, fieldValue.required))}</div></fieldset> : null}
        {operation.body && !bodyFields.length ? <fieldset><legend>请求体 JSON</legend><textarea rows={5} value={rawBody} onChange={(event) => { setRawBody(event.target.value); setResult(null); }} /></fieldset> : null}
        {!operation.params.length && !operation.body ? <p className="form-hint">这个操作不需要参数。</p> : null}
      </div>
      {risky ? <div className="campus-confirm">
        <label><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />我确认执行这次写操作，并已核对参数。</label>
        {highRisk ? <label>高风险操作，请输入「确认执行」<input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="确认执行" /></label> : null}
      </div> : null}
      {formError ? <p className="form-error" role="alert">{formError}</p> : null}
      <div className="campus-auth-actions">
        <button type="button" className="button primary" disabled={busy} onClick={() => void execute()}><Play size={15} />{busy ? '正在执行' : '执行'}</button>
        <button type="button" className="button secondary compact" onClick={onClose}>关闭</button>
      </div>
      {result ? <ResultView result={result} onAuthorize={onAuthorize} onReconnect={onReconnect} onRetry={() => { void execute(); }} /> : null}
    </div>
  </div>;
}

function OperationList({ operations, domainLabel, onSelect }: {
  operations: CampusOperation[]; domainLabel?: (domain: string) => string;
  onSelect: (operation: CampusOperation) => void;
}) {
  return <div className="campus-ops">{operations.map((operation) => <button type="button" className="campus-op-card" key={operation.id} onClick={() => onSelect(operation)}>
    <span className="campus-op-top"><span className="subtle-tag">{domainLabel ? domainLabel(operation.domain) : operation.domain}</span><RiskBadge risk={operation.risk} /></span>
    <strong>{operation.summary}</strong>
    <small>{operation.command}</small>
    <span className="campus-op-foot"><span className="subtle-tag">{operation.method} {operation.path}</span><ScopeSummary scopes={operation.scopes} /><ChevronRight size={15} /></span>
  </button>)}</div>;
}

export function CampusPage() {
  const { gateway, status, statusLoading, statusError, catalog, catalogLoading, catalogError, summary, refresh, startAuth, pollAuth, cancelAuth, disconnect, run } = useCampus();
  const [tab, setTab] = useState('quick');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ operation: CampusOperation; defaults?: RunnerDefaults; autoRun?: boolean } | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const scopes = catalog?.scopes ?? [];
  const operations = catalog?.operations ?? [];
  const domainLabel = (domain: string) => catalog?.domains.find((item) => item.name === domain)?.label ?? domain;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return operations.filter((operation) => (tab === 'all' || operation.domain === tab)
      && (!query || `${operation.command} ${operation.summary} ${operation.description} ${operation.id}`.toLowerCase().includes(query)));
  }, [operations, search, tab]);

  async function authorize(scopesToRequest: string[]) {
    setAuthBusy(true);
    setAuthError('');
    try {
      await startAuth(scopesToRequest.length ? scopesToRequest : undefined);
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : '生成授权链接失败。');
    } finally {
      setAuthBusy(false);
    }
  }

  function poll() {
    return pollAuth().catch((reason) => { setAuthError(reason instanceof Error ? reason.message : '检查授权失败。'); return null; });
  }

  function cancel() {
    return cancelAuth().catch((reason) => { setAuthError(reason instanceof Error ? reason.message : '取消授权失败。'); return null; });
  }

  async function logout() {
    setAuthBusy(true);
    try {
      await disconnect();
    } catch (reason) {
      setAuthError(reason instanceof Error ? reason.message : '断开校园授权失败。');
    } finally {
      setAuthBusy(false);
    }
  }

  function choose(operation: CampusOperation, defaults?: RunnerDefaults, autoRun?: boolean) {
    setSelected({ operation, defaults, autoRun });
  }

  function quickSelect(action: QuickAction) {
    const operation = operations.find((item) => item.id === action.id);
    if (!operation) return;
    const defaults = action.defaults?.(summary);
    choose(operation, defaults, Boolean(action.auto) && hasRequiredDefaults(operation, defaults));
  }

  function onAuthorize(missing: string[]) {
    setSelected(null);
    void authorize(missing);
  }

  return <>
    <PageHeading title="校园里的事，在云端顺手办。" description="教务、校园生活、空课表、图书馆、信息流和群聊都走 HDUHelp 官方接口；PAT 只存在云端，写操作每次确认。" />
    {!gateway ? <section className="panel campus-cloud-gate"><Cloud size={21} /><div><h2>先连接云端后端</h2><p>校园助手现在运行在 Qoder Sites 云端。请到设置页连接云端后端（部署后的地址已自动填好），再回到这里完成 HDUHelp 设备授权。</p><Link className="button secondary compact" to="/settings">去设置连接</Link></div></section> : null}
    {gateway && statusLoading && !status ? <p className="campus-loading" role="status">正在读取校园授权状态…</p> : null}
    {statusError ? <p className="form-error" role="alert">{statusError}</p> : null}
    {gateway && status?.pending ? <PendingAuthCard pending={status.pending} busy={authBusy} onPoll={poll} onCancel={cancel} /> : null}
    {gateway && !status?.connected && !status?.pending ? (scopes.length ? <AuthStartCard scopes={scopes} busy={authBusy} onStart={authorize} /> : <p className="campus-loading">{catalogError || '正在读取权限清单…'}</p>) : null}
    {gateway && status?.connected ? <ConnectedCard status={status} busy={authBusy} onRefresh={refresh} onReauth={(next) => authorize(next ?? [])} onLogout={logout} /> : null}
    {authError ? <p className="form-error" role="alert">{authError}</p> : null}
    {gateway && status?.connected ? <SummaryStrip summary={summary} /> : null}
    {gateway && status?.connected ? <section className="panel campus-workspace" aria-label="校园操作">
      <div className="campus-tabs" role="tablist" aria-label="校园业务域">
        <button type="button" role="tab" aria-selected={tab === 'quick'} className={tab === 'quick' ? 'active' : ''} onClick={() => setTab('quick')}><Sparkles size={15} />常用</button>
        {(catalog?.domains ?? []).map((domain) => { const Icon = DOMAIN_ICON[domain.name] ?? ListFilter; return <button type="button" role="tab" key={domain.name} aria-selected={tab === domain.name} className={tab === domain.name ? 'active' : ''} onClick={() => setTab(domain.name)}><Icon size={15} />{domain.label}<small>{domain.operations}</small></button>; })}
        <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}><ListFilter size={15} />全部</button>
      </div>
      {tab !== 'quick' ? <label className="campus-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索命令、说明或路径" /></label> : null}
      {catalogLoading && !catalog ? <p className="campus-loading" role="status">正在读取 199 个校园操作…</p> : null}
      {catalogError ? <p className="form-error" role="alert">{catalogError}</p> : null}
      {tab === 'quick' ? <div className="campus-quick-grid">
        {Object.entries(QUICK).map(([domain, actions]) => <article className="campus-quick-card" key={domain}>
          <h3>{domainLabel(domain)}</h3>
          <div className="campus-quick-actions">{actions.map((action) => {
            const operation = operations.find((item) => item.id === action.id);
            if (!operation) return null;
            return <button type="button" key={action.id} onClick={() => quickSelect(action)}><span>{action.label}</span>{action.hint ? <small>{action.hint}</small> : null}<RiskBadge risk={operation.risk} /></button>;
          })}</div>
        </article>)}
      </div> : null}
      {tab !== 'quick' ? (filtered.length ? <OperationList operations={filtered} domainLabel={tab === 'all' ? domainLabel : undefined} onSelect={(operation) => choose(operation)} />
        : <p className="planner-empty">{search ? '没有匹配的操作。' : '这个域暂时没有操作。'}</p>) : null}
    </section> : null}
    <div className="planner-spaced"><ServiceDirectory /></div>
    <section className="campus-boundary"><ShieldCheck size={19} /><div><h3>云端校园边界</h3><p>PAT 只保存在云端数据库，网页和浏览器都拿不到；设备的 HDUHelp 授权可随时在这里撤销。报名、选座、群聊管理等写操作会先展示参数并要求确认，高风险操作还需输入「确认执行」。不要把授权链接发给别人。</p></div></section>
    {selected ? <OperationRunner operation={selected.operation} defaults={selected.defaults} autoRun={selected.autoRun} onClose={() => setSelected(null)} onRun={run} onAuthorize={onAuthorize} onReconnect={() => setSelected(null)} /> : null}
  </>;
}