import { describe, expect, it } from 'vitest';
import { startFocus, transitionFocus, remainingSeconds, focusedSeconds, focusedSecondsBetween } from './focus';

const now = Date.parse('2026-11-21T10:00:00+08:00');

describe('focus session clock', () => {
  it('splits focused time across midnight and weekly boundaries without counting pauses', () => {
    const start = new Date('2026-11-22T23:50:00').getTime();
    let session = startFocus('night', '跨周复习', 25, start, 'a');
    session = transitionFocus(session, 'pause', start + 15 * 60000, 'a', 1);
    session = transitionFocus(session, 'resume', start + 35 * 60000, 'a', 1);
    session = transitionFocus(session, 'complete', start + 45 * 60000, 'a', 1);
    const midnight = new Date('2026-11-23T00:00:00').getTime();
    expect(focusedSecondsBetween([session], start, midnight, start + 45 * 60000)).toBe(600);
    expect(focusedSecondsBetween([session], midnight, midnight + 86400000, start + 45 * 60000)).toBe(900);
  });
  it('defaults to 25 minutes and caps elapsed time after background suspension', () => {
    const session = startFocus('one', '数学', 25, now, 'browser-a');
    expect(remainingSeconds(session, now + 60_000)).toBe(1440);
    expect(focusedSeconds(session, now + 7_200_000)).toBe(1500);
    const done = transitionFocus(session, 'complete', now + 7_200_000, 'browser-a', 1);
    expect(done.status).toBe('completed');
    expect(done.segments).toEqual([{ start: now, end: now + 1_500_000 }]);
    expect(transitionFocus(done, 'complete', now + 8_000_000, 'browser-a', 1)).toEqual(done);
  });
  it('excludes pauses and preserves remaining time across serialization', () => {
    let session = startFocus('one', '阅读', 25, now, 'a');
    session = transitionFocus(session, 'pause', now + 300_000, 'a', 1);
    expect(remainingSeconds(session, now + 3_600_000)).toBe(1200);
    session = transitionFocus(JSON.parse(JSON.stringify(session)), 'resume', now + 3_600_000, 'a', 1);
    expect(remainingSeconds(session, now + 3_660_000)).toBe(1140);
    expect(focusedSeconds(session, now + 3_660_000)).toBe(360);
  });
  it('does not complete early or accept controls from a superseded owner', () => {
    const session = startFocus('one', '阅读', 25, now, 'a');
    expect(() => transitionFocus(session, 'complete', now + 1000, 'a', 1)).toThrow();
    const taken = transitionFocus(session, 'takeover', now + 1000, 'b', 1);
    expect(taken.owner).toBe('b');
    expect(taken.epoch).toBe(2);
    expect(() => transitionFocus(taken, 'pause', now + 2000, 'a', 1)).toThrow();
    expect(transitionFocus(taken, 'cancel', now + 2000, 'b', 2).status).toBe('cancelled');
  });
  it.each([0, 181, 1.5, NaN])('rejects invalid duration %s', (minutes) => {
    expect(() => startFocus('one', '阅读', minutes, now, 'a')).toThrow();
  });
  it('does not add time when the clock moves backwards', () => {
    const session = startFocus('one', '阅读', 25, now, 'a');
    expect(remainingSeconds(session, now - 1000)).toBe(1500);
    expect(() => transitionFocus(session, 'pause', now - 1000, 'a', 1)).toThrow();
  });
});
