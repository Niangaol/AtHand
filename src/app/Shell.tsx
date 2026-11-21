import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Sparkles, Sprout } from 'lucide-react';
import { assistantNav, navigation, navigationGroups } from './navigation';
import { useRecords } from '../data/RecordsProvider';

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { records, error, blocked } = useRecords();
  const hasExamples = records.some((record) => record.source === 'demo');
  const pageName = location.pathname.startsWith('/entry/') ? '编辑记录' : navigation.find((item) => item.path === location.pathname || item.path !== '/' && location.pathname.startsWith(`${item.path}/`))?.label ?? '页面未找到';
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  useEffect(() => {
    document.title = `${pageName} · 顺手`;
    if (previousPath.current !== location.pathname) {
      mainRef.current?.focus({ preventScroll: true });
      document.documentElement.scrollTop = 0;
      previousPath.current = location.pathname;
    }
  }, [location.pathname, pageName]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigate('/assistant');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <aside className="sidebar">
      <Link className="brand" to="/" aria-label="顺手首页"><span className="brand-mark"><Sprout size={25} strokeWidth={1.8} /></span><span>顺手<small>校园个人助手</small></span></Link>
      <NavLink to={assistantNav.path} className={({ isActive }) => `assistant-entry${isActive ? ' active' : ''}`}>
        <span className="assistant-entry-mark"><Sparkles size={19} strokeWidth={1.8} /></span>
        <span className="assistant-entry-copy"><strong>AI 工作台</strong><small>一句话查、记、安排</small></span>
        <ArrowUpRight size={15} />
      </NavLink>
      <nav aria-label="主导航" className="main-nav">{navigationGroups.map((group) => <div className="nav-group" key={group.title}><span className="nav-caption">{group.title}</span>{group.items.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} end={path === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}><Icon size={19} strokeWidth={1.7} /><span>{label}</span></NavLink>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><Sprout size={22} /><p>小事顺手记，<br />日子慢慢理。</p><Link to="/settings">数据与设置 <ArrowUpRight size={14} /></Link></div><div className="profile"><span className="avatar">同</span><span>一位在校同学<small>个人空间</small></span><span className="profile-dot" /></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>我的校园生活 <span className="topbar-divider">/</span> <strong>{pageName}</strong></span><div className="topbar-actions"><Link className="command-trigger" to="/assistant" aria-label="问助手"><Sparkles size={16} /><span className="command-copy"><strong>问助手</strong><span>查安排、记账、开专注</span></span><kbd>Ctrl K</kbd></Link><span className="demo-badge"><span />{hasExamples ? '示例模式' : '本机账本'}</span></div></header>
      <main id="main-content" className="main-content" tabIndex={-1} ref={mainRef}>
        {error ? <div className="storage-warning" role="alert">{error}{blocked ? <Link to="/settings">前往数据设置</Link> : null}</div> : null}
        <Outlet />
      </main>
      <footer className="app-footer"><span>顺手，让生活少一点零散。</span><span>v0.6 · {hasExamples ? '当前账单为示例' : '账本存本机，可连电脑同步'}</span></footer>
    </div>
  </div>;
}
