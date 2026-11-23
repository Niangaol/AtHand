import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, Send, Sparkles, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { isGatewayConnected } from '../../data/gateway';
import { getAssistantSettings, sendAssistantMessage } from '../../data/assistant';
import type { AssistantSettings, AssistantTrace } from '../../data/assistant';
import { toolLabel } from '../../data/agentToolLabels';

const STORAGE_KEY = 'shunshou.assistant.v1';
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; trace?: AssistantTrace[]; at: number };
type Stored = { version: 1; messages: ChatMessage[] };

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as Partial<Stored>;
    if (value?.version !== 1 || !Array.isArray(value.messages)) return [];
    return value.messages
      .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && message.content.length <= 20000)
      .slice(-40)
      .map((message) => ({
        id: typeof message.id === 'string' ? message.id : crypto.randomUUID(),
        role: message.role,
        content: message.content,
        at: typeof message.at === 'number' ? message.at : Date.now(),
        ...(Array.isArray(message.trace) ? { trace: message.trace.filter((item) => item && typeof item.tool === 'string' && typeof item.ok === 'boolean').slice(0, 30) } : {}),
      }));
  } catch {
    return [];
  }
}

const quickPrompts = [
  { label: '今天怎么安排？', hint: '看课程、倒计时和专注', text: '今天有什么安排？帮我理一下重点。' },
  { label: '这周花了多少？', hint: '按分类看支出与工时', text: '这周花了多少钱？按分类说一下。' },
  { label: '安排明晚复习', hint: '直接写进日程', text: '帮我安排明天晚上七点到九点复习。' },
  { label: '开始 25 分钟专注', hint: '立刻开始番茄钟', text: '开始 25 分钟专注，任务叫复习。' },
];

