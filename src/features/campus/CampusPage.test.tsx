import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CampusProvider } from '../../data/CampusProvider';
import { PlannerProvider } from '../../data/PlannerProvider';
import { createPlannerState } from '../../domain/planner';
import { CampusPage } from './CampusPage';

const now = new Date().toISOString();
const pending = { userCode: 'ABCD1234', verificationUri: 'https://neo.hduhelp.com/authorize', verificationUriComplete: 'https://neo.hduhelp.com/authorize?user_code=ABCD1234', expiresAt: Date.now() + 600_000, interval: 5, scopes: ['academic:schedule:read'] };
const statusOff = { ok: true, connected: false, expired: false, scopes: [], patId: '', connectedAt: null, expiresAt: null, deviceName: '顺手云端', pending: null };
const statusPending = { ...statusOff, pending };
const statusOn = { ...statusOff, connected: true, scopes: ['academic:schedule:read', 'academic:grade:read', 'campuslife:electricity:write'], connectedAt: now, expiresAt: null };

const operations = [
  { id: 'AcademicService_ScheduleNow', domain: 'academic', command: 'academic schedule now', summary: '查询本人今明课程', description: '返回今明课程。', method: 'GET', path: '/hduhelp-neo/academic/schedule/now', auth: 'bearer', scopes: ['academic:schedule:read'], risk: 'read', sensitive: false, requiresUser: true, params: [], body: null },
  { id: 'AcademicService_SchoolTime', domain: 'academic', command: 'academic schooltime time', summary: '查询当前校历时间', description: '', method: 'GET', path: '/hduhelp-neo/academic/schooltime/time', auth: 'bearer', scopes: [], risk: 'read', sensitive: false, requiresUser: false, params: [], body: null },
  { id: 'AcademicService_StudentExam', domain: 'academic', command: 'academic exam', summary: '查询本人学期考试安排', description: '', method: 'GET', path: '/hduhelp-neo/academic/exam', auth: 'bearer', scopes: ['academic:grade:read'], risk: 'sensitive-read', sensitive: true, requiresUser: true, params: [], body: null },
  { id: 'AcademicService_StudentGrade', domain: 'academic', command: 'academic grade', summary: '查询本人本科成绩与绩点', description: '', method: 'GET', path: '/hduhelp-neo/academic/grade', auth: 'bearer', scopes: ['academic:grade:read'], risk: 'sensitive-read', sensitive: true, requiresUser: true, params: [], body: null },
  { id: 'AcademicService_ListChaoxingHomework', domain: 'academic', command: 'academic homework chaoxing', summary: '查询本人学习通作业', description: '', method: 'GET', path: '/hduhelp-neo/academic/homework/chaoxing', auth: 'bearer', scopes: ['academic:schedule:read'], risk: 'sensitive-read', sensitive: true, requiresUser: true, params: [], body: null },
  { id: 'AcademicService_GetClassrooms', domain: 'academic', command: 'academic classroom', summary: '获取教室列表', description: '', method: 'GET', path: '/hduhelp-neo/academic/classroom', auth: 'bearer', scopes: [], risk: 'read', sensitive: false, requiresUser: false, params: [], body: null },
  { id: 'CampusLifeService_CardBalance', domain: 'campuslife', command: 'campuslife card balance', summary: '查询校园卡余额', description: '', method: 'GET', path: '/hduhelp-neo/campuslife/card/balance', auth: 'bearer', scopes: ['academic:schedule:read'], risk: 'sensitive-read', sensitive: true, requiresUser: true, params: [], body: null },
  { id: 'CampusLifeService_CardConsume', domain: 'campuslife', command: 'campuslife card consume', summary: '查询校园卡消费流水', description: '', method: 'GET', path: '/hduhelp-neo/campuslife/card/consume', auth: 'bearer', scopes: ['academic:schedule:read'], risk: 'sensitive-read', sensitive: true, requiresUser: true, params: [], body: null },
  { id: 'CampusLifeService_ElectricBalance', domain: 'campuslife', command: 'campuslife electric balance', summary: '查询宿舍电费余额', description: '', method: 'GET', path: '/hduhelp-neo/campuslife/electric/balance', auth: 'bearer', scopes: ['academic:schedule:read'], risk: 'read', sensitive: false, requiresUser: true, params: [], body: null },
  { id: 'CampusLifeService_ElectricBinding', domain: 'campuslife', command: 'campuslife electric binding get', summary: '查询当前电表绑定信息', description: '', method: 'GET', path: '/hduhelp-neo/campuslife/electric/binding', auth: 'bearer', scopes: ['academic:schedule:read'], risk: 'read', sensitive: false, requiresUser: true, params: [], body: null },
  { id: 'CampusLifeService_ListMyActivities', domain: 'campuslife', command: 'campuslife activities mine', summary: '查询我的二课活动', description: '', method: 'GET', path: '/hduhelp-neo/campuslife/activities/mine', auth: 'bearer', scopes: ['academic:schedule:read'], risk: 'read', sensitive: false, requiresUser: true, params: [], body: null },
  { id: 'CampusLifeService_ListPopularActivities', domain: 'campuslife', command: 'campuslife activities popular', summary: '查询热门二课活动', description: '', method: 'GET', path: '/hduhelp-neo/campuslife/activities/popular', auth: 'bearer', scopes: ['academic:schedule:read'], risk: 'read', sensitive: false, requiresUser: true, params: [], body: null },
  { id: 'CampusLifeService_BindRoom', domain: 'campuslife', command: 'campuslife electric binding bind', summary: '按真实寝室绑定宿舍电表', description: '请求体使用 rooms 返回的 room_id。', method: 'PUT', path: '/hduhelp-neo/campuslife/electric/binding', auth: 'bearer', scopes: ['campuslife:electricity:write'], risk: 'write', sensitive: false, requiresUser: true, params: [], body: { contentType: 'application/json', fields: [{ name: 'room_id', required: true, type: 'integer' }] } },
];

