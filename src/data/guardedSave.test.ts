import { expect, it } from 'vitest';
import { guardedSave } from './guardedSave';

it('rejects a stale renderer even when its localStorage cache still reports the old value', async () => {
  const key = 'isolated-test';
  await guardedSave(key, null, () => 'first');
  let wrote = false;
  await expect(guardedSave(key, null, () => { wrote = true; return 'second'; })).rejects.toThrow(/其他窗口/);
  expect(wrote).toBe(false);
  expect(await guardedSave(key, 'first', () => 'third')).toBe('third');
});
it('does not advance the checkpoint when local writing fails', async () => {
  await expect(guardedSave('quota', null, () => { throw new Error('quota'); })).rejects.toThrow('quota');
  expect(await guardedSave('quota', null, () => 'retry')).toBe('retry');
});
