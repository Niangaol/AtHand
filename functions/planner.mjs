// 生活记录命令合并：从 src/domain/planner.ts 与 focus.ts 移植，去掉 zod 依赖以便随 Function 打包。

const COLLECTIONS = ['events', 'courseRules', 'countdowns', 'trips', 'serviceEntries'];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
}

export function createPlannerState() {
  return {
    version: 1,
    events: [],
    courseRules: [],
    focusSessions: [],
    countdowns: [],
    trips: [],
    serviceEntries: [],
    preferences: { focusMinutes: 25 },
    reminderReceipts: [],
  };
}

export function commandKey(command) {
  if (!command || typeof command !== 'object') fail('invalid_input', '命令格式不对。');
  if (command.kind === 'put') {
    if (!COLLECTIONS.includes(command.collection) || !command.value || typeof command.value !== 'object' || !isId(command.value.id)) {
      fail('invalid_input', '记录格式不对。');
    }
    return command.collection === 'events' ? 'events' : `${command.collection}:${command.value.id}`;
  }
  if (command.kind === 'delete') {
    if (!COLLECTIONS.includes(command.collection) || !isId(command.id)) fail('invalid_input', '删除目标不对。');
    return command.collection === 'events' ? 'events' : `${command.collection}:${command.id}`;
  }
  if (command.kind === 'events.import') return 'events';
  if (command.kind === 'focus.import') {
    if (!command.value || !isId(command.value.id)) fail('invalid_input', '专注记录格式不对。');
    return `focusHistory:${command.value.id}`;
  }
  if (command.kind.startsWith('focus.')) return 'focus';
  return command.kind === 'reminder' ? `reminder:${command.key}` : 'preferences';
}

