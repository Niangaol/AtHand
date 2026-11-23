import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Laptop, RefreshCw } from 'lucide-react';
import { GatewayError, gatewayFetch } from '../../data/gateway';

type AccountUser = { id: string; username: string; createdAt: string | null };
type AccountSession = {
  id: string;
  deviceLabel: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string;
  current: boolean;
};
type AccountStats = {
  sessions: number;
  ledgerRecords: number;
  plannerEvents: number;
  plannerRevision: number;
  samples: number;
  campusConnected: boolean;
};
type AccountSummary = { user: AccountUser; currentSession: AccountSession | null; stats: AccountStats };

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new GatewayError('服务返回异常。', 'bad_response');
  const record = body as Record<string, unknown>;
  if (!response.ok || record.ok === false) {
    throw new GatewayError(
      typeof record.message === 'string' ? record.message : '账号请求失败。',
      typeof record.error === 'string' ? record.error : `http_${response.status}`,
    );
  }
  return record;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后再试。';
}

function formatTime(value: string | null): string {
  if (!value) return '未知';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '未知';
  return new Date(time).toLocaleString('zh-CN');
}

export function AccountPanel({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryBody, sessionBody] = await Promise.all([
        gatewayFetch('/api/account').then(readJson),
        gatewayFetch('/api/account/sessions').then(readJson),
      ]);
      const user = summaryBody.user as AccountUser | undefined;
      const stats = summaryBody.stats as AccountStats | undefined;
      if (!user || !stats) throw new GatewayError('账号信息不完整。', 'bad_response');
      setSummary({
        user,
        currentSession: (summaryBody.currentSession as AccountSession | null) ?? null,
        stats,
      });
      setSessions(Array.isArray(sessionBody.sessions) ? sessionBody.sessions as AccountSession[] : []);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function changePassword() {
    if (newPassword.length < 8) { setStatus('新密码至少 8 位。'); return; }
    if (newPassword !== confirmPassword) { setStatus('两次输入的新密码不一致。'); return; }
    setBusy('password');
    setStatus('');
    try {
      const body = await gatewayFetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      }).then(readJson);
      const revoked = typeof body.revokedSessions === 'number' ? body.revokedSessions : 0;
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatus(`密码已更新${revoked > 0 ? `，已退出其它 ${revoked} 个设备` : ''}。`);
      await refresh();
    } catch (caught) {
      setStatus(errorText(caught));
    } finally {
      setBusy('');
    }
  }

  async function revoke(session: AccountSession) {
    setBusy(session.id);
    setStatus('');
    try {
      const body = await gatewayFetch(`/api/account/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' }).then(readJson);
      if (body.current === true) {
        onLoggedOut();
        return;
      }
      setStatus(`已退出「${session.deviceLabel || '未知设备'}」。`);
      await refresh();
    } catch (caught) {
      setStatus(errorText(caught));
    } finally {
      setBusy('');
    }
  }

  async function logoutAll() {
    setBusy('all');
    setStatus('');
    try {
      const body = await gatewayFetch('/api/account/logout-all', { method: 'POST' }).then(readJson);
      const revoked = typeof body.revoked === 'number' ? body.revoked : 0;
      setStatus(`已退出全部 ${revoked} 个会话，请重新登录。`);
      onLoggedOut();
    } catch (caught) {
      setStatus(errorText(caught));
    } finally {
      setBusy('');
    }
  }

  if (error) return <><p className="form-error" role="alert">{error}</p><button type="button" className="button secondary compact" onClick={() => { void refresh(); }}>重试</button></>;
  if (!summary) return <p className="form-hint" role="status">{loading ? '正在读取账号信息…' : '还没有账号信息。'}</p>;

  return <div className="account-detail">
    <div className="setting-row">
      <Laptop size={22} />
      <div>
        <h3>当前账号：{summary.user.username}</h3>
        <p>注册时间：{formatTime(summary.user.createdAt)} · 设备会话 {summary.stats.sessions} 个</p>
        <p className="form-hint">
          云端保存：账本记录 {summary.stats.ledgerRecords} 条 · 日程事件 {summary.stats.plannerEvents} 条 · 采集样本 {summary.stats.samples} 条 · 校园助手{summary.stats.campusConnected ? '已连接' : '未连接'}
        </p>
        <div className="setting-actions">
          <button type="button" className="button secondary compact" disabled={loading} onClick={() => { void refresh(); }}>
            <RefreshCw size={15} /> 刷新
          </button>
        </div>
      </div>
    </div>

    <div className="setting-row">
      <KeyRound size={22} />
      <div>
        <h3>修改密码</h3>
        <p>改密后会退出其它设备，当前设备保持登录。</p>
        <div className="account-password-form">
          <label>当前密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>新密码<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" /></label>
          <label>确认新密码<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          <button type="button" className="button secondary compact" disabled={busy === 'password' || !currentPassword || newPassword.length < 8 || newPassword !== confirmPassword} onClick={() => { void changePassword(); }}>更新密码</button>
        </div>
      </div>
    </div>

    <div className="setting-row">
      <Laptop size={22} />
      <div>
        <h3>登录设备</h3>
        <p>令牌 7 天有效；退出设备后，那个设备需要重新登录。</p>
        <ul className="account-sessions">
          {sessions.length === 0 ? <li>没有其它设备。</li> : sessions.map((session) => <li key={session.id}>
            <span>{session.deviceLabel || '未知设备'}{session.current ? '（当前设备）' : ''}</span>
            <span className="form-hint">最近活动 {formatTime(session.lastSeenAt)}</span>
            <button type="button" className="button secondary compact" disabled={busy === session.id} onClick={() => { void revoke(session); }}>
              {session.current ? '退出登录' : '退出这个设备'}
            </button>
          </li>)}
        </ul>
        <div className="setting-actions">
          <button type="button" className="button secondary compact danger-text" disabled={busy === 'all'} onClick={() => { void logoutAll(); }}>退出全部设备</button>
        </div>
        {status ? <p className="form-hint" role="status">{status}</p> : null}
      </div>
    </div>
  </div>;
}
