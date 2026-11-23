import type { PlannerEvent, Trip } from './planner.ts';
import { shiftDate } from './dates.ts';
import { zonedTimestamp } from './zoned.ts';

export type TripItem = Trip['days'][number]['items'][number];

export const tripEventId = (tripId: string, kind: 'leg' | 'stay' | 'item', id: string) => `trip:${tripId}:${kind}:${id}`;

export function isTripManaged(event: PlannerEvent): boolean {
  return event.source === 'trip';
}

export function tripItemEvents(trip: Trip, timeZone: string): PlannerEvent[] {
  return trip.days.flatMap((day) => day.items.flatMap((item) => {
    const id = tripEventId(trip.id, 'item', item.id);
    const timed = Boolean(item.startTime && item.endTime);
    return [{ id, title: item.text, kind: 'event' as const, location: item.location,
      start: timed ? zonedTimestamp(`${day.date}T${item.startTime}`, timeZone) : zonedTimestamp(`${day.date}T00:00`, timeZone),
      end: timed ? zonedTimestamp(`${day.date}T${item.endTime}`, timeZone) : zonedTimestamp(`${shiftDate(day.date, 1)}T00:00`, timeZone),
      allDay: !timed, timeZone, source: 'trip' as const, sourceId: trip.id }];
  }));
}

export function tripLegEvents(trip: Trip, timeZone: string): PlannerEvent[] {
  return trip.transport.map((leg) => {
    const arrival = leg.arriveDate || (leg.departTime && leg.arriveTime && leg.arriveTime <= leg.departTime ? shiftDate(leg.date, 1) : leg.date);
    const id = tripEventId(trip.id, 'leg', leg.id);
    const timed = Boolean(leg.departTime && leg.arriveTime);
    const start = timed ? zonedTimestamp(`${leg.date}T${leg.departTime}`, timeZone) : zonedTimestamp(`${leg.date}T00:00`, timeZone);
    const end = timed ? zonedTimestamp(`${arrival}T${leg.arriveTime}`, timeZone) : zonedTimestamp(`${shiftDate(arrival, 1)}T00:00`, timeZone);
    return { id, title: `${leg.from} → ${leg.to}`, kind: 'event', location: leg.ref || leg.from, start, end, allDay: !timed, timeZone, source: 'trip', sourceId: trip.id };
  });
}

export function tripStayEvents(trip: Trip, timeZone: string): PlannerEvent[] {
  return trip.lodging.flatMap((stay) => stay.checkOut <= stay.checkIn ? [] : [{
    id: tripEventId(trip.id, 'stay', stay.id), title: `住在 ${stay.name}`, kind: 'event' as const, location: stay.address,
    start: zonedTimestamp(`${stay.checkIn}T00:00`, timeZone), end: zonedTimestamp(`${stay.checkOut}T00:00`, timeZone),
    allDay: true, timeZone, source: 'trip' as const, sourceId: trip.id,
  }]);
}

export function tripAllEvents(trip: Trip, timeZone: string): PlannerEvent[] {
  return [...tripLegEvents(trip, timeZone), ...tripStayEvents(trip, timeZone), ...tripItemEvents(trip, timeZone)];
}

export function tripSelectedEvents(trip: Trip): PlannerEvent[] {
  const schedule = trip.schedule;
  if (!schedule) return [];
  const pick = <T extends { id: string }>(values: T[], ids: string[]) => ids.flatMap((id) => values.filter((value) => value.id === id));
  return [
    ...tripLegEvents({ ...trip, transport: pick(trip.transport, schedule.legs) } as Trip, schedule.timeZone),
    ...tripStayEvents({ ...trip, lodging: pick(trip.lodging, schedule.stays) } as Trip, schedule.timeZone),
    ...tripItemEvents({ ...trip, days: trip.days.map((day) => ({ ...day, items: pick(day.items, schedule.items) })) } as Trip, schedule.timeZone),
  ];
}

export function reconcileTripEvents(events: PlannerEvent[], trip: Trip): PlannerEvent[] {
  const wanted = tripSelectedEvents(trip);
  const wantedIds = new Set(wanted.map((event) => event.id));
  const remaining = events.filter((event) => !(event.source === 'trip' && (event.sourceId === trip.id || wantedIds.has(event.id))));
  for (const event of events) {
    if (wantedIds.has(event.id) && (event.source !== 'trip' || event.sourceId !== trip.id)) throw new Error('旅记日程标识已被其他日程占用，请改名收藏后再加入日程。');
  }
  return [...remaining, ...wanted];
}
