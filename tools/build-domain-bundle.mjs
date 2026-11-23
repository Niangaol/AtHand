// 把 src/domain 打包成函数包可用的自包含 ESM：zod 内联，无跨目录 import。
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outdir = resolve(root, 'functions/vendor');
mkdirSync(outdir, { recursive: true });

// 显式列出函数包需要的导出；新增依赖时同步更新。
const entry = `
export { buildDayBrief, buildWeekReview, buildLedgerInsights, buildFocusInsights, dayBriefNarrative, weekReviewNarrative } from '${resolve(root, 'src/domain/insights.ts').replace(/\\/g, '/')}';
export { buildTimeline, buildEvent, expandCourse } from '${resolve(root, 'src/domain/schedule.ts').replace(/\\/g, '/')}';
export { getCountdowns } from '${resolve(root, 'src/domain/countdowns.ts').replace(/\\/g, '/')}';
export { summarize } from '${resolve(root, 'src/domain/summary.ts').replace(/\\/g, '/')}';
export { buildRecord, buildWorkplace, parseAmount } from '${resolve(root, 'src/domain/ledger.ts').replace(/\\/g, '/')}';
export { isLedgerState } from '${resolve(root, 'src/data/storage.ts').replace(/\\/g, '/')}';
export { focusedSeconds, focusedSecondsBetween, remainingSeconds } from '${resolve(root, 'src/domain/focus.ts').replace(/\\/g, '/')}';
export { getMonthRange, getWeekRange, shiftDate, toDateKey } from '${resolve(root, 'src/domain/dates.ts').replace(/\\/g, '/')}';
export { changeTripDates, cities, newTrip } from '${resolve(root, 'src/domain/trips.ts').replace(/\\/g, '/')}';
export { expenseCategories } from '${resolve(root, 'src/domain/records.ts').replace(/\\/g, '/')}';
export { applyCommand, commandKey, createPlannerState } from '${resolve(root, 'src/domain/planner.ts').replace(/\\/g, '/')}';
export { z } from 'zod';
// canonical 只存在于函数包的 functions/planner.mjs，src/domain 无此函数；
// 在此内联同一实现，保持 bundle 的导出面与任务契约一致（不引入 planner.mjs 整图）。
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
`;

const entryFile = resolve(outdir, '.entry.ts');
writeFileSync(entryFile, entry, 'utf8');

await build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  outfile: resolve(outdir, 'domain.mjs'),
  logLevel: 'warning',
  banner: { js: '// 生成物，请勿手改。修改 src/domain 后运行 node tools/build-domain-bundle.mjs' },
});

// 中间文件会把跨目录 import 留在 functions/ 内，产物写好后立即删除。
rmSync(entryFile, { force: true });

console.log('built functions/vendor/domain.mjs');
