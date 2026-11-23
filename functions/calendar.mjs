// 日历快照合并：从 src/domain/calendar.ts 移植，去掉 zod 依赖。

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isStamp(value) {
  return Number.isSafeInteger(value) && value >= 946684800000 && value <= 4133980800000;
}

export function reconcileCalendar(previous, input) {
  if (!input || typeof input !== 'object') fail('invalid_input', '日历内容格式不对。');
  if (typeof input.sourceId !== 'string' || !input.sourceId || input.sourceId.length > 160) fail('invalid_input', '日历来源不对。');
  if (typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 160) fail('invalid_input', '日历请求标识不对。');
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) fail('invalid_input', '日历版本不对。');
  if (!isStamp(input.rangeStart) || !isStamp(input.rangeEnd) || input.rangeEnd <= input.rangeStart) fail('invalid_input', '日历范围不对。');
  if (input.rangeEnd - input.rangeStart > 32 * 86400_000) fail('invalid_input', '日历范围过长。');
  if (!isStamp(input.fetchedAt)) fail('invalid_input', '日历时间不对。');
  if (typeof input.calendarAvailable !== 'boolean' || typeof input.complete !== 'boolean') fail('invalid_input', '日历状态不对。');
  if (!Array.isArray(input.events) || input.events.length > 5000) fail('invalid_input', '日历事件过多。');
  if (!input.calendarAvailable && input.events.length > 0) fail('invalid_input', '日历不可用时不应带事件。');

  const ids = new Set();
  for (const event of input.events) {
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id) fail('invalid_input', '日历事件格式不对。');
    if (ids.has(event.id)) fail('invalid_input', '日历事件重复。');
    ids.add(event.id);
    if (event.source !== 'calendar' || event.sourceId !== input.sourceId) fail('invalid_input', '日历事件来源不一致。');
    if (!isStamp(event.start) || !isStamp(event.end) || event.start >= input.rangeEnd || event.end <= input.rangeStart) {
      fail('invalid_input', '日历事件超出范围。');
    }
  }

  if (previous && previous.sourceId !== input.sourceId) fail('invalid_input', '日历来源不一致。');
  if ((previous?.revision ?? 0) !== input.baseRevision) fail('conflict', '日历在另一处被修改，请重试。');

  const incoming = new Set(input.events.map((event) => event.id));
  const retained = (previous?.events ?? []).filter((event) => !incoming.has(event.id)
    && !(input.calendarAvailable && input.complete && event.start < input.rangeEnd && event.end > input.rangeStart));

  return {
    sourceId: input.sourceId,
    revision: input.baseRevision + 1,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    fetchedAt: input.fetchedAt,
    calendarAvailable: input.calendarAvailable,
    complete: input.complete,
    events: [...retained, ...input.events],
  };
}