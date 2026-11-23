# 内置助手「主动简报与洞察」一期设计

日期：2026-11-23
状态：待评审
范围：一期（简报 + 周复盘 + 洞察），对话体验与规划提醒留到二、三期

## 1. 背景与目标

现有 AI 能力是「你问它答」：内置助手能调用 40 个工具，但没有主动产出。用户打开顺手，看到的只是静态数字，需要自己判断「今天怎么样、这周花得对不对、专注有没有退步」。

一期目标：

1. 首页每天自动给出「今日简报」：今天几件事、下一项是什么、花费与专注情况、临近的要紧事。
2. 「今天」页给出「本周复盘」：收支对比、分类占比、专注七日分布、日程预警。
3. 新增 4 个只读工具，让内置助手和外部 Agent 都能回答「今天简报」「这周复盘」「我花钱有什么趋势」「我的专注习惯怎么样」。
4. 模型只负责把确定性计算结果写成 3–5 句人话；模型不可用时降级为规则模板，页面永远有内容。

## 2. 非目标

- 不做流式输出、语音输入、记忆偏好（二期）。
- 不做空闲时间搜索、一句话排一周、冲突自动提醒（三期）。
- 不做通知推送（网页关闭时无法推送，电脑网关不承担推送职责）。
- 不改云端后端；云端继续只托管静态站，助手仍走电脑网关。
- 不引入新依赖。

## 3. 现状约束

- 账本、日程、专注以电脑为准；网页通过口令连接电脑网关（`local-sync/server.mjs`）。
- 云端 Qoder Sites 当前账号后端配额为 0，`/api/assistant/*` 在云端返回 503；不要尝试在云端跑模型。
- 本机推荐模型 ling-3.0-tiny:32k 为 1.3B 激活参数 MoE，算术和长推理不可靠，**所有计算必须由确定性代码完成**。
- 网关 `agentApi.mjs` 直接复用 `src/domain/*` 的纯函数（Node 24 直接加载 `.ts`），前端与网关可共用一份算法。
- 现有脱敏器 `local-sync/privacy.mjs` 的 `createRedactor()` 提供 `redactValue` / `rehydrateText`，可原样用于简报请求。
- 基线：前端单测 215/215 通过；网关测试 71/72，`agentGateway.test.mjs:152` 的 404 断言是历史问题（未知工具落到 MCP 转发返回 503），本期不修。

## 4. 架构与数据流

```
浏览器 ──GET /api/assistant/briefing?scope=day|week[&fresh=1]──▶ 电脑网关
                                                              ├─ 只读工具 day_brief / week_review 现算 facts
                                                              ├─ 模型润色（30s 超时，云端可脱敏）
                                                              └─ 未配置 / 超时 / 报错 → 规则模板 narrative
浏览器 ◀── { ok, scope, date, facts, narrative, degraded, warning: string | null, model: string | null, generatedAt }
```

双份使用、一份算法：

- `src/domain/insights.ts`：4 个纯函数 + 2 个模板 narrative 生成函数。前端直接调用即时渲染；网关工具调用同一函数。
- 前端先本地算 facts、用模板 narrative 渲染，连上电脑后再异步替换为模型润色版。断网、模型未配置都不影响首屏。

## 5. 领域层设计（src/domain/insights.ts）

全部纯函数，无 I/O，排除 `source === 'demo'` 的记录，避免示例数据污染洞察。

