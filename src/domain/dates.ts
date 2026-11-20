export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function shiftDate(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return toDateKey(new Date(year, month - 1, day + days, 12));
}

export function getWeekRange(dateKey: string): { start: string; end: string } {
  const weekday = new Date(`${dateKey}T12:00:00`).getDay();
  const start = shiftDate(dateKey, -((weekday + 6) % 7));
  return { start, end: shiftDate(start, 6) };
}

export function getMonthRange(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '2000-01' || month > '2100-12') throw new Error('请选择 2000 至 2100 年之间的月份。');
  const [year, number] = month.split('-').map(Number);
  return { start: `${month}-01`, end: toDateKey(new Date(year, number, 0, 12)) };
}

export function shortDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  return `${Number(month)}月${Number(day)}日`;
}
