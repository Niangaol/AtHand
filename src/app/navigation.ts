import { CalendarDays, Compass, GraduationCap, House, MapPin, NotebookPen, ReceiptText, Settings2, Sparkles, Store, Sun, Timer } from 'lucide-react';

export const assistantNav = { path: '/assistant', label: '助手', icon: Sparkles };

export const navigationGroups = [
  { title: '学习与节奏', items: [
    { path: '/', label: '首页', icon: House },
    { path: '/today', label: '今天', icon: Sun },
    { path: '/focus', label: '专注', icon: Timer },
    { path: '/schedule', label: '日程', icon: CalendarDays },
  ] },
  { title: '钱与时间', items: [
    { path: '/entry', label: '记一笔', icon: NotebookPen },
    { path: '/ledger', label: '周账单', icon: ReceiptText },
    { path: '/workplaces', label: '单位管理', icon: Store },
    { path: '/monthly', label: '月度汇总', icon: CalendarDays },
  ] },
  { title: '校园与远方', items: [
    { path: '/campus', label: '校园', icon: GraduationCap },
    { path: '/services', label: '生活服务', icon: Compass },
    { path: '/trips', label: '旅记', icon: MapPin },
  ] },
  { title: '数据与设置', items: [
    { path: '/settings', label: '设置', icon: Settings2 },
  ] },
];

export const navigation = [assistantNav, ...navigationGroups.flatMap((group) => group.items)];