```ts
export type DayBrief = {
  date: string;
  items: { title: string; start: number; end: number; kind: string; location: string; source: string }[]; // 上限 12 条
  next: { title: string; start: number; kind: string } | null;
  countdowns: { title: string; date: string; days: number; kind: string }[]; // 未来 7 天内，最多 3 条
  expenseCents: number;
  workMinutes: number;
  focusMinutes: number;
  activeFocus: { task: string; remainingMinutes: number } | null;
  warnings: string[]; // 复用 scheduleWarnings 的当日结果
};

export type WeekReview = {
  start: string;
  end: string;
  thisWeek: { expenseCents: number; incomeCents: number; netCents: number; workMinutes: number; focusMinutes: number; focusSessions: number };
  lastWeek: { expenseCents: number; incomeCents: number; netCents: number; workMinutes: number; focusMinutes: number; focusSessions: number };
  categories: { category: string; cents: number; share: number }[]; // 按金额降序
  focusByDay: { date: string; minutes: number }[]; // 7 条，周一到周日
  countdowns: { title: string; date: string; days: number }[]; // 未来 7 天，最多 5 条
  warnings: string[]; // 本周 overlap / long-shift / exam-near
  topExpense: { title: string; amountCents: number; date: string } | null;
};

export type LedgerInsights = {
  range: { from: string; to: string; days: number };
  expenseCents: number;
  incomeCents: number;
  netCents: number;
  dailyAverageExpenseCents: number;
  categories: { category: string; cents: number; share: number }[];
  previousExpenseCents: number;
  deltaPct: number | null; // 上一周期为 0 时返回 null
  topExpenses: { title: string; amountCents: number; date: string; category: string }[]; // 3 条
  anomalies: { title: string; amountCents: number; date: string; reason: string }[]; // 单笔 > max(3×日均, 50 元)
};

export type FocusInsights = {
  days: number;
  totalMinutes: number;
  sessions: number;
  completedSessions: number;
  daily: { date: string; minutes: number }[];
  averagePerActiveDayMinutes: number;
  streakDays: number; // 截至今天连续有专注记录的天数
  bestDay: { date: string; minutes: number } | null;
  bySlot: { slot: '上午' | '下午' | '晚上' | '深夜'; minutes: number; share: number }[];
  topTasks: { task: string; minutes: number }[]; // 3 条
};

export function buildDayBrief(state: PlannerState, records: readonly RecordEntry[], calendars: CalendarSource[], today: string, now?: number): DayBrief;
export function buildWeekReview(state: PlannerState, records: readonly RecordEntry[], calendars: CalendarSource[], anchor: string, now?: number): WeekReview; // anchor 所在周为本周，上周为对比基线
export function buildLedgerInsights(records: readonly RecordEntry[], today: string, days?: number): LedgerInsights; // days 7–90，默认 30
export function buildFocusInsights(state: PlannerState, today: string, days?: number, now?: number): FocusInsights;

export function dayBriefNarrative(facts: DayBrief): string;   // 3–4 句规则文案
export function weekReviewNarrative(facts: WeekReview): string;
```

计算规则：

- 今日简报 `items` 用 `buildTimeline` 取当天；`next` 取 `start >= now` 的第一项。
- 专注分钟用 `focusedSecondsBetween`，区间为当天/本周/近 N 天。
- 分类占比以本周支出为分母，保留整数百分比；金额格式由调用方处理。
- 连续天数：从今天往回数，某天有任意未取消的专注记录即算一天。
- 时段划分：上午 5–12、下午 12–18、晚上 18–23、深夜 23–5，按专注时间片起点归属。
- 模板 narrative 示例：「今天 3 项安排，下一项是高等数学（14:00）。今天支出 ¥18.50，专注 50 分钟。最近 2 天是线代考试，别忘了。」空数据给出「今天还没有安排，可以先歇一会儿。」

## 6. 网关设计

### 6.1 新增 4 个只读工具（40 → 44）

| 工具 | scope | 参数 | 返回 |
| --- | --- | --- | --- |
| `day_brief` | read | `{ date?: YYYY-MM-DD }` | DayBrief |
| `week_review` | read | `{ anchor?: YYYY-MM-DD }` | WeekReview |
| `ledger_insights` | read | `{ days?: 7–90 }` | LedgerInsights |
| `focus_insights` | read | `{ days?: 7–90 }` | FocusInsights |

- 加在 `local-sync/agentApi.mjs` 的 `tools` 数组，handler 用 `snapshot()` + 对应纯函数；返回 `{ result, revision, serverId }`。
- 描述写给 1.3B 模型看：一句话、中文、说明「无参数就是今天/本周/近 30 天」。
- 内置助手 manifest 自动包含；外部 Agent 只读令牌也能调用，写令牌同样可调用。
- `docs/agent-api.md` 工具表更新为 44 个并补说明。

