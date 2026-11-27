import { describe, expect, it } from 'vitest';
import { buildRecord, buildWorkplace, parseAmount, canShowTimeCost } from './ledger';

const workplace = { id: 'tea', name: '奶茶店', hourlyRateCents: 2000, description: '', source: 'manual' as const };
const base = { date: '2026-11-20', title: '', type: 'work' as const, workplaceId: 'tea', startTime: '14:00', endTime: '17:00', nextDay: false, hourlyRate: '20', duration: '', amount: '', category: '吃饭' as const };

describe('record input boundary', () => {
  it('calculates income and snapshots the unit rate', () => {
    const record = buildRecord(base, [workplace], 'w');
    expect(record).toMatchObject({ id: 'w', amountCents: 6000, durationMinutes: 180, hourlyRateCents: 2000, title: '奶茶店', source: 'manual' });
  });
  it('calculates an explicitly overnight shift', () => {
    expect(buildRecord({ ...base, startTime: '22:00', endTime: '02:00', nextDay: true }, [workplace], 'w')).toMatchObject({ durationMinutes: 240, amountCents: 8000 });
    expect(() => buildRecord({ ...base, startTime: '22:00', endTime: '02:00' }, [workplace], 'w')).toThrow('结束时间');
  });
  it('supports an adjusted paid duration and rounds income to cents', () => {
    expect(buildRecord({ ...base, hourlyRate: '18.50', duration: '35' }, [workplace], 'w')).toMatchObject({ amountCents: 1079, durationMinutes: 35 });
  });
  it.each(['0', '-1', 'Infinity', '1e3', '1.234', '999999999'])('rejects invalid amount %s', (value) => {
    expect(() => parseAmount(value)).toThrow();
  });
  it('parses decimal currency without floating point drift', () => {
    expect(parseAmount('0.29')).toBe(29);
    expect(parseAmount('12.3')).toBe(1230);
  });
  it('rejects invalid dates and missing units', () => {
    expect(() => buildRecord({ ...base, date: '2026-02-30' }, [workplace], 'w')).toThrow('日期');
    expect(() => buildRecord(base, [], 'w')).toThrow('单位');
  });
  it('builds a categorized expense with a useful default title', () => {
    expect(buildRecord({ ...base, type: 'expense', amount: '18.50', category: '吃饭' }, [], 'e')).toMatchObject({ type: 'expense', title: '吃饭', amountCents: 1850, category: '吃饭' });
  });
  it('keeps a legacy photo when an old record is edited and saved', () => {
    const photo = `data:image/jpeg;base64,${'a'.repeat(800_000)}`;
    const record = buildRecord({ ...base, type: 'expense', amount: '18.50', photos: [photo] }, [], 'e');
    expect(record.photos).toEqual([photo]);
  });
  it('validates unit names and rates', () => {
    expect(buildWorkplace(' 家教 ', '80', 'u')).toMatchObject({ name: '家教', hourlyRateCents: 8000, source: 'manual' });
    expect(() => buildWorkplace('  ', '20', 'u')).toThrow('名称');
  });
  it('unlocks the optional time comparison after three real recorded days', () => {
    const records = ['2026-11-18', '2026-11-19', '2026-11-20'].map((date) => buildRecord({ ...base, date }, [workplace], date));
    expect(canShowTimeCost(records.slice(0, 2), '2026-11-20')).toBe(false);
    expect(canShowTimeCost(records, '2026-11-20')).toBe(true);
    expect(canShowTimeCost(records.map((record) => ({ ...record, source: 'demo' as const })), '2026-11-20')).toBe(false);
    expect(canShowTimeCost(records, '2026-11-19')).toBe(false);
  });
});
