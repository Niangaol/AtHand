import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLocalToday } from './useLocalToday';
afterEach(() => vi.useRealTimers());
it('updates at midnight without a page reload', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T23:59:50'));
  const hook = renderHook(useLocalToday);
  expect(hook.result.current).toBe('2026-11-21');
  act(() => { vi.advanceTimersByTime(60000); });
  expect(hook.result.current).toBe('2026-11-22');
});
