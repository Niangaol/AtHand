export const expenseCategories = ['吃饭', '交通', '日用', '娱乐', '学习', '其他'] as const;
export type ExpenseCategory = typeof expenseCategories[number];

type BaseRecord = {
  id: string;
  date: string;
  title: string;
  amountCents: number;
  source: 'demo' | 'manual' | 'school' | 'import';
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
