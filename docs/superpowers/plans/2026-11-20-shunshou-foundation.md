# 顺手应用框架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 交付可运行、可导航、能查看示例账单的校园助手前端框架，为后续真实记账提供稳定边界。

**Architecture:** React 单页应用，路由负责六个页面，共用布局和设计变量。记录使用工时/支出的联合类型，金额按整数分存储；示例数据通过单一 Provider 提供，统计为独立纯函数。此次没有写入和同步接口，不预建通用插件、权限或服务端系统。

**Tech Stack:** React、TypeScript、Vite、React Router、Lucide、CSS、Vitest、Testing Library。

**Spec:** `D:/AgentPrograms/AtHand/顺手-需求文档-通俗精简版.md`；用户追加范围为“先做框架，后期加功能”。

## Global Constraints

- 本次仅框架，不等同于第一阶段全部验收完成。
- 六个页面：今天、记一笔、周账单、单位管理、月度汇总、设置。
- 支出固定六类：吃饭、交通、日用、娱乐、学习、其他。
- 示例明确标记；不得暗示真实保存、自动同步或数据导出已实现。
- 记账数据口径为元，内部整数分；展示换算时薪默认 20 元/小时。
- 工时金额保留记录时单价快照，不由单位当前时薪反推历史记录。
- 第一轮展示工作分钟和账单，不实施“记满三天出现换算”等冷启动业务。
- 后续添加真实写入、持久化、离线同步、导出、月报，再完成原需求验收。
- 没有 Git 仓库，也未获提交授权；本次不初始化 Git、不提交。

## Review Focus

- 跨月/年和周日：自然周从本地周一到周日，不能按 UTC 偏移日期；任务 1 测试。
- 空记录：统计必须为 0，页面给出明确空态，不能出现 NaN；任务 1、2 测试。
- 数据混算：支出正数保存，收入减支出算净剩，日期范围不能混入相邻周；任务 1 测试。
- 演示与真实功能混淆：页面持续标记示例，未完成操作禁用并说明；任务 2 测试。
- 移动端和键盘导航：375px 无横向溢出、主导航可用、焦点可见；任务 3 浏览器验证。

## 文件与边界

- `package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`：开发、构建、类型与测试入口。
- `src/domain/records.ts`：RecordEntry、Workplace、ExpenseCategory 和 Summary 类型。
- `src/domain/dates.ts`：本地日期格式化、自然周范围、日期移动。
- `src/domain/summary.ts`：按日期闭区间汇总工时、收入、支出和净剩。
- `src/domain/summary.test.ts`、`src/domain/dates.test.ts`：领域行为测试。
- `src/data/demo.ts`：本周示例记录、单位；不生成学校信息或用户事实。
- `src/data/RecordsProvider.tsx`：统一只读记录入口，支持注入测试/未来真实数据。
- `src/app/App.tsx`：六页路由、未知路由恢复页面。
- `src/app/Shell.tsx`：桌面侧栏、移动导航、示例模式标记、键盘跳过导航。
- `src/app/navigation.ts`：唯一导航列表。
- `src/components/PageHeading.tsx`、`RecordList.tsx`、`SummaryCards.tsx`：小型共享展示组件。
- `src/features/overview/OverviewPage.tsx`：今天概览、本周条形图、近期示例明细、下一步模块说明。
- `src/features/ledger/LedgerPage.tsx`：只读周账单，支持前后周和类型筛选。
- `src/features/entry/EntryPage.tsx`：记工时/支出两个入口的页面结构预览，不收集真实数据。
- `src/features/workplaces/WorkplacesPage.tsx`：示例兼职单位；修改功能明确待接入。
- `src/features/monthly/MonthlyPage.tsx`：月报的清晰占位和已有周账单入口。
- `src/features/settings/SettingsPage.tsx`：只读默认设置和本次功能边界。
- `src/app/App.test.tsx`：导航、模式提示、筛选和空态测试。
- `src/test/setup.ts`：DOM 测试清理和 matcher。
- `src/styles.css`：设计变量、布局、组件和移动端规则。
- `src/main.tsx`：浏览器挂载入口。

## 视觉方向

主色松绿 #295C48，背景淡灰绿 #F5F7F4，纸面白 #FFFFFF，正文 #24382D，次要文字 #65746A，少量麦黄 #E8BD64。中文用系统苹方/微软雅黑，数字用 Segoe UI 的等宽数字；不依赖外部字体或图源。桌面为窄侧栏 + 左对齐内容；首页以“这一周”账页为主体，使用单个深绿总结区，避免把所有内容切成同等权重卡片。移动端使用横向可滚动导航和单列内容。

## Task 1: 数据边界与开发环境

