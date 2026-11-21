import { dateSchema, tripSchema, type Trip } from './planner.ts';
import { shiftDate } from './dates.ts';

function dates(start: string, end: string): string[] {
  dateSchema.parse(start); dateSchema.parse(end);
  const count = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400_000) + 1;
  if (count < 1 || count > 366) throw new Error('旅行日期需按先后顺序，最长366天。');
  return Array.from({ length: count }, (_, i) => shiftDate(start, i));
}
export function newTrip(id: string, title: string, startDate: string, endDate: string): Trip {
  return tripSchema.parse({ id, title, startDate, endDate, notes: '', packingSource: '', days: dates(startDate, endDate).map((date) => ({ date, items: [] })), packing: [], visits: [] });
}
export function changeTripDates(trip: Trip, startDate: string, endDate: string): Trip {
  const range = dates(startDate, endDate);
  const outside = (date: string) => date < startDate || date > endDate;
  if (trip.days.some((d) => outside(d.date) && d.items.length) || trip.visits.some((v) => outside(v.date))) throw new Error('范围外还有攻略或城市记录，请先调整或删除这些内容，再缩短日期。');
  return tripSchema.parse({ ...trip, startDate, endDate, days: range.map((date) => trip.days.find((d) => d.date === date) ?? { date, items: [] }) });
}
export function copyPacking(packing: Trip['packing']): Trip['packing'] {
  return packing.map((item) => ({ id: crypto.randomUUID(), text: item.text, checked: false }));
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