### 6.2 briefing()（local-sync/assistant.mjs）

`createAssistant` 新增依赖 `getBriefFacts(scope)`，由 `server.mjs` 用 `getAgentApi().call({ tool: scope === 'day' ? 'day_brief' : 'week_review', ... })` 实现。

`assistant.briefing({ scope, fresh })` 流程：

1. 算 facts（同一次请求内只算一次）。
2. 未配置模型 → 直接返回模板 narrative，`degraded: true`，`warning: '还没有配置模型，先给你规则版小结。'`。
3. `local-only` 且模型地址非本机 → 返回模板，`warning` 说明隐私模式冲突（与 chat 同规则）。
4. 云端 + `redact` 模式 → `createRedactor().redactValue(facts)` 后入 prompt，回复 `rehydrateText`。
5. 调用 `/chat/completions`：`temperature: 0.3`、`max_tokens: 400`、不带 tools、独立 30 秒超时。
6. 校验回复：去掉代码围栏与首尾空白，长度 5–600 字符，否则用模板替换并标记 degraded。
7. 成功返回 `model`、`generatedAt`；失败按矩阵降级。
8. 云端后端未部署简报端点时前端不受影响：网页本来就连电脑网关，云端只在未连接时提供静态页。

缓存：进程内 Map，key = `${scope}:${scope === 'week' ? 本周周一 : 当天}:${model}`，TTL 10 分钟，最多 50 条；`fresh=1` 跳过缓存并回写；`updateSettings` 清空缓存。数据改动后的陈旧最多持续 10 分钟，用户可用刷新按钮强制重算。

提示词要点：只根据 JSON 写 3–5 句简体中文简报；金额元、时间 HH:MM；不编造、不输出 JSON、不用列表符号；语气平稳克制。

### 6.3 路由（local-sync/server.mjs）

在现有 `/api/assistant/*` 分支内新增：

```
GET /api/assistant/briefing?scope=day|week&fresh=0|1
```

沿用 session + origin 双重校验；`scope` 非法返回 400 `invalid_scope`；`AssistantError` 映射与现有逻辑一致。

## 7. 前端设计

### 7.1 数据模块

- `src/data/briefing.ts`：zod 校验响应，`fetchBriefing(scope, { fresh })`。
- `src/data/useBriefing.ts`：`useBriefing(scope, { state, records, calendars, today })` →
  `{ facts, narrative, degraded, loading, error, refresh() }`。
  - 首帧用本地纯函数算 facts + 模板 narrative；
  - 已连接电脑时异步拉 `/api/assistant/briefing`，成功则替换 narrative/facts；
  - 未连接或失败保持本地模板，不弹错。

### 7.2 首页「今日简报」卡（src/features/home/HomePage.tsx）

- 位置：`home-glance` 之后、`home-ask` 之前。
- 内容：kicker「今日简报」+ narrative + 3–4 个要点 chip（下一项、今日支出、专注分钟、最近倒计时）+ 刷新按钮（fresh=1）+「问助手」链接。
- 区域 aria-label「今日简报」；degraded 时显示小标签「规则版」。
- 无电脑连接时也完整显示（纯本地模板），不出现错误提示。

### 7.3 「今天」页「本周复盘」面板（src/features/overview/OverviewPage.tsx）

- 位置：`overview-band` 之后、`dashboard-grid` 之前。
- 内容：narrative 置顶；四格对比（本周支出 vs 上周同期、本周专注 vs 上周同期、本周工时、净剩）；分类占比条形；专注七日迷你柱状；预警列表（复用 warnings）；刷新按钮。
- 区域 aria-label「本周复盘」。数据为空时显示空状态文案。

### 7.4 助手页快捷提示（src/features/assistant/AssistantPage.tsx）

`quickPrompts` 增加两项：

- 「今天简报」→「用 day_brief 给我今天的简报。」
- 「这周复盘」→「用 week_review 复盘我这周的花费、专注和安排。」

### 7.5 样式

在 `src/styles.css` 现有变量与卡片规范内新增 `.home-brief`、`.review-panel` 等；不引入新字体、不新增依赖。

## 8. API 契约

