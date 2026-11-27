import type { LucideIcon } from 'lucide-react';
import { Apple, BookOpen, CalendarDays, Candy, Car, Gamepad2, Gem, Hospital, Landmark, PiggyBank, Plane, Shirt, ShoppingBasket, Soup, TrendingUp, Utensils, Wallet, Wine } from 'lucide-react';

export type CategoryStyle = { icon: LucideIcon; color: string; bg?: string };

/** 图 2：收入分类（四项内置，可自行添加与编辑）。 */
export const incomeCategories = ['工资收入', '兼职收入', '理财收入', '其他收入'] as const;
export const incomeCategoryStyles: Record<string, CategoryStyle> = {
  工资收入: { icon: Landmark, color: '#d9574f', bg: '#fdeceb' },
  兼职收入: { icon: CalendarDays, color: '#d9a12c', bg: '#fdf4dc' },
  理财收入: { icon: TrendingUp, color: '#d1699f', bg: '#fbeaf2' },
  其他收入: { icon: PiggyBank, color: '#c9a12f', bg: '#fbf3d9' },
};

const INCOME_CUSTOM_KEY = 'shunshou.weekly.incomeCategories.v1';

export function readCustomIncomeCategories(): string[] {
  try {
    const raw = window.localStorage.getItem(INCOME_CUSTOM_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0 && item.length <= 20) : [];
  } catch { return []; }
}
export function writeCustomIncomeCategories(names: readonly string[]): void {
  try { window.localStorage.setItem(INCOME_CUSTOM_KEY, JSON.stringify(names)); } catch { /* 隐私模式下只在本页生效。 */ }
}

/** 图 4：最近使用（10 类） */
export const recentCategories = ['日用品', '餐饮', '零食', '水果', '医疗', '配饰', '交通', '旅行', '娱乐', '衣服'] as const;
/** 图 4：饮食（4 类） */
export const dietCategories = ['餐饮', '水果', '零食', '饮料'] as const;
/** 原有分类，放在「更多」里，保证旧数据依旧可选 */
export const moreCategories = ['吃饭', '日用', '学习', '其他'] as const;

export const categoryStyles: Record<string, CategoryStyle> = {
  日用品: { icon: ShoppingBasket, color: '#e7a33f' },
  餐饮: { icon: Soup, color: '#e0665a' },
  零食: { icon: Candy, color: '#eeb22f' },
  水果: { icon: Apple, color: '#e2645c' },
  医疗: { icon: Hospital, color: '#d9635d' },
  配饰: { icon: Gem, color: '#8b6ce0' },
  交通: { icon: Car, color: '#7a72d8' },
  旅行: { icon: Plane, color: '#3aa6d8' },
  娱乐: { icon: Gamepad2, color: '#d75c9e' },
  衣服: { icon: Shirt, color: '#efa63f' },
  饮料: { icon: Wine, color: '#7b6fd6' },
  吃饭: { icon: Utensils, color: '#e08a4c' },
  日用: { icon: ShoppingBasket, color: '#e7a33f' },
  学习: { icon: BookOpen, color: '#4a90d9' },
  其他: { icon: Wallet, color: '#8b94a3' },
};

export function categoryParent(name: string): string {
  if ((dietCategories as readonly string[]).includes(name)) return '饮食';
  if ((moreCategories as readonly string[]).includes(name)) return '更多';
  return '日用';
}

const CUSTOM_KEY = 'shunshou.weekly.customCategories.v1';

export function readCustomCategories(): string[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0 && item.length <= 20) : [];
  } catch { return []; }
}

export function writeCustomCategories(names: readonly string[]): void {
  try { window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(names)); } catch { /* 隐私模式下只在本页生效。 */ }
}
