import { getWeekRange, shiftDate } from '../domain/dates.ts';
import type { RecordEntry, Workplace } from '../domain/records.ts';

export const demoWorkplaces: Workplace[] = [
  { id: 'tea', name: '校园奶茶店', hourlyRateCents: 2000, source: 'demo', description: '课后的几个小时，也有自己的收获。' },
  { id: 'tutor', name: '周末家教', hourlyRateCents: 4000, source: 'demo', description: '把学到的知识，变成另一份积累。' },
];

export function createDemoRecords(today: string): RecordEntry[] {
  const { start } = getWeekRange(today);
  const dateAt = (offset: number) => {
    const date = shiftDate(start, offset);
    return date > today ? today : date;
  };
  return [
    { id: 'demo-work-1', type: 'work', date: start, title: '奶茶店排班', amountCents: 8000, source: 'demo', workplaceId: 'tea', startTime: '14:00', endTime: '18:00', durationMinutes: 240, hourlyRateCents: 2000 },
    { id: 'demo-work-2', type: 'work', date: dateAt(2), title: '数学家教', amountCents: 8000, source: 'demo', workplaceId: 'tutor', startTime: '18:00', endTime: '20:00', durationMinutes: 120, hourlyRateCents: 4000 },
    { id: 'demo-work-3', type: 'work', date: today, title: '奶茶店排班', amountCents: 6000, source: 'demo', workplaceId: 'tea', startTime: '14:00', endTime: '17:00', durationMinutes: 180, hourlyRateCents: 2000 },
    { id: 'demo-expense-1', type: 'expense', date: start, title: '食堂晚饭', amountCents: 1600, source: 'demo', category: '吃饭' },
    { id: 'demo-expense-2', type: 'expense', date: dateAt(1), title: '通勤地铁', amountCents: 800, source: 'demo', category: '交通' },
    { id: 'demo-expense-3', type: 'expense', date: dateAt(2), title: '笔记本和文具', amountCents: 2450, source: 'demo', category: '学习' },
    { id: 'demo-expense-4', type: 'expense', date: dateAt(3), title: '和朋友喝咖啡', amountCents: 2200, source: 'demo', category: '娱乐' },
    { id: 'demo-expense-5', type: 'expense', date: today, title: '食堂午饭', amountCents: 1800, source: 'demo', category: '吃饭' },
    { id: 'demo-expense-6', type: 'expense', date: today, title: '日用品补充', amountCents: 1200, source: 'demo', category: '日用' },
  ];
}
