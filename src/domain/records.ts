export const expenseCategories = ['吃饭', '交通', '日用', '娱乐', '学习', '其他', '日用品', '餐饮', '零食', '水果', '医疗', '配饰', '旅行', '衣服', '饮料'] as const;
/** 内置分类 + 用户自建分类（周账单的分类面板可添加自定义名称）。 */
export type ExpenseCategory = string;

type BaseRecord = {
  id: string;
  date: string;
  title: string;
  amountCents: number;
  source: 'demo' | 'manual' | 'school' | 'import';
  photos?: string[];
};

export type WorkRecord = BaseRecord & {
  type: 'work';
  workplaceId: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  hourlyRateCents: number;
};

export type ExpenseRecord = BaseRecord & {
  type: 'expense';
  category: ExpenseCategory;
};

export type RecordEntry = WorkRecord | ExpenseRecord;
export type Workplace = { id: string; name: string; hourlyRateCents: number; description: string; source: 'demo' | 'manual' };
export type LedgerState = { version: 1; records: RecordEntry[]; workplaces: Workplace[]; settings: { hourlyRateCents: number } };
export type Summary = { incomeCents: number; expenseCents: number; netCents: number; workMinutes: number };