```json
{
  "ok": true,
  "scope": "day",
  "date": "2026-11-23",
  "facts": { "...": "DayBrief 或 WeekReview" },
  "narrative": "今天 3 项安排……",
  "degraded": false,
  "warning": null,
  "model": "ling-3.0-tiny:32k",
  "generatedAt": "2026-11-23T08:30:00.000Z"
}
```

- `warning` 仅在 degraded 时出现字符串。
- 200 以外的错误：400 `invalid_scope`、401 `unauthorized`、403 `session_required` / `origin_denied`、503 `storage_unavailable`。

## 9. 降级矩阵

| 场景 | facts | narrative | degraded | warning |
| --- | --- | --- | --- | --- |
| 未连接电脑 | 前端本地算 | 模板 | true（本地） | 无（不提示错误） |
| 已连接、模型未配置 | 网关算 | 模板 | true | 还没有配置模型 |
| 模型超时 / 报错 | 网关算 | 模板 | true | 模型没有及时回应 |
| 只在本机 + 云端地址 | 网关算 | 模板 | true | 隐私模式与本机地址不匹配 |
| 云端 + 脱敏 | 网关算 | 模型（已还原） | false | 无 |
| 正常 | 网关算 | 模型 | false | 无 |

## 10. 测试计划

单元（vitest）：

- `src/domain/insights.test.ts`：空数据、跨周边界、demo 记录剔除、峰值时段、连续天数、异常支出阈值、上周对比为 0 时 `deltaPct: null`、模板 narrative 含关键数字。

网关（node:test）：

- `local-sync/assistantBriefing.test.mjs`（假模型服务）：
  1. 正常：返回模型文案，`degraded:false`；
  2. 未配置模型：模板 + degraded；
  3. 模型 500：模板 + warning；
  4. 脱敏模式：发送内容不含原文姓名/手机号，回复占位符被还原；
  5. 缓存：连续两次只调用一次模型，`fresh=1` 再调用一次；
  6. `scope=bogus` 返回 400。

e2e：

- `e2e/home.spec.ts` 增加：未连接电脑时「今日简报」区域可见且 narrative 非空；
- 现有 assistant 用例不改动，新增快捷提示按钮不影响既有断言。

回归：`npx vitest run`、`node --test local-sync/*.test.mjs`、`npx playwright test e2e/home.spec.ts e2e/assistant.spec.ts`。

## 11. 文件清单

新增：

- `src/domain/insights.ts`
- `src/domain/insights.test.ts`
- `src/data/briefing.ts`
- `src/data/useBriefing.ts`
- `local-sync/assistantBriefing.test.mjs`

修改：

- `local-sync/agentApi.mjs`（4 个工具）
- `local-sync/assistant.mjs`（briefing、缓存、模板降级）
- `local-sync/server.mjs`（路由、getBriefFacts 注入）
- `src/features/home/HomePage.tsx`
- `src/features/overview/OverviewPage.tsx`
- `src/features/assistant/AssistantPage.tsx`
- `src/styles.css`
- `docs/agent-api.md`
- `e2e/home.spec.ts`

## 12. 风险与取舍

| 风险 | 对策 |
| --- | --- |
| 1.3B 模型润色跑偏或编造 | 只给它结构化 facts；校验长度；失败即模板；模板本身完整可读 |
| 模型响应慢拖累首屏 | 前端先本地渲染；网关 30 秒超时；10 分钟缓存 |
| 简报与页面数字不一致 | 简报 facts 与页面同源同函数，均排除 demo 记录 |
| 脱敏不彻底 | 沿用现有 redactor 与既有隐私模式规则；只在本机模式直接拒绝云端地址 |
| 工具增多让模型选择困难 | 新工具描述简短明确；系统提示第 1 条已要求先查数据 |
| 首页信息过载 | 简报卡只放 3–4 个 chip，详细内容留在「今天」页 |

## 13. 后续期次

- 二期：SSE 流式输出、语音输入、失败重试、轻量上下文记忆。
- 三期：`free_slots` 找空闲、`conflict_check` 冲突检测、「一句话排一周」、站内提醒卡。
