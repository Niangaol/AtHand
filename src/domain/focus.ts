export type FocusSegment = { start: number; end: number | null };
export type FocusSession = {
  id: string; task: string; minutes: number; startedAt: number;
  status: 'running' | 'paused' | 'completed' | 'cancelled';
  segments: FocusSegment[]; owner: string; epoch: number; eventId?: string;
};
export type FocusAction = 'pause' | 'resume' | 'complete' | 'cancel' | 'takeover';

export function startFocus(id: string, task: string, minutes: number, now: number, owner: string, eventId?: string): FocusSession {
  if (!id || !owner || !task.trim() || task.trim().length > 100) throw new Error('请填写不超过100字的专注事项。');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw new Error('专注时长需为1至180分钟的整数。');
  if (!Number.isSafeInteger(now) || now < 946684800000) throw new Error('时间无效。');
  return { id, task: task.trim(), minutes, startedAt: now, status: 'running', segments: [{ start: now, end: null }], owner, epoch: 1, ...(eventId ? { eventId } : {}) };
}

export function focusedSeconds(session: FocusSession, now: number): number {
  const elapsed = session.segments.reduce((sum, segment) => sum + Math.max(0, (segment.end ?? now) - segment.start), 0);
  return Math.min(session.minutes * 60, Math.floor(elapsed / 1000));
}

export function focusedSecondsBetween(sessions: FocusSession[], from: number, to: number, now: number): number {
  let total = 0;
  for (const session of sessions) {
    let available = session.minutes * 60000;
    for (const segment of session.segments) {
      const end = Math.min(segment.end ?? now, segment.start + available);
      available -= Math.max(0, end - segment.start);
      total += Math.max(0, Math.min(end, to) - Math.max(segment.start, from));
    }
  }
  return Math.floor(total / 1000);
}

export function remainingSeconds(session: FocusSession, now: number): number {
  return session.minutes * 60 - focusedSeconds(session, now);
}

export function transitionFocus(session: FocusSession, action: FocusAction, now: number, owner: string, epoch: number): FocusSession {
  if (session.epoch !== epoch || (action !== 'takeover' && session.owner !== owner)) throw new Error('专注已由另一个窗口接管，请刷新。');
  if (session.status === 'completed' || session.status === 'cancelled') {
    if (action === 'complete' && session.status === 'completed') return session;
    throw new Error('这段专注已经结束。');
  }
  const last = session.segments.at(-1)!;
  if (!Number.isSafeInteger(now) || now < (last.end ?? last.start)) throw new Error('系统时间发生变化，请校准时间后重试。');
  if (action === 'takeover') return { ...session, owner, epoch: epoch + 1 };
  if (action === 'resume') {
    if (session.status !== 'paused') throw new Error('专注没有暂停。');
    return { ...session, status: 'running', segments: [...session.segments, { start: now, end: null }] };
  }
  const elapsed = focusedSeconds(session, now);
  if (action === 'complete' && elapsed < session.minutes * 60) throw new Error('尚未到达计划时长，可以暂停或结束本次。');
  if (action === 'pause' && session.status !== 'running') throw new Error('专注已暂停。');
  const completed = action !== 'cancel' && elapsed >= session.minutes * 60;
  const closedMillis = session.segments.filter((segment) => segment.end !== null).reduce((sum, segment) => sum + segment.end! - segment.start, 0);
  const segments = session.segments.map((segment) => segment.end !== null ? segment : {
    start: segment.start, end: Math.min(now, segment.start + session.minutes * 60_000 - closedMillis),
  });
  return { ...session, segments, status: completed ? 'completed' : action === 'cancel' ? 'cancelled' : 'paused' };
}
