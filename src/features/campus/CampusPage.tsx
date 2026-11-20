import { useEffect, useRef, useState } from 'react';
import { CircleAlert, ExternalLink, GraduationCap, Info, Search } from 'lucide-react';
import { PageHeading } from '../../components/PageHeading';
import { askHdu, HduError } from './hduClient';
import type { HduAnswer } from './hduClient';

const TOKEN_KEY = 'shunshou.hduPassword';
const presets = ['今天有什么课', '本周考试安排', '查一下我的成绩', '我的培养方案'];
const stateLabels: Record<string, string> = { COMPLETED: '已回答', FAILED: '未取到结果', PARTIAL: '部分结果' };

export function CampusPage() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? '');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<HduAnswer | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (password) sessionStorage.setItem(TOKEN_KEY, password);
    else sessionStorage.removeItem(TOKEN_KEY);
  }, [password]);

  async function ask(text: string) {
    if (loading || !text.trim()) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const timer = window.setTimeout(() => current.abort(), 65_000);
    setQuestion(text);
    setLoading(true);
    setError('');
    try {
      setAnswer(await askHdu({ password, text, signal: current.signal }));
    } catch (reason) {
      setAnswer(null);
      setError(reason instanceof HduError ? reason.message : '校园助手暂时不可用，请稍后重试。');
    } finally {
      window.clearTimeout(timer);
      setLoading(false);
    }
  }

  return <>
    <PageHeading title="校园里的事，也顺手问。" description="课表、考试、成绩由本机的杭电助手回答；顺手只展示，不代你提交任何申请。" />
    <div className="campus-layout">
      <section className="panel campus-panel">
        <div className="campus-connect"><span className="workplace-icon"><GraduationCap size={25} /></span><div><h2>连接本机杭电助手</h2><p>在 HDU-Helper 目录启动服务，把访问口令填在这里。查个人课表需以 <code>WEB_OWNER_BINDING=true</code> 启动（默认关闭），并确认 <code>HDUHELP_CLI_PATH</code> 指向实际的 CLI。</p></div></div>
        <label className="campus-token">HDU-Helper 访问口令<input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 32 个字符" /></label>
        <p className="form-hint">口令只保存在当前标签页，关闭页面即清除；不会写入账本、仓库或云端。</p>
        <div className="campus-presets" aria-label="常用问题">{presets.map((preset) => <button key={preset} className="preset-button" disabled={loading || password.trim().length < 32} onClick={() => ask(preset)}>{preset}</button>)}</div>
        <form className="campus-question" onSubmit={(event) => { event.preventDefault(); void ask(question); }}><label>问点别的<input value={question} maxLength={1500} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：明天几节课，在哪个教室？" /></label><button className="button primary" disabled={loading || password.trim().length < 32 || !question.trim()}><Search size={17} />{loading ? '正在问' : '提问'}</button></form>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {loading ? <p className="campus-loading" role="status">正在等杭电助手回答，最多 60 秒……</p> : null}
      </section>

      <section className="panel campus-answer" aria-live="polite" aria-busy={loading}>
        {answer ? <>
          <div className="answer-top"><div><span className="answer-question">{question}</span><h2>顺手记下的回答</h2></div><div className="answer-badges"><span className={`state-badge ${answer.state === 'COMPLETED' ? 'ok' : 'warn'}`}>{stateLabels[answer.state] ?? answer.state}</span>{answer.isDemo ? <span className="demo-answer">演示数据</span> : null}</div></div>
          <p className="answer-text">{answer.text}</p>
          {answer.truncated ? <p className="form-hint">回答较长，已截断。</p> : null}
          {answer.warnings.length > 0 ? <div className="answer-warnings"><CircleAlert size={17} /><div><strong>杭电助手提示</strong><ul>{answer.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></div> : null}
          {answer.sources.length > 0 ? <div className="answer-sources"><h3>出处</h3>{answer.sources.map((source, index) => <p key={`${source.url ?? source.title ?? index}`}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title ?? source.url}<ExternalLink size={13} /></a> : source.title ?? '未命名来源'}<small>{[source.publisher, source.published_at?.slice(0, 10)].filter(Boolean).join(' · ')}</small></p>)}</div> : null}
          <div className="answer-origin"><Info size={15} /><span>HDU-Helper · route {answer.route || '未标注'} · {new Date().toLocaleString('zh-CN')}</span></div>
        </> : <div className="answer-empty"><GraduationCap size={36} strokeWidth={1.3} /><h2>还没问过</h2><p>填好口令，点一个常用问题。拿不到数据时，它会明确说没拿到，不会编造。</p></div>}
      </section>
    </div>
    <section className="campus-boundary"><Info size={19} /><div><h3>本机校园模块</h3><p>杭电助手只接受本机请求，部署在 Qoder Sites 的公网版暂时连不到它；演示时请在本机打开顺手。顺手只回答问题、给出来源，不代提交、不代签字、不代付款。</p></div></section>
  </>;
}
