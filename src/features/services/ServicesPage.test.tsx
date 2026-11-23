import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ServicesPage } from './ServicesPage';

const listMcpServices = vi.fn();

vi.mock('../../data/mcpServices', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data/mcpServices')>();
  return { ...original, listMcpServices: (...args: unknown[]) => listMcpServices(...args) };
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

it('未连接网关时说明需要本机网关，并列出全部生活服务', () => {
  render(<MemoryRouter><ServicesPage /></MemoryRouter>);
  expect(screen.getByText('还没有连接本机网关')).toBeInTheDocument();
  expect(screen.getAllByText('高德地图').length).toBeGreaterThan(0);
  expect(screen.getAllByText('华风爱科天气').length).toBeGreaterThan(0);
  expect(screen.getAllByText('滴滴').length).toBeGreaterThan(0);
  expect(screen.getAllByText('瑞幸咖啡').length).toBeGreaterThan(0);
  expect(listMcpServices).not.toHaveBeenCalled();
});

it('连接本机网关后显示实时状态，未配置不假装可用', async () => {
  localStorage.setItem('shunshou.gateway.url', 'http://127.0.0.1:18787');
  localStorage.setItem('shunshou.gateway.token', 'token');
  localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 3600_000));
  listMcpServices.mockResolvedValue([{
    name: 'amap', label: '高德地图', prefix: 'amap_', transport: 'http',
    enabled: true, configured: true, urlMasked: 'https://mcp.amap.com/mcp?key=***', headerNames: [],
    scenarios: ['map'], setup: '',
    state: { status: 'ready', message: '已连接，17 个工具。' },
  }]);
  render(<MemoryRouter><ServicesPage /></MemoryRouter>);
  expect((await screen.findAllByText('已连接')).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/已保存/).length).toBeGreaterThan(0);
  for (const label of ['高德地图', '华风爱科天气', '飞常准', '快递100', '飞猪', '滴滴', '瑞幸咖啡', '麦当劳']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
});
