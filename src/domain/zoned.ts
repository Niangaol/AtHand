export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function zonedInput(stamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(stamp);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

export function zonedTimestamp(value: string, timeZone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('请填写完整日期和时间。');
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error('请填写有效日期。');
  let candidate = wall;
  for (let i = 0; i < 4; i++) {
    const actual = zonedInput(candidate, timeZone);
    if (actual === value) return candidate;
    candidate += wall - Date.parse(`${actual}:00Z`);
  }
  throw new Error('此时区没有这个时刻，请检查夏令时切换。');
}
