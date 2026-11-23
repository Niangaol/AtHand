import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { McpServicesPanel } from './McpServicesPanel';
import { AccountPanel } from './AccountPanel';

const listMcpServices = vi.fn();
const saveMcpService = vi.fn();
const probeMcpService = vi.fn();
const gatewayFetch = vi.fn();

vi.mock('../../data/mcpServices', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data/mcpServices')>();
  return {
    ...original,
    listMcpServices: (...args: unknown[]) => listMcpServices(...args),
    saveMcpService: (...args: unknown[]) => saveMcpService(...args),
    probeMcpService: (...args: unknown[]) => probeMcpService(...args),
  };
});

vi.mock('../../data/gateway', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data/gateway')>();
  return { ...original, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as unknown as Response;

const unconfigured = {
  name: 'amap', label: '高德地图', prefix: 'amap_', transport: 'http',
  enabled: false, configured: false, urlMasked: '', headerNames: [],
  scenarios: ['map'], setup: '到高德控制台建 Web 服务 Key。',
  state: { status: 'url_missing', message: '未配置：请先在设置页填写服务地址。' },
};

const configured = {
  ...unconfigured, enabled: true, configured: true,
  urlMasked: 'https://mcp.amap.com/mcp?key=***',
  headerNames: ['X-API-Key'],
  state: { status: 'ready', message: '已连接，17 个工具。' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

it('未连接网关时提示先连接，不读取服务列表', () => {
  render(<McpServicesPanel connected={false} cloudMode={false} />);
  expect(screen.getByText('先连接上面的本机网关，再配置生活服务。')).toBeInTheDocument();
  expect(listMcpServices).not.toHaveBeenCalled();
});

it('云端模式下提示生活服务只在本机网关可用', () => {
  render(<McpServicesPanel connected cloudMode />);
  expect(screen.getByText(/生活服务 MCP 跑在你自己电脑上的本机网关里/)).toBeInTheDocument();
  expect(listMcpServices).not.toHaveBeenCalled();
});

it('列出服务并显示「未配置」状态，保存后调用配置接口', async () => {
  listMcpServices.mockResolvedValue([unconfigured]);
  saveMcpService.mockResolvedValue({ ...configured });
  const user = userEvent.setup();
  render(<McpServicesPanel connected cloudMode={false} />);

  expect(await screen.findByText('高德地图')).toBeInTheDocument();
  expect(screen.getByText('未配置')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '配置' }));
  await user.type(screen.getByLabelText('连接地址'), 'https://mcp.amap.com/mcp?key=abc');
  await user.click(screen.getByLabelText('启用这个服务'));
  await user.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => expect(saveMcpService).toHaveBeenCalledWith('amap', expect.objectContaining({
    enabled: true,
    url: 'https://mcp.amap.com/mcp?key=abc',
  })));
  expect(await screen.findByText(/^已保存。/)).toBeInTheDocument();
});

it('测试连接成功后显示工具数量', async () => {
  listMcpServices.mockResolvedValue([configured]);
  probeMcpService.mockResolvedValue({ toolCount: 17, tools: ['amap_maps_textsearch'], message: '连接成功' });
  const user = userEvent.setup();
  render(<McpServicesPanel connected cloudMode={false} />);

  expect(await screen.findByText('已连接')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '配置' }));
  await user.click(screen.getByRole('button', { name: '测试连接' }));
  expect(await screen.findByText(/可用工具 17 个/)).toBeInTheDocument();
});

it('读取失败时显示错误，不假装服务可用', async () => {
  listMcpServices.mockRejectedValue(new Error('连不上后端，请检查网络或服务是否在运行。'));
  render(<McpServicesPanel connected cloudMode={false} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('连不上后端');
});

it('账号面板显示账号信息、数据统计与登录设备', async () => {
  gatewayFetch.mockImplementation((path: string) => {
    if (path === '/api/account') {
      return Promise.resolve(jsonResponse({
        ok: true,
        user: { id: 'u1', username: '年糕', createdAt: '2026-11-01T08:00:00Z' },
        currentSession: { id: 's1', deviceLabel: 'Chrome', createdAt: '2026-11-20T08:00:00Z', lastSeenAt: '2026-11-22T08:00:00Z', expiresAt: '2026-11-27T08:00:00Z', current: true },
        stats: { sessions: 1, ledgerRecords: 3, plannerEvents: 2, plannerRevision: 5, samples: 4, campusConnected: true },
      }, 200));
    }
    if (path === '/api/account/sessions') {
      return Promise.resolve(jsonResponse({
        ok: true, currentSessionId: 's1',
        sessions: [{ id: 's1', deviceLabel: 'Chrome', createdAt: '2026-11-20T08:00:00Z', lastSeenAt: '2026-11-22T08:00:00Z', expiresAt: '2026-11-27T08:00:00Z', current: true }],
      }, 200));
    }
    return Promise.resolve(jsonResponse({ ok: false, error: 'not_found' }, 404));
  });
  render(<AccountPanel onLoggedOut={() => undefined} />);
  expect(await screen.findByText(/当前账号：年糕/)).toBeInTheDocument();
  expect(screen.getByText(/账本记录 3 条/)).toBeInTheDocument();
  expect(screen.getByText(/Chrome（当前设备）/)).toBeInTheDocument();
});

it('修改密码会校验新密码长度和一致性', async () => {
  gatewayFetch.mockResolvedValue(jsonResponse({
    ok: true,
    user: { id: 'u1', username: '年糕', createdAt: '2026-11-01T08:00:00Z' },
    currentSession: null,
    stats: { sessions: 1, ledgerRecords: 0, plannerEvents: 0, plannerRevision: 0, samples: 0, campusConnected: false },
  }, 200));
  const user = userEvent.setup();
  render(<AccountPanel onLoggedOut={() => undefined} />);
  await screen.findByText(/当前账号/);
  await user.type(screen.getByLabelText('当前密码'), 'old-password');
  await user.type(screen.getByLabelText('新密码'), 'short');
  await user.type(screen.getByLabelText('确认新密码'), 'short');
  expect(screen.getByRole('button', { name: '更新密码' })).toBeDisabled();
});
