import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PlannerProvider, usePlanner } from './PlannerProvider';
import { PLANNER_KEY, emptyEnvelope, enqueue } from './plannerStorage';
import { createPlannerState } from '../domain/planner';

const wrapper = ({ children }: { children: ReactNode }) => <PlannerProvider>{children}</PlannerProvider>;
beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });
it('persists local timer controls without relying on page lifetime and queues finished history', async () => {
  const first = renderHook(usePlanner, { wrapper });
  const at = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(at);
  await act(async () => { expect((await first.result.current.dispatch({ kind: 'focus.start', id: 'a', task: '数学', minutes: 1, owner: first.result.current.owner })).ok).toBe(true); });
  expect(first.result.current.state.focusSessions[0].status).toBe('running');
  first.unmount();
  const next = renderHook(usePlanner, { wrapper });
  expect(next.result.current.state.focusSessions[0].task).toBe('数学');
  await act(async () => { await next.result.current.dispatch({ kind: 'focus.control', id: 'a', action: 'takeover', owner: next.result.current.owner, epoch: 1 }); });
  vi.mocked(Date.now).mockReturnValue(at + 61_000);
  await act(async () => { expect((await next.result.current.dispatch({ kind: 'focus.control', id: 'a', action: 'complete', owner: next.result.current.owner, epoch: 2 })).ok).toBe(true); });
  expect(next.result.current.state.focusSessions[0].status).toBe('completed');
  expect(JSON.parse(localStorage.getItem(PLANNER_KEY)!).pending[0].command.kind).toBe('focus.import');
  vi.restoreAllMocks();
});
it('restores a validated backup and retains the pre-restore raw content', async () => {
  const { createPlannerState } = await import('../domain/planner');
  const hook = renderHook(usePlanner, { wrapper });
  await act(async () => { await hook.result.current.dispatch({ kind: 'preferences', focusMinutes: 30 }); });
  const before = localStorage.getItem(PLANNER_KEY);
  await act(async () => { expect((await hook.result.current.restore({ ...createPlannerState(), preferences: { focusMinutes: 45 } })).ok).toBe(true); });
  expect(hook.result.current.state.preferences.focusMinutes).toBe(45);
  expect(localStorage.getItem(`${PLANNER_KEY}.before-restore`)).toBe(before);
});
it('allows explicit validated recovery of corrupt data while keeping the original backup', async () => {
  const { createPlannerState } = await import('../domain/planner');
  localStorage.setItem(PLANNER_KEY, '{damaged original');
  const hook = renderHook(usePlanner, { wrapper });
  await act(async () => { expect((await hook.result.current.restore(createPlannerState())).ok).toBe(true); });
  expect(localStorage.getItem(`${PLANNER_KEY}.before-restore`)).toBe('{damaged original');
  expect(hook.result.current.blocked).toBe(false);
});
it('rejects an old edit after an entity changed or was deleted', async () => {
  const hook = renderHook(usePlanner, { wrapper });
  const original = { id: 'x', title: '原生日', date: '2026-11-21', kind: 'birthday' as const };
  await act(async () => { await hook.result.current.dispatch({ kind: 'put', collection: 'countdowns', value: original }); });
  await act(async () => { await hook.result.current.dispatch({ kind: 'put', collection: 'countdowns', value: { ...original, title: '另一窗口修改' } }); });
  await act(async () => { expect((await hook.result.current.dispatch({ kind: 'put', collection: 'countdowns', value: { ...original, title: '旧草稿' } }, original)).ok).toBe(false); });
  expect(hook.result.current.state.countdowns[0].title).toBe('另一窗口修改');
  await act(async () => { await hook.result.current.dispatch({ kind: 'delete', collection: 'countdowns', id: 'x' }); });
  await act(async () => { expect((await hook.result.current.dispatch({ kind: 'put', collection: 'countdowns', value: original }, original)).ok).toBe(false); });
  expect(hook.result.current.state.countdowns).toHaveLength(0);
});
it('explicitly switches server sources without sending or losing the old outbox', async () => {
  const initial = enqueue({ ...emptyEnvelope(), serverId: 'server-a', serverUrl: 'https://a.example.com' }, { kind: 'preferences', focusMinutes: 45 }, Date.now(), 'old-operation');
  localStorage.setItem(PLANNER_KEY, JSON.stringify(initial));
  const hook = renderHook(usePlanner, { wrapper });
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { requests.push(`${init.method ?? 'GET'} ${url}`); return Response.json({ state: createPlannerState(), revision: 0, serverId: url.includes('a.example') ? 'server-a' : 'server-b', entityVersions: {} }); });
  localStorage.setItem('shunshou.gateway.url', 'https://b.example.com');
  localStorage.setItem('shunshou.gateway.token', 'token');
  localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 600000));
  await act(async () => { expect((await hook.result.current.switchServer()).ok).toBe(true); });
  expect(hook.result.current.state.preferences.focusMinutes).toBe(25);
  expect(hook.result.current.pending).toBe(0);
  localStorage.setItem('shunshou.gateway.url', 'https://a.example.com');
  await act(async () => { expect((await hook.result.current.switchServer()).ok).toBe(true); });
  expect(hook.result.current.state.preferences.focusMinutes).toBe(45);
  expect(hook.result.current.pending).toBe(1);
  expect(requests.every((request) => request.startsWith('GET '))).toBe(true);
  hook.unmount(); vi.unstubAllGlobals(); localStorage.clear();
});
it('blocks editing corrupted storage without replacing it', async () => {
  localStorage.setItem(PLANNER_KEY, '{private broken backup');
  const hook = renderHook(usePlanner, { wrapper });
  expect(hook.result.current.blocked).toBe(true);
  await act(async () => { expect((await hook.result.current.dispatch({ kind: 'preferences', focusMinutes: 30 })).ok).toBe(false); });
  expect(localStorage.getItem(PLANNER_KEY)).toBe('{private broken backup');
});
