export const expenseCategories = ['吃饭', '交通', '日用', '娱乐', '学习', '其他', '日用品', '餐饮', '零食', '水果', '医疗', '配饰', '旅行', '衣服', '饮料'] as const;
/**
 * 分类面板允许用户自建名称，但落库的分类必须落在 expenseCategories 之内：
 * 自建名称由 buildRecord 记进备注、分类收敛到「其他」，isLedgerState 只认白名单，
 * 否则网页、Android 与云端三处共用的账本契约会被任意文本撑开。
 */
export type ExpenseCategory = string;

/**
 * 照片随账本 JSON 一起存 localStorage，并与云端 / Android 共用同一份校验：
 * 单条最多 4 张，新照片压缩后 base64 不超过 400 KB 字符（约 300 KB 原图）。
 * 历史账本可能存有更早的 1.5 MB 上限照片，读取时保留兼容；整本上传大小另由总额校验兜底。
 */
export const MAX_PHOTOS = 4;
export const MAX_PHOTO_CHARS = 400_000;
export const MAX_LEGACY_PHOTO_CHARS = 1_500_000;

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
