import { dateSchema, tripSchema, type Trip } from './planner.ts';
import { shiftDate } from './dates.ts';

function dates(start: string, end: string): string[] {
  dateSchema.parse(start); dateSchema.parse(end);
  const count = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400_000) + 1;
  if (count < 1 || count > 366) throw new Error('旅行日期需按先后顺序，最长366天。');
  return Array.from({ length: count }, (_, i) => shiftDate(start, i));
}

export function tripRangeProblems(trip: Trip, startDate: string, endDate: string): string[] {
  const outside = (date: string) => date < startDate || date > endDate;
  const problems: string[] = [];
  const dayItems = trip.days.filter((day) => outside(day.date) && day.items.length);
  if (dayItems.length) problems.push(`攻略：${dayItems.map((day) => day.date).join('、')}`);
  const legs = trip.transport.filter((leg) => outside(leg.date) || (Boolean(leg.arriveDate) && outside(leg.arriveDate)));
  if (legs.length) problems.push(`交通：${legs.map((leg) => `${leg.from} → ${leg.to}（${leg.date}${leg.arriveDate ? ` 至 ${leg.arriveDate}` : ''}）`).join('、')}`);
  const stays = trip.lodging.filter((stay) => outside(stay.checkIn) || outside(stay.checkOut));
  if (stays.length) problems.push(`住宿：${stays.map((stay) => `${stay.name}（${stay.checkIn} 至 ${stay.checkOut}）`).join('、')}`);
  const visits = trip.visits.filter((visit) => outside(visit.date));
  if (visits.length) problems.push(`城市：${visits.map((visit) => `${visit.city} ${visit.date}`).join('、')}`);
  return problems;
}

export function newTrip(id: string, title: string, startDate: string, endDate: string): Trip {
  return tripSchema.parse({ id, title, startDate, endDate, notes: '', packingSource: '', days: dates(startDate, endDate).map((date) => ({ date, items: [] })), packing: [], visits: [] });
}

export function changeTripDates(trip: Trip, startDate: string, endDate: string): Trip {
  const range = dates(startDate, endDate);
  const problems = tripRangeProblems(trip, startDate, endDate);
  if (problems.length) throw new Error(`范围外还有安排，请先调整或删除：${problems.join('；')}。`);
  return tripSchema.parse({ ...trip, startDate, endDate, days: range.map((date) => trip.days.find((d) => d.date === date) ?? { date, items: [] }) });
}

export function shiftTripDates(trip: Trip, startDate: string, endDate: string): Trip {
  const range = dates(startDate, endDate);
  const offset = Math.round((Date.parse(`${startDate}T00:00:00Z`) - Date.parse(`${trip.startDate}T00:00:00Z`)) / 86400_000);
  const moved = (date: string) => (date < trip.startDate || date > trip.endDate ? date : shiftDate(date, offset));
  const days = trip.days.map((day) => ({ ...day, date: moved(day.date) }));
  const shifted = {
    ...trip, startDate, endDate,
    days: range.map((date) => days.find((day) => day.date === date) ?? { date, items: [] }),
    transport: trip.transport.map((leg) => ({ ...leg, date: moved(leg.date), arriveDate: moved(leg.arriveDate) })),
    lodging: trip.lodging.map((stay) => ({ ...stay, checkIn: moved(stay.checkIn), checkOut: moved(stay.checkOut) })),
    visits: trip.visits.map((visit) => ({ ...visit, date: moved(visit.date) })),
  };
  const problems = tripRangeProblems(shifted, startDate, endDate);
  if (problems.length) throw new Error(`顺延后仍有安排超范围：${problems.join('；')}。`);
  return tripSchema.parse(shifted);
}

export function copyPacking(packing: Trip['packing']): Trip['packing'] {
  return packing.map((item) => ({ id: crypto.randomUUID(), text: item.text, checked: false }));
}

function unlink(trip: Trip, kind: 'legs' | 'stays' | 'items', id: string): Trip {
  if (!trip.schedule) return trip;
  return { ...trip, schedule: { ...trip.schedule, [kind]: trip.schedule[kind].filter((value) => value !== id) } };
}

export function removeTripLeg(trip: Trip, id: string): Trip {
  return unlink({ ...trip, transport: trip.transport.filter((leg) => leg.id !== id) }, 'legs', id);
}

export function removeTripStay(trip: Trip, id: string): Trip {
  return unlink({ ...trip, lodging: trip.lodging.filter((stay) => stay.id !== id) }, 'stays', id);
}

export function removeTripItem(trip: Trip, itemId: string): Trip {
  return unlink({ ...trip, days: trip.days.map((day) => ({ ...day, items: day.items.filter((item) => item.id !== itemId) })) }, 'items', itemId);
}

export function moveTripItem(trip: Trip, from: string, itemId: string, to: string): Trip {
  const item = trip.days.find((day) => day.date === from)?.items.find((value) => value.id === itemId);
  if (!item || !trip.days.some((day) => day.date === to)) throw new Error('要移动的攻略或目标日期不存在。');
  return tripSchema.parse({
    ...trip,
    days: trip.days.map((day) => day.date === from ? { ...day, items: day.items.filter((value) => value.id !== itemId) }
      : day.date === to ? { ...day, items: [...day.items, item] } : day),
  });
}

export type CityFootprint = { cityId: string; city: string; latitude: number; longitude: number; count: number; latest: string; visits: { tripId: string; tripTitle: string; visitId: string; date: string }[] };
export function cityVisits(trips: Trip[], today: string): CityFootprint[] {
  const cities = new Map<string, CityFootprint>();
  for (const trip of trips) for (const visit of trip.visits) {
    if (!visit.visited || visit.date > today) continue;
    const city = cities.get(visit.cityId) ?? { cityId: visit.cityId, city: visit.city, latitude: visit.latitude, longitude: visit.longitude, count: 0, latest: visit.date, visits: [] };
    city.count++;
    if (visit.date > city.latest) city.latest = visit.date;
    city.visits.push({ tripId: trip.id, tripTitle: trip.title, visitId: visit.id, date: visit.date });
    cities.set(city.cityId, city);
  }
  return [...cities.values()].sort((a, b) => b.latest.localeCompare(a.latest) || a.cityId.localeCompare(b.cityId));
}

export const cities = [
  { id: 'cn:hangzhou', name: '杭州', latitude: 30.2741, longitude: 120.1551 },
  { id: 'cn:shanghai', name: '上海', latitude: 31.2304, longitude: 121.4737 },
  { id: 'cn:beijing', name: '北京', latitude: 39.9042, longitude: 116.4074 },
  { id: 'cn:nanjing', name: '南京', latitude: 32.0603, longitude: 118.7969 },
  { id: 'cn:suzhou', name: '苏州', latitude: 31.2989, longitude: 120.5853 },
  { id: 'cn:chengdu', name: '成都', latitude: 30.5728, longitude: 104.0668 },
  { id: 'cn:guangzhou', name: '广州', latitude: 23.1291, longitude: 113.2644 },
  { id: 'cn:xian', name: '西安', latitude: 34.3416, longitude: 108.9398 },
];