const catalog = { ok: true, operations, scopes: ['academic:schedule:read', 'academic:grade:read', 'campuslife:electricity:write'], domains: [{ name: 'academic', label: '教务', operations: 6 }, { name: 'campuslife', label: '校园生活', operations: 7 }] };

let connected = false;
let pendingNow = false;

function stub() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/campus/status')) return Response.json(connected ? statusOn : pendingNow ? statusPending : statusOff);
    if (url.endsWith('/api/campus/catalog')) return Response.json(catalog);
    if (url.endsWith('/api/campus/auth/start')) { pendingNow = true; return Response.json({ ok: true, ...pending }); }
    if (url.endsWith('/api/campus/auth/poll')) { pendingNow = false; connected = true; return Response.json({ ...statusOn, status: 'connected' }); }
    if (url.endsWith('/api/campus/auth/cancel')) { pendingNow = false; return Response.json({ ...statusOff, status: 'cancelled' }); }
    if (url.endsWith('/api/campus/auth/logout')) { connected = false; return Response.json({ ...statusOff, status: 'logged_out' }); }
    if (url.endsWith('/api/campus/run')) {
      const body = JSON.parse(String(init?.body));
      if (body.operationId === 'AcademicService_SchoolTime') return Response.json({ ok: true, data: { weekNow: 10, schoolYear: '2026-2027', semester: '1' } });
      if (body.operationId === 'AcademicService_ScheduleNow') return Response.json({ ok: true, data: [{ name: '高等数学', startTime: '08:00', endTime: '09:40', weekday: 3, location: '六教422' }] });
      if (body.operationId === 'AcademicService_StudentExam') return Response.json({ ok: true, data: [{ course: '线性代数', date: '2099-12-20', startTime: '09:00' }] });
      if (body.operationId === 'CampusLifeService_CardBalance') return Response.json({ ok: true, data: { balanceCents: 12345, maskedNo: '****3456', recent: [{ at: '2026-11-20', amountCents: 1250, place: '一食堂' }] } });
      if (body.operationId === 'FeedService_Feed') return Response.json({ ok: true, data: { items: [] } });
      if (body.operationId === 'CampusLifeService_BindRoom') return Response.json({ ok: true, data: { room_id: body.body?.room_id } });
      return Response.json({ ok: false, error: 'mock_not_found', message: '没有模拟这个操作。' });
    }
    if (url.endsWith('/api/planner')) return Response.json({ state: createPlannerState(), revision: 0, serverId: 'test-server', entityVersions: {} });
    if (url.endsWith('/api/planner/operations')) return Response.json({ state: createPlannerState(), revision: 1, serverId: 'test-server', entityVersions: {}, appliedRevision: 1 });
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  }));
}

beforeEach(() => {
  connected = false;
  pendingNow = false;
  localStorage.setItem('shunshou.gateway.url', 'https://shunshou.example/functions/v1/app');
  localStorage.setItem('shunshou.gateway.token', 'session-token');
  localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 3600_000));
  stub();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function renderPage() {
  return render(<MemoryRouter><PlannerProvider><CampusProvider><CampusPage /></CampusProvider></PlannerProvider></MemoryRouter>);
}

it('runs the cloud device authorization and shows the campus overview', async () => {
  const user = userEvent.setup();
  renderPage();
  const start = await screen.findByRole('button', { name: /生成授权链接/ });
  await user.click(start);
  expect(await screen.findByText('ABCD1234')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /打开 HDUHelp 授权页/ })).toHaveAttribute('href', pending.verificationUriComplete);
  await user.click(screen.getByRole('button', { name: /我已确认/ }));
  expect(await screen.findByText(/校园助手已连接/)).toBeInTheDocument();
  expect(await screen.findByText('第 10 周')).toBeInTheDocument();
  expect((await screen.findAllByText(/高等数学/)).length).toBeGreaterThan(0);
  expect(await screen.findByText('¥ 123.45')).toBeInTheDocument();
});

it('opens a quick read operation and renders its result', async () => {
  const user = userEvent.setup();
  connected = true;
  renderPage();
  await screen.findByText(/校园助手已连接/);
  await user.click(await screen.findByRole('button', { name: /今明课程/ }));
  const dialog = await screen.findByRole('dialog');
  expect((await within(dialog).findAllByText(/六教422/)).length).toBeGreaterThan(0);
  expect(within(dialog).getAllByText(/高等数学/).length).toBeGreaterThan(0);
});

it('requires explicit confirmation for write operations', async () => {
  const user = userEvent.setup();
  connected = true;
  renderPage();
  await screen.findByText(/校园助手已连接/);
  await user.click(await screen.findByRole('tab', { name: /校园生活/ }));
  await user.click(await screen.findByRole('button', { name: /按真实寝室绑定宿舍电表/ }));
  await user.type(screen.getByLabelText(/room_id/), '93784');
  await user.click(screen.getByRole('button', { name: '执行' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('写操作需要先勾选确认');
  await user.click(screen.getByLabelText(/我确认执行这次写操作/));
  await user.click(screen.getByRole('button', { name: '执行' }));
  await waitFor(() => expect(screen.getByText('93784')).toBeInTheDocument());
  expect(screen.queryByRole('alert')).toBeNull();
});

it('states the cloud boundary', async () => {
  renderPage();
  expect(await screen.findByText(/PAT 只保存在云端数据库/)).toBeInTheDocument();
});