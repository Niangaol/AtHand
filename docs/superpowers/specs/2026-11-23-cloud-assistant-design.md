# 云端内置助手设计

日期：2026-11-23
状态：待评审
范围：把网页 AI 从「只有电脑网关能跑」升级为「云端账号自带完整助手」

## 1. 背景与目标

现在网页在云端账号模式下**完全没有 AI**：[functions/routes.mjs:336](file:///D:/AgentPrograms/AtHand/functions/routes.mjs#L336) 对 `/api/assistant/*` 硬编码返回 503，前端因此隐藏了模型配置、对话和简报入口。用户必须开着电脑跑 `npm run sync` 才能用 AI。

目标：

1. 云端后端实现完整的 `/api/assistant/*`：配置读写、连通测试、对话、简报。
2. 云端助手可调用与电脑端**同一套** 40+ 工具（查日程、记账、排程、开专注、旅记、校园只读）。
3. 模型来源用**平台统一 Key**：站点配置一个 `ASSISTANT_API_KEY` Secret，全站共用，用户无需自备。
4. 前端在云端模式下解禁 AI 相关 UI，不再显示「需要本机网关」。
5. 保留电脑网关的全部现有能力，两条路径并存互不影响。

## 2. 非目标

- 不做流式输出、语音输入（助手简报二期既定内容，本次不动）。
- 不做按用户配置各自 Key（本轮统一 Key，后续可扩展）。
- 不改手机 App（云端助手仅服务网页）。
- 不引入 npm 依赖到函数包（函数包必须自包含）。

## 3. 现状约束（已实测）

| 约束 | 事实 | 来源 |
|---|---|---|
| 函数包自包含 | `functions/` 225K，零跨目录 import，无 npm 依赖；packager 不解析 path alias、不安装依赖 | 目录检查 + functions.md |
| 既有移植惯例 | `planner.mjs`、`calendar.mjs` 注释写明「从 src/domain 移植，去掉 zod 依赖以便随 Function 打包」 | 源码注释 |
| zod 只在 4 个文件热路径 | `planner`(8)、`trips`(7)、`schedule`(2)、`countdowns`(2)；其余 7 个文件零校验 | grep 统计 |
| 工具层可注入 | `createAgentApi({readPlanner,execute,readCalendars,readLedger,writeLedger,campus,mcp})` 是纯工厂 | agentApi.mjs:154 |
| 云端已有等价能力 | `createDocs` 文档存储、`applyCommand` 命令执行、`/api/ledger` 读写、`createCampus` | lib.mjs:65, routes.mjs:197 |
| 云端有 Web Crypto | `crypto.subtle.digest` 已在 `sha256Hex` 使用 | lib.mjs:123 |
| 助手核心依赖 fs | `assistant.mjs` 用 `fs.readFileSync/writeFileSync` 存 `assistant.json` | assistant.mjs:180-195 |
| 脱敏器依赖 node:crypto | `privacy.mjs` 用 `createHash('sha256')` | privacy.mjs:38 |
| 平台注入模块 | `index.ts` import `./_qoder/backend.mjs`，该目录本地不存在、由平台在部署时注入 | 目录检查 |

## 4. 架构

```
浏览器 ──/functions/v1/app/api/assistant/*──▶ 云端 app 函数
                                             │
                          ┌──────────────────┼─────────────────┐
                          ▼                  ▼                 ▼
                   assistant.mjs      agentApi.mjs        createDocs
                   (模型调用/对话循环)  (40+ 工具注册表)   (设置与数据存储)
                          │                  │
                          │                  ├── domain/*.mjs（移植的无 zod 版本）
                          │                  └── applyCommand / ledger 读写
                          ▼
                   fetch(ASSISTANT_BASE_URL) ──▶ 平台统一模型服务
```

**分层**：

- `functions/domain/*.mjs`：从 `src/domain/*.ts` 移植的纯计算模块，无 zod、无 node 依赖。
- `functions/agentApi.mjs`：工具注册表，IO 换成云端实现。与 `local-sync/agentApi.mjs` 保持同一套工具名与 schema 语义。
- `functions/assistant.mjs`：助手核心，设置存 `createDocs`，模型调用用 `fetch`。
- `functions/routes.mjs`：置换 503 分支为真实路由。

## 5. 关键决策

### 5.1 统一 Key 从环境变量读

模型服务地址、模型名与 Key 全部由平台 Secret 决定，用户在网页上不配置：

- `ASSISTANT_BASE_URL`：兼容 OpenAI 的地址，例如 `https://api.deepseek.com/v1`。
- `ASSISTANT_MODEL`：模型名。
- `ASSISTANT_API_KEY`：密钥值。

三者通过 `Deno.env.get()` 读取，写进 `prepare_site.secretNames`。任一缺失时，`/api/assistant/chat` 返回稳定错误 `assistant_not_configured`（503），前端显示「站点还没配置模型，请联系管理员」。

**设置页在云端模式下是只读的**：显示当前模型名、脱敏后的地址、`已由站点配置` 状态，不提供输入框。用户唯一可调的是隐私模式（脱敏/不脱敏）。

### 5.2 数据隔离按账号

现有云端数据已按 `userId:name` 分键存储。助手的**隐私模式偏好**用同一个键空间：`${userId}:assistant`。模型地址与 Key 不落用户数据，因此不存在按用户加密存储的问题。

### 5.3 工具层复用方式

`functions/agentApi.mjs` 不复制 `local-sync/agentApi.mjs` 全文，而是：

1. 移植 10 个 domain 文件到 `functions/domain/*.mjs`（去掉 zod，保留逻辑）。
2. 移植工具注册表，把 4 个 IO 换成 `createDocs` + `applyCommand` + 云端 ledger 读写。
3. 用脚本对拍：用同一份输入分别跑两份实现，比对输出（详见 8.1）。

### 5.4 脱敏

云端统一 Key 场景下，数据会离开服务器去模型服务，脱敏仍然需要：

- `privacy.mjs` 的 `createHash` 换成 `crypto.subtle.digest`（异步化 `hashToken`）。
- 移植为 `functions/privacy.mjs`，保持相同的占位符格式 `[[CATEGORY:hash10]]`。

### 5.5 隐私模式语义

保留三档，但云端语义调整：

- `local-only`：云端**不支持**（云端没有「本机模型」），选择时返回明确提示并降级为规则版。
- `redact`：默认，发往模型前脱敏。
- `off`：不脱敏。

## 6. 接口契约

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/assistant/settings` | 返回 `{baseUrl, model, hasApiKey, privacyMode, updatedAt, managedBy: 'site'}`，不含 Key |
| PUT | `/api/assistant/settings` | **只接受 `privacyMode`**；传入其他字段返回 400 |
| POST | `/api/assistant/test` | 用平台配置请求 `/models`，返回模型列表与 `modelFound` |
| POST | `/api/assistant/chat` | 完整对话循环，返回 `{reply, trace}` |
| GET | `/api/assistant/briefing?scope=day\|week` | 简报，模型不可用时降级规则模板 |

响应格式与 [src/data/assistant.ts](file:///D:/AgentPrograms/AtHand/src/data/assistant.ts) 现有 zod schema 基本一致：`baseUrl`/`model` 来自平台配置，`hasApiKey` 表示平台是否已配 Key。前端 schema 需补 `managedBy` 可选字段。

## 7. 前端改动

| 文件 | 改动 |
|---|---|
| `src/data/assistant.ts` | settings schema 补可选 `managedBy`；`saveAssistantSettings` 云端模式只提交 `privacyMode` |
| `src/features/settings/SettingsPage.tsx` | 云端模式显示只读模型信息 + 可切换隐私模式，不再渲染地址/Key 输入框 |
| `src/features/assistant/AssistantPage.tsx` | 移除云端模式的拦截说明卡，恢复正常对话 |
| `src/features/home/HomePage.tsx` | 移除 `cloudMode` 的说明分支，恢复 composer |
| `src/data/useBriefing.ts` | 云端模式也拉取 `/api/assistant/briefing` |

## 8. 测试策略

### 8.1 移植一致性对拍

新增 `functions/domain/parity.test.ts`（vitest，跑在本地）：

- 用固定 fixtures 分别调用 `src/domain/*.ts` 与 `functions/domain/*.mjs`。
- 断言输出深度相等。
- 覆盖：`buildDayBrief`、`buildWeekReview`、`buildTimeline`、`getCountdowns`、`summarize`、`buildRecord`、`previewCampus`。

### 8.2 云端助手单测

`functions/assistant.test.mjs`（node:test，与现有 `account.test.mjs` 同风格）：

- 设置读写往返、`hasApiKey` 不泄露。
- 未配置 Key 时返回 `assistant_not_configured`。
- 模型返回 tool_calls 时工具被执行、trace 记录正确。
- 简报在模型失败时降级为规则模板。

### 8.3 e2e

- 更新 `e2e/assistant.spec.ts`：新增云端模式用例，mock `/api/assistant/*` 验证表单可用。
- 现有本机网关用例保持不变。

## 9. 发布步骤

1. 本地 `npm run build` 产出前端。
2. `prepare_site` 带 `functionDirectory: "functions"`、`databaseAccess: "read_write"`、`secretNames: ["ASSISTANT_BASE_URL","ASSISTANT_MODEL","ASSISTANT_API_KEY"]`。
3. 用户在 Sites 设置里填入 Secret 值。
4. `publish_site` → 验证 `/api/assistant/test` 返回 200。

## 10. 与既有设计的关系

本次**取代**旧 spec 中的云端排除条款。`docs/superpowers/specs/2026-11-23-assistant-briefing-design.md` 第 2 节曾写明「不改云端后端；云端继续只托管静态站，助手仍走电脑网关」，理由当时是「云端账号后端配额为 0」。该前提已不成立：云端现在有 database + functions + storage，`app` 函数在线且 `/api/health` 返回 200。简报与洞察的**计算分工原则**（确定性代码算数据、模型只润色、永远保留降级）继续沿用，本次不改该原则。

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 移植 10 个 domain 文件出错 | 对拍测试兜底；分两批移植（无 zod 的 6 个先导，含 zod 的 4 个后做） |
| 函数包体积增长 | 当前 225K，domain 移植约增 60K，远低于限制 |
| 统一 Key 被滥用 | 按账号限流；Key 只在服务端，不下发浏览器 |
| 工具写操作在云端产生副作用 | 复用 `applyCommand` 的 revision 校验与 receipt 幂等，与现有 `/api/planner/operations` 一致 |
