import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPage } from './AuthPage';
import { RecordsProvider } from '../../data/RecordsProvider';
import { gatewayUsername, isGatewayConnected } from '../../data/gateway';

const fetchMock = vi.fn();

function renderAuth(mode: 'login' | 'register', from = '/') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: mode === 'register' ? '/register' : '/login', state: { from } }]}>
      <RecordsProvider today="2026-11-23">
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/" element={<p>首页已打开</p>} />
          <Route path="/ledger" element={<p>账单页已打开</p>} />
        </Routes>
      </RecordsProvider>
    </MemoryRouter>,
  );
}

function sessionBody(username: string) {
  return {
    ok: true,
    token: 'token-'.repeat(8),
    expiresAt: Date.now() + 3600_000,
    user: { id: 'u1', username },
  };
}

function ledgerEmpty(url: string) {
  return String(url).endsWith('/api/ledger')
    ? new Response(JSON.stringify({ ok: true, ledger: null, updatedAt: null }), { status: 200 })
    : null;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('shunshou.gateway.url', 'https://shunshou-qnvq63y722x.qoder.zone/functions/v1/app');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('账号页', () => {
  it('登录前校验账号格式和密码长度', async () => {
    const user = userEvent.setup();
    renderAuth('login');
    await user.type(screen.getByLabelText('账号'), 'ab');
    await user.type(screen.getByLabelText('密码'), 'short');
    expect(screen.getByRole('button', { name: /登录/ })).toBeDisabled();
  });

  it('注册成功后写入会话并进入原页面', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(
      ledgerEmpty(String(url)) ?? new Response(JSON.stringify(sessionBody('年糕同学')), { status: 200 }),
    ));
    const user = userEvent.setup();
    renderAuth('register', '/ledger');
    await user.type(screen.getByLabelText('账号'), '年糕同学');
    await user.type(screen.getByLabelText('设置密码'), 'password123');
    await user.type(screen.getByLabelText('确认密码'), 'password123');
    await user.click(screen.getByRole('button', { name: /注册并进入/ }));
    expect(await screen.findByText('账单页已打开')).toBeInTheDocument();
    expect(isGatewayConnected()).toBe(true);
    expect(gatewayUsername()).toBe('年糕同学');
    const registerCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/register'));
    expect(JSON.parse(String(registerCall?.[1]?.body))).toEqual({ username: '年糕同学', password: 'password123' });
  });

  it('账号已存在时显示后端提示', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'username_taken', message: '这个账号已经被使用。' }), { status: 409 }));
    const user = userEvent.setup();
    renderAuth('register');
    await user.type(screen.getByLabelText('账号'), '年糕同学');
    await user.type(screen.getByLabelText('设置密码'), 'password123');
    await user.type(screen.getByLabelText('确认密码'), 'password123');
    await user.click(screen.getByRole('button', { name: /注册并进入/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('这个账号已经被使用');
    expect(isGatewayConnected()).toBe(false);
  });

  it('两次密码不一致时提交按钮不可用', async () => {
    const user = userEvent.setup();
    renderAuth('register');
    await user.type(screen.getByLabelText('账号'), '年糕同学');
    await user.type(screen.getByLabelText('设置密码'), 'password123');
    await user.type(screen.getByLabelText('确认密码'), 'password124');
    await waitFor(() => expect(screen.getByRole('button', { name: /注册并进入/ })).toBeDisabled());
  });
});