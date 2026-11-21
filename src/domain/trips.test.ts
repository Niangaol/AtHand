import { describe, expect, it } from 'vitest';
import { tripSchema } from './planner';
import { changeTripDates, copyPacking, cityVisits, newTrip } from './trips';

describe('trip planning and confirmed footprint', () => {
  it('rejects out-of-range city dates and duplicate nested identities', () => {
    const trip = newTrip('a', '记录', '2026-11-01', '2026-11-03');
    trip.visits.push({ id: 'v', cityId: 'a', city: '杭州', date: '2026-11-04', latitude: 30, longitude: 120, visited: false });
    expect(tripSchema.safeParse(trip).success).toBe(false);
    trip.visits = [];
    trip.packing = [{ id: 'p', text: '一', checked: false }, { id: 'p', text: '二', checked: false }];
    expect(tripSchema.safeParse(trip).success).toBe(false);
  });
  it('creates natural-day itineraries across years and rejects reversed or excessive ranges', () => {
    expect(newTrip('a', '跨年', '2026-12-31', '2027-01-02').days.map((v) => v.date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
    expect(() => newTrip('a', '错', '2026-12-31', '2026-12-01')).toThrow();
    expect(() => newTrip('a', '太长', '2026-01-01', '2028-01-01')).toThrow();
  });
  it('does not silently discard itinerary or visit records when shortening dates', () => {
    const trip = newTrip('a', '假日', '2026-11-21', '2026-11-23');
    trip.days[2].items.push({ id: 'item', text: '已订门票' });
    expect(() => changeTripDates(trip, '2026-11-21', '2026-11-22')).toThrow(/范围外/);
    expect(changeTripDates(trip, '2026-11-20', '2026-11-23').days[3].items[0].text).toBe('已订门票');
  });
  it('copies packing items with fresh identity, reset checks, and no shared mutable state', () => {
    const original = [{ id: 'a', text: '充电器', checked: true }];
    const copy = copyPacking(original);
    expect(copy[0]).toMatchObject({ text: '充电器', checked: false });
    expect(copy[0].id).not.toBe('a');
    copy[0].text = '雨伞';
    expect(original[0].text).toBe('充电器');
  });
  it('counts confirmed past visits only, keeps same-name cities separate, and recomputes deletions', () => {
    const trip = newTrip('a', '回忆', '2026-11-01', '2026-11-30');
    trip.visits = [
      { id: 'one', cityId: 'cn:hz', city: '杭州', date: '2026-11-02', latitude: 30.27, longitude: 120.15, visited: true },
      { id: 'two', cityId: 'cn:hz', city: '杭州', date: '2026-11-05', latitude: 30.27, longitude: 120.15, visited: true },
      { id: 'plan', cityId: 'cn:hz', city: '杭州', date: '2026-11-20', latitude: 30.27, longitude: 120.15, visited: false },
      { id: 'other', cityId: 'other:hz', city: '杭州', date: '2026-11-03', latitude: 31, longitude: 121, visited: true },
      { id: 'future', cityId: 'cn:hz', city: '杭州', date: '2026-11-30', latitude: 30.27, longitude: 120.15, visited: true },
    ];
    expect(cityVisits([trip], '2026-11-21').find((v) => v.cityId === 'cn:hz')).toMatchObject({ count: 2, latest: '2026-11-05' });
    expect(cityVisits([trip], '2026-11-21')).toHaveLength(2);
    trip.visits = trip.visits.filter((v) => v.id !== 'two');
    expect(cityVisits([trip], '2026-11-21').find((v) => v.cityId === 'cn:hz')?.count).toBe(1);
    expect(cityVisits([], '2026-11-21')).toHaveLength(0);
  });
});
