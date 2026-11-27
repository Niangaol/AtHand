/** 周账单月历用到的农历与节气标注（与图 1 设计稿一致）。 */
const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { dateStyle: 'full' });

/** 二十四节气的常用公历日期，节气当天优先于农历显示。 */
const solarTerms: Record<string, string> = {
  '1-5': '小寒', '1-20': '大寒', '2-4': '立春', '2-19': '雨水',
  '3-5': '惊蛰', '3-20': '春分', '4-5': '清明', '4-20': '谷雨',
  '5-5': '立夏', '5-21': '小满', '6-6': '芒种', '6-21': '夏至',
  '7-7': '小暑', '7-23': '大暑', '8-7': '立秋', '8-23': '处暑',
  '9-7': '白露', '9-23': '秋分', '10-8': '寒露', '10-23': '霜降',
  '11-7': '立冬', '11-22': '小雪', '12-7': '大雪', '12-22': '冬至',
};

/** 返回格子下方的小字：节气 / 农历月名（初一）/ 农历日。 */
export function calendarSub(date: Date): { text: string; term: boolean } {
  const term = solarTerms[`${date.getMonth() + 1}-${date.getDate()}`];
  if (term) return { text: term, term: true };
  const parts = lunarFormatter.formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  if (day.startsWith('初一') || day === '初一') return { text: month, term: false };
  return { text: day.replace(/日$/, ''), term: false };
}

/** 生成月历格子：从周一开始，前后补齐相邻月份的灰色日期。 */
export function monthCells(year: number, month: number): { key: string; date: Date; out: boolean }[] {
  const first = new Date(year, month - 1, 1, 12);
  const leading = (first.getDay() + 6) % 7;
  const cells: { key: string; date: Date; out: boolean }[] = [];
  const toKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(year, month - 1, 1 - leading + index, 12);
    cells.push({ key: toKey(date), date, out: date.getMonth() !== month - 1 });
  }
  return cells;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(year, number - 1 + delta, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