function shiftDate(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)}`;
}
function zonedTimestamp(value, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('invalid_input', '请填写完整日期和时间。');
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== value.slice(0, 10)) fail('invalid_input', '请填写有效日期。');
  const format = (stamp) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(stamp);
    const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  };
  let candidate = wall;
  for (let i = 0; i < 4; i++) {
    const actual = format(candidate);
    if (actual === value) return candidate;
    candidate += wall - Date.parse(`${actual}:00Z`);
  }
  fail('invalid_input', '此时区没有这个时刻。');
}
function tripEvents(trip) {
  const schedule = trip.schedule;
  if (!schedule) return [];
  const timeZone = schedule.timeZone;
  if (typeof timeZone !== 'string' || !Array.isArray(schedule.legs) || !Array.isArray(schedule.stays) || !Array.isArray(schedule.items)) fail('invalid_input', '旅记日程格式不对。');
  const legs = trip.transport ?? []; const stays = trip.lodging ?? [];
  const items = (trip.days ?? []).flatMap((day) => (day.items ?? []).map((item) => ({ ...item, date: day.date })));
  const pick = (values, ids) => ids.map((id) => values.find((value) => value.id === id));
  const chosenLegs = pick(legs, schedule.legs); const chosenStays = pick(stays, schedule.stays); const chosenItems = pick(items, schedule.items);
  if ([...chosenLegs, ...chosenStays, ...chosenItems].some((value) => !value)) fail('invalid_input', '旅记日程链接的计划已不存在，请刷新后重新选择。');  const base = { kind: 'event', timeZone, source: 'trip', sourceId: trip.id };
  return [
    ...chosenLegs.map((leg) => {
      const arrival = leg.arriveDate || (leg.departTime && leg.arriveTime && leg.arriveTime <= leg.departTime ? shiftDate(leg.date, 1) : leg.date);
      const timed = Boolean(leg.departTime && leg.arriveTime);
      return { ...base, id: `trip:${trip.id}:leg:${leg.id}`, title: `${leg.from} → ${leg.to}`, location: leg.ref || leg.from,
        start: timed ? zonedTimestamp(`${leg.date}T${leg.departTime}`, timeZone) : zonedTimestamp(`${leg.date}T00:00`, timeZone),
        end: timed ? zonedTimestamp(`${arrival}T${leg.arriveTime}`, timeZone) : zonedTimestamp(`${shiftDate(arrival, 1)}T00:00`, timeZone), allDay: !timed };
    }),
    ...chosenStays.filter((stay) => stay.checkOut > stay.checkIn).map((stay) => ({ ...base, id: `trip:${trip.id}:stay:${stay.id}`, title: `住在 ${stay.name}`, location: stay.address ?? '',
      start: zonedTimestamp(`${stay.checkIn}T00:00`, timeZone), end: zonedTimestamp(`${stay.checkOut}T00:00`, timeZone), allDay: true })),
    ...chosenItems.map((item) => {
      const timed = Boolean(item.startTime && item.endTime);
      return { ...base, id: `trip:${trip.id}:item:${item.id}`, title: item.text, location: item.location ?? '',
        start: timed ? zonedTimestamp(`${item.date}T${item.startTime}`, timeZone) : zonedTimestamp(`${item.date}T00:00`, timeZone),
        end: timed ? zonedTimestamp(`${item.date}T${item.endTime}`, timeZone) : zonedTimestamp(`${shiftDate(item.date, 1)}T00:00`, timeZone), allDay: !timed };
    }),
  ];
}
function reconcileTripEvents(events, trip) {
  const wanted = tripEvents(trip);
  const wantedIds = new Set(wanted.map((event) => event.id));
  for (const event of events) {
    if (wantedIds.has(event.id) && (event.source !== 'trip' || event.sourceId !== trip.id)) fail('invalid_input', '旅记日程标识已被其他日程占用。');
  }
  return [...events.filter((event) => !(event.source === 'trip' && (event.sourceId === trip.id || wantedIds.has(event.id)))), ...wanted];
}
function validTrip(value) {
  return Boolean(value) && typeof value === 'object' && isId(value.id) && typeof value.startDate === 'string' && typeof value.endDate === 'string'
    && value.endDate >= value.startDate && Array.isArray(value.days) && Array.isArray(value.transport) && Array.isArray(value.lodging);
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function startFocus(id, task, minutes, now, owner, eventId) {
  if (!isId(id) || !isId(owner) || typeof task !== 'string' || !task.trim() || task.trim().length > 100) {
    fail('invalid_input', '请填写不超过100字的专注事项。');
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) fail('invalid_input', '专注时长需为1至180分钟的整数。');
  if (!Number.isSafeInteger(now) || now < 946684800000) fail('invalid_input', '时间无效。');
  return {
    id, task: task.trim(), minutes, startedAt: now, status: 'running',
    segments: [{ start: now, end: null }], owner, epoch: 1,
    ...(eventId ? { eventId } : {}),
  };
}

function focusedSeconds(session, now) {
  const elapsed = session.segments.reduce((sum, segment) => sum + Math.max(0, (segment.end ?? now) - segment.start), 0);
  return Math.min(session.minutes * 60, Math.floor(elapsed / 1000));
}

function transitionFocus(session, action, now, owner, epoch) {
  if (session.epoch !== epoch || (action !== 'takeover' && session.owner !== owner)) fail('invalid_input', '专注已由另一个窗口接管，请刷新。');
  if (session.status === 'completed' || session.status === 'cancelled') {
    if (action === 'complete' && session.status === 'completed') return session;
    fail('invalid_input', '这段专注已经结束。');
  }
  const last = session.segments.at(-1);
  if (!Number.isSafeInteger(now) || now < (last.end ?? last.start)) fail('invalid_input', '系统时间发生变化，请校准时间后重试。');
  if (action === 'takeover') return { ...session, owner, epoch: epoch + 1 };
  if (action === 'resume') {
    if (session.status !== 'paused') fail('invalid_input', '专注没有暂停。');
    return { ...session, status: 'running', segments: [...session.segments, { start: now, end: null }] };
  }
  const elapsed = focusedSeconds(session, now);
  if (action === 'complete' && elapsed < session.minutes * 60) fail('invalid_input', '尚未到达计划时长，可以暂停或结束本次。');
  if (action === 'pause' && session.status !== 'running') fail('invalid_input', '专注已暂停。');
  const completed = action !== 'cancel' && elapsed >= session.minutes * 60;
  const closedMillis = session.segments
    .filter((segment) => segment.end !== null)
    .reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const segments = session.segments.map((segment) => (segment.end !== null ? segment : {
    start: segment.start,
    end: Math.min(now, segment.start + session.minutes * 60_000 - closedMillis),
  }));
  return { ...session, segments, status: completed ? 'completed' : action === 'cancel' ? 'cancelled' : 'paused' };
}

export function applyCommand(state, command, now) {
  if (!state || state.version !== 1) fail('invalid_input', '生活记录版本不支持。');
  if (!command || typeof command !== 'object' || typeof command.kind !== 'string') fail('invalid_input', '命令格式不对。');
  const next = structuredClone(state);
  if (command.kind === 'put' && command.collection === 'events') {
    const value = command.value;
    if (!isId(value?.id) || value.source === 'trip') fail('invalid_input', '旅记生成的日程请在旅记里修改。');
    const index = next.events.findIndex((event) => event?.id === value.id);
    if (index >= 0 && next.events[index].source === 'trip') fail('invalid_input', '旅记生成的日程请在旅记里修改。');
    if (index === -1) next.events.push(value); else next.events[index] = value;
  } else if (command.kind === 'put' && command.collection === 'trips') {
    if (!validTrip(command.value)) fail('invalid_input', '旅记格式不对。');
    const value = command.value;
    const index = next.trips.findIndex((item) => item && item.id === value.id);
    if (index === -1) next.trips.push(value); else next.trips[index] = value;
    if (value.schedule) next.events = reconcileTripEvents(next.events, value);
  } else if (command.kind === 'put') {
    if (!COLLECTIONS.includes(command.collection) || !command.value || typeof command.value !== 'object' || !isId(command.value.id)) {
      fail('invalid_input', '记录格式不对。');
    }
    const items = next[command.collection];
    if (!Array.isArray(items)) fail('invalid_input', '记录集合不存在。');
    const index = items.findIndex((item) => item && item.id === command.value.id);
    if (index === -1) items.push(command.value); else items[index] = command.value;
  } else if (command.kind === 'delete' && command.collection === 'events') {
    const target = next.events.find((event) => event?.id === command.id);
    if (target?.source === 'trip') fail('invalid_input', '旅记生成的日程请在旅记里取消，不能直接删除。');
    next.events = next.events.filter((event) => event?.id !== command.id);
  } else if (command.kind === 'delete' && command.collection === 'trips') {
    if (!isId(command.id)) fail('invalid_input', '删除目标不对。');
    next.trips = next.trips.filter((item) => item?.id !== command.id);
    next.events = next.events.filter((event) => !(event?.source === 'trip' && event.sourceId === command.id));
  } else if (command.kind === 'delete') {
    if (!COLLECTIONS.includes(command.collection) || !isId(command.id)) fail('invalid_input', '删除目标不对。');
    const items = next[command.collection];
    if (!Array.isArray(items)) fail('invalid_input', '记录集合不存在。');
    next[command.collection] = items.filter((item) => !item || item.id !== command.id);
  } else if (command.kind === 'events.import') {
    if (!isId(command.sourceId) || !Array.isArray(command.events)) fail('invalid_input', '导入内容不对。');
    const incomingIds = new Set(command.events.map((event) => event?.id));
    if (state.events.some((event) => incomingIds.has(event.id) && (event.source !== 'ics' || event.sourceId !== command.sourceId))) {
      fail('invalid_input', '导入记录标识与其他来源冲突。');
    }
    next.events = [
      ...state.events.filter((event) => !incomingIds.has(event.id)
        && !(command.complete && event.source === 'ics' && event.sourceId === command.sourceId && event.start < command.to && event.end > command.from)),
      ...command.events,
    ];
  } else if (command.kind === 'focus.import') {
    const value = command.value;
    if (!value || !isId(value.id) || !['completed', 'cancelled'].includes(value.status)) fail('invalid_input', '导入的专注记录不对。');
    if (next.focusSessions.some((session) => session.id === value.id)) fail('invalid_input', '专注记录已存在。');
    next.focusSessions.push(value);
  } else if (command.kind === 'focus.start') {
    if (next.focusSessions.some((session) => session.status === 'running' || session.status === 'paused')) fail('invalid_input', '已有进行中的专注，请先完成或结束。');
    if (next.focusSessions.some((session) => session.id === command.id)) fail('invalid_input', '专注记录已存在。');
    if (command.eventId) {
      const linked = next.events.find((event) => event.id === command.eventId);
      if (!linked) fail('invalid_input', '要开始专注的日程已不存在。');
      if (linked.source !== 'manual') fail('invalid_input', '只能从手动日程开始专注。');
    }
    next.focusSessions.push(startFocus(command.id, command.task, command.minutes, now, command.owner, command.eventId));
    next.preferences.focusMinutes = command.minutes;
  } else if (command.kind === 'focus.control') {
    const index = next.focusSessions.findIndex((session) => session.id === command.id);
    if (index < 0) fail('invalid_input', '专注记录不存在。');
    if (!['pause', 'resume', 'complete', 'cancel', 'takeover'].includes(command.action)) fail('invalid_input', '专注操作不支持。');
    next.focusSessions[index] = transitionFocus(next.focusSessions[index], command.action, now, command.owner, command.epoch);
  } else if (command.kind === 'preferences') {
    if (!Number.isInteger(command.focusMinutes) || command.focusMinutes < 1 || command.focusMinutes > 180) fail('invalid_input', '专注时长不对。');
    next.preferences.focusMinutes = command.focusMinutes;
  } else if (command.kind === 'reminder') {
    if (typeof command.key !== 'string' || !command.key || command.key.length > 100) fail('invalid_input', '提醒标识不对。');
    if (!next.reminderReceipts.includes(command.key)) next.reminderReceipts.push(command.key);
  } else {
    fail('invalid_input', '命令类型不支持。');
  }
  return next;
}