const railCapabilities = [
  ['日程与课程', '查今天、建课程、改安排'],
  ['账本与兼职', '记支出、记工时、看月度'],
  ['专注与倒计时', '开始专注、查剩余时间'],
  ['旅记与校园', '整理行程、查办事入口'],
];

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const connected = isGatewayConnected();
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const todayLabel = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

  useEffect(() => {
    if (!connected) { setLoadingSettings(false); return; }
    let active = true;
    getAssistantSettings()
      .then((value) => { if (active) setSettings(value); })
      .catch((reason) => { if (active) setSettingsError(reason instanceof Error ? reason.message : '读取模型设置失败。'); })
      .finally(() => { if (active) setLoadingSettings(false); });
    return () => { active = false; };
  }, [connected]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, messages: messages.slice(-40) } satisfies Stored)); } catch { /* 存储不可用时只保留当前页面对话。 */ }
  }, [messages]);
  useEffect(() => {
    if (!messages.length && !sending) return;
    const timer = window.setTimeout(() => {
      if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
      dockRef.current?.scrollIntoView({ block: 'nearest' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [messages, sending]);

  async function send(text: string, appendUser = true) {
    const content = text.trim();
    if (!content || sending) return;
    if (!connected) { setError('还没有连接电脑。请先到设置里连接。'); return; }
    if (!settings?.model) { setError('还没有配置模型。请先到设置里填写模型地址和名称。'); return; }
    const base = appendUser
      ? [...messages, { id: crypto.randomUUID(), role: 'user' as const, content, at: Date.now() }].slice(-40)
      : messages;
    if (appendUser) setMessages(base);
    setInput('');
    setSending(true);
    setError('');
    try {
      const history = base.map(({ role, content: value }) => ({ role, content: value })).slice(-20);
      const result = await sendAssistantMessage(history);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant' as const, content: result.reply, trace: result.trace, at: Date.now() }].slice(-40));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '这次没有成功，请稍后再试。');
    } finally {
      setSending(false);
    }
  }

  return <>
    <div className="assistant-stage">
      <header className="assistant-head">
        <div className="assistant-head-copy">
          <span className="assistant-kicker"><Sparkles size={14} /> AI 工作台</span>
          <h1>说一句，顺手去做。</h1>
          <p>查安排、记账、开专注、理旅记。写操作直接执行，删除仍回到对应页面。</p>
        </div>
        <div className="assistant-status-strip">
          <span className={`assistant-state${connected ? ' ok' : ''}`}><i />{connected ? '电脑已连接' : '未连接电脑'}</span>
          <span className="assistant-state model" title={settings?.model || undefined}>{settings?.model ? `模型 · ${settings.model}` : '模型未配置'}</span>
          {settings ? <span className="assistant-state privacy">{settings.privacyMode === 'local-only' ? '只在本机' : settings.privacyMode === 'redact' ? '云端脱敏' : '不脱敏'}</span> : null}
          {messages.length ? <button type="button" className="assistant-clear" onClick={() => setConfirmClear(true)}><Trash2 size={15} />清空</button> : null}
        </div>
      </header>
      <div className="assistant-workspace">
        <section className="assistant-main" aria-label="助手对话">
          {!connected ? <div className="assistant-setup">
            <span className="assistant-setup-mark"><Sparkles size={24} /></span>
            <h2>先连接电脑</h2>
            <p>助手通过电脑上的模型和数据运行。连接后，这里就是每天的第二大脑。</p>
            <Link className="button primary" to="/settings">去连接电脑</Link>
          </div>
            : loadingSettings ? <div className="assistant-setup"><Sparkles size={24} /><p role="status">正在读取模型设置…</p></div>
              : !settings?.model ? <div className="assistant-setup">
                <span className="assistant-setup-mark"><Sparkles size={24} /></span>
                <h2>还差一个模型</h2>
                <p>到设置里填模型地址和名称。本机 Ollama 推荐 <code>ling-3.0-tiny:32k</code>；云端填兼容 OpenAI 的地址和 Key。</p>
                <Link className="button primary" to="/settings">配置模型</Link>
                {settingsError ? <p className="form-hint">{settingsError}</p> : null}
              </div>
                : <>
                  <div className="assistant-thread" role="log" aria-live="polite" aria-label="对话记录" ref={threadRef}>
                    {messages.length === 0 ? <div className="assistant-start">
                      <div className="assistant-start-copy">
                        <span className="assistant-kicker">现在可以开始</span>
                        <h2>今天想先处理什么？</h2>
                        <p>直接说一件事。助手会先查你的数据，再把结果写回来。</p>
                      </div>
                      <div className="assistant-intents">
                        {quickPrompts.map((prompt, index) => <button type="button" key={prompt.label} className="assistant-intent" disabled={sending} onClick={() => void send(prompt.text)}>
                          <span className="intent-index">{String(index + 1).padStart(2, '0')}</span>
                          <span className="intent-copy"><strong>{prompt.label}</strong><span>{prompt.hint}</span></span>
                          <ArrowUpRight size={17} />
                        </button>)}
                      </div>
                    </div> : <ol className="assistant-log">{messages.map((message) => <li key={message.id} className={`assistant-turn ${message.role}`}>
                      <div className="assistant-turn-head"><span className="assistant-speaker">{message.role === 'user' ? '你' : '顺手'}</span><time dateTime={new Date(message.at).toISOString()}>{formatTime(message.at)}</time></div>
                      <div className="assistant-turn-body">{message.content}</div>
                      {message.trace?.length ? <details className="assistant-trace">
                        <summary><Check size={13} />{message.trace.length} 个操作</summary>
                        <ul>{message.trace.map((item, index) => <li key={`${message.id}-${index}`}><strong>{toolLabel(item.tool)}</strong><span>{item.ok ? (item.summary || '完成') : (item.message || item.error || '失败')}</span></li>)}</ul>
                      </details> : null}
                    </li>)}</ol>}
                    {sending ? <p className="assistant-thinking" role="status"><span /><span /><span />正在查你的数据，并调用顺手的工具…</p> : null}
                  </div>
                  {error ? <div className="inline-notice assistant-error" role="alert"><span>{error}</span>{lastUser ? <button type="button" className="text-link" onClick={() => void send(lastUser, false)}>重试</button> : null}</div> : null}
                  <div className="assistant-dock" ref={dockRef}>
                    {messages.length ? <div className="assistant-quick">{quickPrompts.map((prompt) => <button type="button" key={prompt.label} disabled={sending} onClick={() => void send(prompt.text)}>{prompt.label}</button>)}</div> : null}
                    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
                      <div className="composer-field">
                        <textarea aria-label="告诉助手要做什么" value={input} onChange={(event) => setInput(event.target.value)} placeholder="比如：明晚七点安排复习一小时" rows={2} maxLength={4000} disabled={sending}
                          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(input); } }} />
                        <span className="composer-hint">Enter 发送 · Shift + Enter 换行</span>
                      </div>
                      <button className="assistant-send" disabled={sending || !input.trim()}><Send size={18} /><span>{sending ? '处理中' : '发送'}</span></button>
                    </form>
                  </div>
                </>}
        </section>
        <aside className="assistant-rail" aria-label="工作台状态">
          <div className="rail-block">
            <span className="rail-label">此刻</span>
            <dl className="rail-facts">
              <div><dt>日期</dt><dd>{todayLabel}</dd></div>
              <div><dt>电脑</dt><dd className={connected ? 'rail-ok' : ''}>{connected ? '已连接' : '未连接'}</dd></div>
              <div><dt>模型</dt><dd title={settings?.model || undefined}>{settings?.model || '未配置'}</dd></div>
            </dl>
          </div>
          <div className="rail-block">
            <span className="rail-label">它能做</span>
            <ul className="rail-list">{railCapabilities.map(([title, detail]) => <li key={title}><strong>{title}</strong><span>{detail}</span></li>)}</ul>
          </div>
          <div className="rail-block rail-boundary">
            <span className="rail-label">边界</span>
            <p>不删除数据，不代付款、提交申请或签字。校园服务只读。</p>
            <Link className="rail-link" to="/settings">模型与接口设置 <ArrowUpRight size={14} /></Link>
          </div>
        </aside>
      </div>
    </div>
    {confirmClear ? <ConfirmDialog title="清空对话？" description="只删除这个浏览器里的对话记录，不会删除日程、账本或专注记录。" confirmLabel="确认清空" onCancel={() => setConfirmClear(false)} onConfirm={() => { setMessages([]); setError(''); localStorage.removeItem(STORAGE_KEY); setConfirmClear(false); }} /> : null}
  </>;
}
