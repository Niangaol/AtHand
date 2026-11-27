import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, RefreshCw, ShieldCheck, Sprout, UserRound } from 'lucide-react';
import { GatewayError, defaultGatewayUrl, gatewayLogin, gatewayRegister, isGatewayConnected, normalizeGatewayUrl } from '../../data/gateway';

type Mode = 'login' | 'register';

const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{3,32}$/u;

export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [address, setAddress] = useState(() => defaultGatewayUrl());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const register = mode === 'register';
  const from = typeof (location.state as { from?: unknown } | null)?.from === 'string'
    ? (location.state as { from: string }).from
    : '/';

  useEffect(() => {
    if (isGatewayConnected()) navigate('/', { replace: true });
  }, [navigate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    let base = '';
    try {
      base = normalizeGatewayUrl(address.trim());
    } catch {
      setError('服务地址需以 http:// 或 https:// 开头。');
      return;
    }
    if (!base) {
      setError('请填写云端服务地址。');
      return;
    }
    const name = username.trim();
    if (!USERNAME_PATTERN.test(name)) {
      setError('账号需为 3–32 位字母、数字、下划线、短横线或中文。');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位。');
      return;
    }
    if (register && password !== confirmPassword) {
      setError('两次输入的密码不一致。');
      return;
    }
    setBusy(true);
    try {
      if (register) await gatewayRegister(base, name, password);
      else await gatewayLogin(base, password, name);
      navigate(from, { replace: true });
    } catch (caught) {
      setError(caught instanceof GatewayError || caught instanceof Error ? caught.message : '暂时没能完成，请稍后再试。');
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-page">
    <aside className="auth-story" aria-hidden="true">
      <div className="auth-brand"><span className="auth-brand-mark"><Sprout size={24} strokeWidth={1.8} /></span><span>顺手<small>校园个人助手</small></span></div>
      <div className="auth-story-copy">
        <h1>把零散的校园日子，<br />收进一处。</h1>
        <p className="auth-story-lead">课表、账本、专注、旅记和校园服务，共用一个安静的入口。</p>
        <ul className="auth-points">
          <li>账本与生活记录按账号隔离</li>
          <li>校园授权只保存在云端，不进浏览器</li>
          <li>写操作每次确认，不替你付款或提交</li>
        </ul>
      </div>
      <p className="auth-story-foot">v0.6 · 顺手</p>
    </aside>

    <main className="auth-panel">
      <div className="auth-card">
        <header className="auth-head">
          <p className="auth-eyebrow">{register ? '第一次来' : '欢迎回来'}</p>
          <h1>{register ? '创建你的顺手账号' : '登录顺手'}</h1>
          <p className="auth-sub">{register ? '一个账号对应一份独立的账本、生活记录和校园授权。' : '用账号和密码进入你的账本与生活记录。'}</p>
        </header>

        <div className="auth-switch" role="tablist" aria-label="登录或注册">
          <Link role="tab" aria-selected={!register} className={!register ? 'active' : ''} to="/login" replace>登录</Link>
          <Link role="tab" aria-selected={register} className={register ? 'active' : ''} to="/register" replace>注册</Link>
        </div>

        <form className="auth-form" onSubmit={submit} noValidate>
          <label>账号
            <span className="auth-input">
              <UserRound size={17} aria-hidden="true" />
              <input
                autoComplete="username"
                value={username}
                maxLength={32}
                autoFocus
                onChange={(event) => { setUsername(event.target.value); setError(''); }}
                placeholder="3–32 位字母、数字、下划线或中文"
              />
            </span>
          </label>

          <label>{register ? '设置密码' : '密码'}
            <span className="auth-input">
              <ShieldCheck size={17} aria-hidden="true" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete={register ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => { setPassword(event.target.value); setError(''); }}
                placeholder="至少 8 位"
              />
              <button type="button" className="auth-eye" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>

          {register ? <label>确认密码
            <span className="auth-input">
              <ShieldCheck size={17} aria-hidden="true" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => { setConfirmPassword(event.target.value); setError(''); }}
                placeholder="再输入一次密码"
              />
            </span>
          </label> : null}

          {error ? <p className="form-error auth-error" role="alert">{error}</p> : null}

          <button className="button primary auth-submit" disabled={busy || !username.trim() || password.length < 8 || (register && password !== confirmPassword)}>
            {busy ? <><RefreshCw size={16} className="auth-spin" /> 正在{register ? '创建' : '登录'}</> : <>{register ? '注册并进入' : '登录'}<ArrowRight size={16} /></>}
          </button>
        </form>

        <details className="auth-advanced">
          <summary>云端服务地址</summary>
          <label>服务地址
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="https://你的站点/functions/v1/app" />
          </label>
          <p className="form-hint">部署在 Qoder Sites 时已自动填好，一般不用改。本机同步网关请到「设置」填写访问口令，不使用这个页面。</p>
        </details>

        <p className="auth-fineprint">
          {register ? '注册即表示你同意只在这个账号里保存自己的数据。' : '忘记密码暂时无法自助找回；可以重新注册一个账号。'}
          <Link className="auth-home" to="/">先随便看看 <ArrowRight size={13} /></Link>
        </p>
      </div>
    </main>
  </div>;
}