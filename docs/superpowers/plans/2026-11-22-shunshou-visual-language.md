# 顺手 · 视觉重做实施计划（纸与墨 + 双轨账本柱）

> 供执行者按任务推进。设计依据见 `docs/superpowers/specs/2026-11-22-shunshou-visual-language-design.md`。

**Goal:** 把顺手 Web 前端换成「纸与墨」设计语言，并把 `/today` 周收支图重做成双轨账本柱；文案/路由/aria/test id 不变，测试与构建全绿。

**Architecture:** `src/styles.css` 整体重写为令牌 + 基础件 + 外壳 + 各页；图表单独放 `src/styles/chart.css`（`main.tsx` 在 `styles.css` 之后 import，因此可覆盖面板内部）。图表几何抽成纯函数 `src/domain/chart.ts`，组件 `src/features/overview/WeeklyChart.tsx` 只负责渲染。

**Tech Stack:** Vite 7、React 19、TypeScript 5.9、vitest 5（jsdom）、Playwright（msedge）、lucide-react。

## 全局约束

- 零新依赖；无外部字体/图片/CDN。
- 不改现有文案、路由、`aria-label`、region 名称、`data-testid`；唯一新增文案：图表 `<details>` 的「看这周的数字」。
- 颜色/字号/间距只用 `src/styles.css` `:root` 里的令牌；`chart.css` 只允许用令牌，不允许新增色值。
- 全站最小可见字号 11px；文字对比度 ≥ 4.5:1；键盘焦点可见；`prefers-reduced-motion` 下无动画。
- 不改 `package.json`、`vite.config.ts`、`playwright.config.ts`、`android/`、`local-sync/`；不 `git commit`。

## 任务

### Task 1 基础层与外壳（已完成）

**Files:** `src/styles.css`（重写）、`src/main.tsx`（import chart.css）、`index.html`（theme-color `#f4efe2`）、`public/favicon.svg`（朱砂印章）

- [x] 令牌区（纸/墨/色/字/距/形/动）
- [x] 基础件：按钮、图标按钮、分段器、提示、错误、面板、空态便利贴、`.num`、`.hl`、`.sr-only`
- [x] 外壳：纸底侧栏、朱砂方印品牌、便利贴 AI 入口、导航选中 tab、吸顶顶栏、页脚
- [x] 表单、账本行、合计双线、确认弹窗
- [x] 首页、今天、周账单、记一笔、单位、月度、设置、校园、日程、专注、助手、404 的版式
- [x] 响应式 1200/1150/900/760/640 + 减弱动效

### Task 2 图表（并行 worker）

**Files:** `src/domain/chart.ts`、`chart.test.ts`、`src/features/overview/WeeklyChart.tsx`、`WeeklyChart.test.tsx`、`OverviewPage.tsx`、`src/styles/chart.css`、`e2e/chart.spec.ts`

- [ ] `niceCeiling` / `formatYuanShort` / `buildWeekChart` 纯函数 + 单测（0 周、1 分、千万级、不足 7 天）
- [ ] 双轨柱、基线、刻度、今日标记、直标、明细卡、键盘读点
- [ ] `figure` + 图注 + `<details>` 真表格
- [ ] 接入 `OverviewPage`，保留面板标题/图例/页脚/链接 aria
- [ ] `e2e/chart.spec.ts`：悬停、键盘、表格行数、375px、截图

**Verify:** `npx vitest run src/domain/chart.test.ts src/features/overview/WeeklyChart.test.tsx`

### Task 3 排版与截图验收（并行 worker）

**Files:** `e2e/typography.spec.ts`、`tools/screenshots.mjs`

- [ ] 最小字号 / serif 标题 / 375px 溢出 / 对比度断言
- [ ] 12 路由 × 1440/375 截图脚本（不自起 server）

### Task 5 去 AI 味 + 排版（第 2 版，已完成）

- [x] 去掉暖米纸/赭红/胶带/荧光笔/衬线大标题的 AI 套路，改冷白纸 + 墨 + 墨绿/印泥红
- [x] 中文标题用思源宋体、界面用思源黑体、金额用宋体数字；字距与行高按级差写死
- [x] 数据区去卡片化（1px 分段），四个入口改成表格格，空态左对齐
- [x] 侧栏改为导航区滚动、便签与资料常驻；去掉 sparkles 图标与胶囊标签

### Task 4 收尾（lead）

- [x] 清残余 hex（21 个，集中在令牌区）
- [x] `npx vitest run`（37 文件 / 187 条）、`npm run build`、`npx playwright test`（50 条）
- [x] 逐页截图复查 + 修形
- [x] `git diff --stat` 汇总，不提交

## Review Focus（最容易翻车的五处）

1. 字号整体放大后 375px 横向溢出（长标题、周选择器、账本行、助手输入框）。
2. 旧规则删除后某页失去布局（`.entry-layout`、`campus-layout`、`assistant-workspace`、`schedule-week`）。
3. 图表刻度除法与 0 周（NaN、负高度、柱高溢出半轴）。
4. 对比度：`--muted` 用在小字上时必须在纸底与白纸都 ≥ 4.5:1。
5. 便利贴胶带用伪元素实现，不得影响点击区域与键盘焦点。
