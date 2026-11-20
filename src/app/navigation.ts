import { CalendarDays, GraduationCap, House, NotebookPen, ReceiptText, Settings2, Store } from 'lucide-react';

export const navigation = [
  { path: '/', label: '今天', icon: House },
  { path: '/entry', label: '记一笔', icon: NotebookPen },
  { path: '/ledger', label: '周账单', icon: ReceiptText },
  { path: '/workplaces', label: '单位管理', icon: Store },
  { path: '/monthly', label: '月度汇总', icon: CalendarDays },
  { path: '/campus', label: '校园', icon: GraduationCap },
  { path: '/settings', label: '设置', icon: Settings2 },
];