**Interfaces:**
- `RecordEntry = WorkRecord | ExpenseRecord`，共同字段 `id, date, amountCents, title, source`。
- WorkRecord 额外字段 `type: 'work', workplaceId, startTime, endTime, durationMinutes, hourlyRateCents`。
- ExpenseRecord 额外字段 `type: 'expense', category: ExpenseCategory`。
- `toDateKey(date: Date): string`、`shiftDate(dateKey: string, days: number): string`、`getWeekRange(dateKey: string): {start: string; end: string}`。
- `summarize(records: readonly RecordEntry[], start: string, end: string): Summary`；Summary 为 `incomeCents, expenseCents, netCents, workMinutes`。

- [x] 创建项目配置和测试运行环境，安装依赖。
- [x] 编写失败测试：周日 2026-11-22 的范围为 11-16 至 11-22；2027-01-01 的范围为 2026-12-28 至 2027-01-03；11-30 加一天为 12-01。
- [x] 编写失败测试：60 元收入、30 元支出、180 分钟工时汇总为 6000、3000、3000、180；排除相邻周；空数组全为 0；10 分 + 20 分支出为 30 分。
- [x] 运行 `npm test -- src/domain`，确认尚未实现的模块导致失败。
- [x] 实现上述联合类型、日期函数与汇总函数。
- [x] 运行 `npm test -- src/domain`，全部通过。

## Task 2: 页面框架和可交互示例

**Interfaces:**
- `RecordsProvider({records?, workplaces?, today?, children})`：未提供时使用当前本地日期的示例数据。
- `useRecords(): { records: readonly RecordEntry[]; workplaces: readonly Workplace[]; today: string }`。
- `App(): ReactElement` 由外层 Router 和 RecordsProvider 包裹；只负责布局及路由。
- `RecordList({records})`：读取日期分组展示，空数组提供空态。
- `SummaryCards({summary})`：显示收入、支出、净剩三个金额。

- [x] 编写 App 失败测试：默认首页标记示例模式；导航周账单后筛选支出不显示工时；切换上一周出现空态，再返回本周恢复记录；记账页面不能保存；空 Provider 下数字为 0；未知地址可以返回首页。
- [x] 运行 `npm test -- src/app`，确认缺失实现失败。
- [x] 创建示例数据和 Provider，只读消费与注入，不实现持久化。
- [x] 创建中央导航、Shell、App 路由、共享展示组件和六个页面。
- [x] 实现周账单日期切换/筛选；记账页只能切换预览类型，保存按钮禁用。
- [x] 应用统一视觉样式、语义标签、焦点样式、减少动画偏好和响应式布局。
- [x] 运行 `npm test` 和 `npm run build`，全部通过。

## Task 3: 浏览器验证与交付

- [x] 启动 `npm run dev -- --host 127.0.0.1`。
- [x] 浏览器访问首页，检查示例数据、图表、明细、六页导航和浏览器返回。
- [x] 验证支出筛选、上一周空态、本周恢复、记账类型切换、未知路由恢复和刷新深链。
- [x] 验证 375px 和桌面视口，无水平溢出；检查键盘焦点和控制台错误。
- [x] 运行全量测试及生产构建，检查源文件结构与功能范围。
- [x] 告知用户预览地址、完成的框架和后续真实业务边界；不宣称同步、保存或完整 P0 已完成。

## 自审

本计划只覆盖用户追加的框架范围。原需求的 15 秒真实记账、三天冷启动、CRUD、持久化与离线同步、CSV、月报及后续校园模块明确延期，不是已实现能力。当前不需要服务端或复杂状态库，未来可以从 Provider 入口接真实数据，无需改变展示组件和纯统计函数。

## 执行结果（2026-11-20）

- 已完成六页框架、示例数据、周账单筛选和周切换；没有实现真实保存、持久化或同步。
- 验证：14 项单元/组件测试、3 项真实 Edge 浏览器测试通过；生产构建通过；npm audit 为 0 vulnerabilities。
- 实测桌面 1440px 与手机 375px，六页无水平溢出；深链刷新、返回、空周和键盘切换均通过。
- 修复：手机端路由聚焦导致标题被吸顶导航遮挡、账单小字对比度不足、缺少 favicon；对应浏览器测试先失败再通过。
- 工具调整：Vitest 升级到 5.1.1，消除已知依赖告警；外部浏览器未连接、内置窗口不可见，改用独立无头 Edge + Playwright 验证。浏览器测试现由 `npm run test:e2e` 运行，需要本机安装 Edge。
- 独立只读审查无 Critical 问题，Important 对比度问题已修复。小项暂缓：注入空兼职单位数组时的说明空态，以及只读记账预览区自身的 Tab 焦点；均不影响当前固定示例浏览，真实业务接入前应补齐。
- 当前不是 Git 仓库，未初始化、提交或发布。开发预览为 `http://127.0.0.1:5173/`。

