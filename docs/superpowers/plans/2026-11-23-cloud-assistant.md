# 云端内置助手 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让顺手网页在云端账号模式下自带完整 AI 助手（配置、测试、对话、简报），可调用与电脑端同一套 40+ 工具。

**Architecture:** 用 esbuild 把 `src/domain/*.ts` 打包成自包含的 `functions/vendor/domain.mjs`（zod 内联，零手工移植），云端实现 4 个 IO 适配器注入 `createAgentApi` 复用全部工具，助手核心改为无 `fs`、设置从 `Deno.env` 读平台 Secret。

**Tech Stack:** Deno Edge Function（`functions/`）、esbuild（已装 0.28.2）、React 19 + Vite、vitest、node:test。

**Spec:** `docs/superpowers/specs/2026-11-23-cloud-assistant-design.md`

## Global Constraints

- 函数包必须自包含：`functions/` 内不得出现跨目录 import（`../src/...`）、不得 import 任何 npm 包。已有注释惯例见 `functions/planner.mjs:1`。
- 模型 Key 只从 `Deno.env.get('ASSISTANT_API_KEY')` 读，**绝不**写入源码、日志、响应体或前端产物。
- 接口响应格式必须与 `src/data/assistant.ts` 的 zod schema 兼容。
- 所有金额用「分」的整数（`Cents` 后缀），时间戳用毫秒。
- 报告路径用相对仓库根的路径。
- 测试基线：`npm test` 现有 235/236 通过，唯一失败是 `src/features/overview/__tmp-review-smoke.test.tsx`（既有，与本计划无关）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `tools/build-domain-bundle.mjs` | 新增。esbuild 打包 domain 层到 `functions/vendor/domain.mjs` |
| `functions/vendor/domain.mjs` | 新增（生成物）。自包含的 domain 计算模块，导出 27 个函数 |
| `functions/privacy.mjs` | 新增。脱敏器，`crypto.subtle` 替代 `node:crypto` |
| `functions/agentApi.mjs` | 新增。工具注册表，IO 由 `createDocs` + `applyCommand` + 云端 ledger 提供 |
| `functions/assistant.mjs` | 新增。助手核心：设置、测试、对话循环、简报 |
| `functions/routes.mjs` | 修改 `335-353`。替换 503 分支为真实路由 |
| `src/data/assistant.ts` | 修改。schema 补 `managedBy` |
| `src/features/settings/SettingsPage.tsx` | 修改。云端模式改为只读模型信息 + 隐私模式开关 |
| `src/features/assistant/AssistantPage.tsx` | 修改。移除云端拦截卡 |
| `src/features/home/HomePage.tsx` | 修改。移除云端说明分支 |
| `functions/domain.parity.test.ts` | 新增。打包产物与源码的对拍测试 |

---

## Task 1: 建立 domain 打包产物

**Files:**
- Create: `tools/build-domain-bundle.mjs`
- Create: `functions/vendor/domain.mjs`（生成物）
- Test: `functions/domain.parity.test.ts`

**Interfaces:**
- Produces: `functions/vendor/domain.mjs` 导出 `buildDayBrief`、`buildWeekReview`、`buildLedgerInsights`、`buildFocusInsights`、`buildTimeline`、`buildEvent`、`expandCourse`、`getCountdowns`、`summarize`、`buildRecord`、`buildWorkplace`、`parseAmount`、`isLedgerState`、`focusedSeconds`、`focusedSecondsBetween`、`remainingSeconds`、`getMonthRange`、`getWeekRange`、`shiftDate`、`toDateKey`、`changeTripDates`、`cities`、`newTrip`、`expenseCategories`、`applyCommand`、`commandKey`、`createPlannerState`、`canonical`。

- [ ] **Step 1: 写对拍测试（先失败）**

创建 `functions/domain.parity.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import * as src from '../src/domain/insights.ts';
import * as bundled from './vendor/domain.mjs';
import { createInitialState } from '../src/data/storage.ts';

const today = '2026-11-23';
const now = new Date(`${today}T12:00:00`).getTime();

describe('domain bundle parity', () => {
  it('exports the same public surface', () => {
    for (const name of ['buildDayBrief', 'buildWeekReview', 'buildTimeline', 'getCountdowns', 'summarize', 'buildRecord', 'isLedgerState', 'applyCommand']) {
      expect(typeof (bundled as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('buildDayBrief matches source on empty state', () => {
    const state = bundled.createPlannerState();
    expect(bundled.buildDayBrief(state, [], [], today, now)).toEqual(src.buildDayBrief(state, [], [], today, now));
  });

  it('buildWeekReview matches source with sample ledger', () => {
    const ledger = createInitialState(today, true);
    const state = bundled.createPlannerState();
    expect(bundled.buildWeekReview(state, ledger.records, [], today, now))
      .toEqual(src.buildWeekReview(state, ledger.records, [], today, now));
  });

  it('summarize matches source', () => {
    const ledger = createInitialState(today, true);
    expect(bundled.summarize(ledger.records, today, today)).toEqual(src.summarize(ledger.records, today, today));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run functions/domain.parity.test.ts`
Expected: FAIL，`Cannot find module './vendor/domain.mjs'`

- [ ] **Step 3: 写打包脚本**

创建 `tools/build-domain-bundle.mjs`：

```js
// 把 src/domain 打包成函数包可用的自包含 ESM：zod 内联，无跨目录 import。
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outdir = resolve(root, 'functions/vendor');
mkdirSync(outdir, { recursive: true });

// 显式列出函数包需要的导出；新增依赖时同步更新。
const entry = `
export { buildDayBrief, buildWeekReview, buildLedgerInsights, buildFocusInsights } from '${resolve(root, 'src/domain/insights.ts').replace(/\\/g, '/')}';
export { buildTimeline, buildEvent, expandCourse } from '${resolve(root, 'src/domain/schedule.ts').replace(/\\/g, '/')}';
export { getCountdowns } from '${resolve(root, 'src/domain/countdowns.ts').replace(/\\/g, '/')}';
export { summarize } from '${resolve(root, 'src/domain/summary.ts').replace(/\\/g, '/')}';
export { buildRecord, buildWorkplace, parseAmount } from '${resolve(root, 'src/domain/ledger.ts').replace(/\\/g, '/')}';
export { isLedgerState } from '${resolve(root, 'src/data/storage.ts').replace(/\\/g, '/')}';
export { focusedSeconds, focusedSecondsBetween, remainingSeconds } from '${resolve(root, 'src/domain/focus.ts').replace(/\\/g, '/')}';
export { getMonthRange, getWeekRange, shiftDate, toDateKey } from '${resolve(root, 'src/domain/dates.ts').replace(/\\/g, '/')}';
export { changeTripDates, cities, newTrip } from '${resolve(root, 'src/domain/trips.ts').replace(/\\/g, '/')}';
export { expenseCategories } from '${resolve(root, 'src/domain/records.ts').replace(/\\/g, '/')}';
export { applyCommand, commandKey, createPlannerState, canonical } from '${resolve(root, 'src/domain/planner.ts').replace(/\\/g, '/')}';
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

console.log('built functions/vendor/domain.mjs');
```

Then add npm script to `package.json` scripts: `"build:fn-domain": "node tools/build-domain-bundle.mjs"`.

- [ ] **Step 4: 生成产物并跑测试**

Run: `npm run build:fn-domain && npx vitest run functions/domain.parity.test.ts`
Expected: PASS（4 项全绿）

- [ ] **Step 5: 验证函数包无跨目录 import**

Run: `grep -c "from '\.\./src" functions/vendor/domain.mjs || echo "0 (clean)"`
Expected: `0 (clean)`

- [ ] **Step 6: 提交**

```bash
git add tools/build-domain-bundle.mjs functions/vendor/domain.mjs functions/domain.parity.test.ts package.json
git commit -m "feat(functions): 打包 domain 层为自包含 ESM 供云端复用"
```

---


## Task 2: 移植脱敏器到函数包

**Files:**
- Create: `functions/privacy.mjs`
- Test: `functions/privacy.test.mjs`

**Interfaces:**
- Consumes: 无。
- Produces: `createRedactor()` 返回 `{ redactText(text), redactValue(value), rehydrateText(text), rehydrateValue(value) }`；`normalizePrivacyMode(value): 'local-only'|'redact'|'off'`。

- [ ] **Step 1: 写测试（先失败）**

创建 `functions/privacy.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedactor, normalizePrivacyMode } from './privacy.mjs';

test('normalizePrivacyMode falls back to redact', () => {
  assert.equal(normalizePrivacyMode('bogus'), 'redact');
  assert.equal(normalizePrivacyMode('off'), 'off');
});

test('redactText replaces phone numbers with stable tokens', async () => {
  const r = createRedactor();
  const out = await r.redactText('我的手机是13800138000');
  assert.match(out, /\[\[PHONE:[0-9a-f]{10}\]\]/);
  assert.equal(out.includes('13800138000'), false);
});

test('redactValue keeps readable titles and hides location', async () => {
  const r = createRedactor();
  const out = await r.redactValue({ title: '午饭', location: '3教601' });
  assert.equal(out.title, '午饭');
  assert.match(out.location, /\[\[(LOCATION|ROOM|ADDR):[0-9a-f]{10}\]\]/);
});

test('rehydrateText restores the original value', async () => {
  const r = createRedactor();
  const red = await r.redactText('13800138000');
  assert.equal(await r.rehydrateText(red), '13800138000');
});

test('hash matches the node:crypto implementation used by the gateway', async () => {
  const { createHash } = await import('node:crypto');
  const r = createRedactor();
  const out = await r.redactText('张三');
  const expected = createHash('sha256').update('NAME\u0000张三', 'utf8').digest('hex').slice(0, 10);
  assert.equal(out, `[[NAME:${expected}]]`);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test functions/privacy.test.mjs`
Expected: FAIL，找不到 `./privacy.mjs`

- [ ] **Step 3: 实现**

从 `local-sync/privacy.mjs` 复制全部逻辑到 `functions/privacy.mjs`，只改哈希部分为异步。关键改动：

```js
// functions/privacy.mjs
const PRIVACY_MODES = new Set(['local-only', 'redact', 'off']);

export function normalizePrivacyMode(value) {
  return PRIVACY_MODES.has(value) ? value : 'redact';
}

const KEY_CATEGORY = {
  name: 'NAME', studentName: 'NAME', teacher: 'NAME', teacherName: 'NAME',
  workplace: 'NAME', workplaceName: 'NAME', title: 'TITLE', task: 'TASK',
  course: 'COURSE', courseName: 'COURSE', location: 'LOCATION', locationName: 'LOCATION',
  place: 'PLACE', city: 'CITY', address: 'ADDR', room: 'ROOM', seat: 'SEAT',
  cardNo: 'CARD', maskedNo: 'CARD', phone: 'PHONE', email: 'EMAIL',
};
const PERSONAL_KEYS = new Set(Object.keys(KEY_CATEGORY));
const TOKEN_PATTERN = /\[\[[A-Z]+:[0-9a-f]{10}\]\]/g;
const PHONE_PATTERN = /1[3-9]\d{9}/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

const encoder = new TextEncoder();

async function hashToken(category, value) {
  const data = encoder.encode(`${category}\u0000${value}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `[[${category}:${hex.slice(0, 10)}]]`;
}

export function createRedactor() {
  const map = new Map();

  async function tokenFor(category, value) {
    const token = await hashToken(category, value);
    if (!map.has(token)) map.set(token, value);
    return token;
  }

  async function redactText(value) {
    let text = String(value ?? '');
    for (const match of text.match(PHONE_PATTERN) ?? []) {
      text = text.replaceAll(match, await tokenFor('PHONE', match));
    }
    for (const match of text.match(EMAIL_PATTERN) ?? []) {
      text = text.replaceAll(match, await tokenFor('EMAIL', match));
    }
    return text;
  }

  async function redactValue(value) {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) out.push(await redactValue(item));
      return out;
    }
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = PERSONAL_KEYS.has(key) && typeof item === 'string' && item.trim()
        ? await tokenFor(KEY_CATEGORY[key], item)
        : await redactValue(item);
    }
    return out;
  }

  function rehydrateText(value) {
    return String(value ?? '').replace(TOKEN_PATTERN, (token) => map.get(token) ?? token);
  }

  function rehydrateValue(value) {
    if (typeof value === 'string') return rehydrateText(value);
    if (Array.isArray(value)) return value.map(rehydrateValue);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = rehydrateValue(item);
    return out;
  }

  return { redactText, redactValue, rehydrateText, rehydrateValue };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test functions/privacy.test.mjs`
Expected: PASS（5 项全绿）

- [ ] **Step 5: 提交**

```bash
git add functions/privacy.mjs functions/privacy.test.mjs
git commit -m "feat(functions): 脱敏器改用 Web Crypto 以便随函数包运行"
```

---

## Task 3: 云端工具层适配器

**Files:**
- Create: `functions/agentApi.mjs`
- Test: `functions/agentApi.test.mjs`

**Interfaces:**
- Consumes: `functions/vendor/domain.mjs`（Task 1）、`createDocs`（`functions/lib.mjs:65`）。
- Produces: `createAgentApi({ docs, userId })` 返回 `{ manifest({scope}), call({tool, arguments, requestId}) }`。
  - `manifest({scope:'read'|'write'})` → `{ tools: Array<{name, description, input}> }`，其中 `input` 为 JSON Schema 对象。
  - `call(...)` → `{ ok:true, result, revision? }`；失败抛 `AgentError`（含 `status`、`code`、`message`）。

- [ ] **Step 1: 写测试（先失败）**

创建 `functions/agentApi.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentApi } from './agentApi.mjs';

function memoryDocs() {
  const store = new Map();
  return {
    async get(name) {
      const value = store.get(name);
      return value ? { name, value: value.value, revision: value.revision } : null;
    },
    async ensure(name, makeValue) {
      if (!store.has(name)) store.set(name, { value: makeValue(), revision: 0 });
      const value = store.get(name);
      return { name, value: value.value, revision: value.revision };
    },
    async replace(name, next, baseRevision) {
      const current = store.get(name);
      if (current && current.revision !== baseRevision) throw Object.assign(new Error('conflict'), { code: 'conflict' });
      store.set(name, { value: next, revision: (current?.revision ?? -1) + 1 });
      return { name, value: next, revision: store.get(name).revision };
    },
  };
}

test('manifest lists read and write tools', async () => {
  const api = createAgentApi({ docs: memoryDocs(), userId: 'u1' });
  const { tools } = await api.manifest({ scope: 'write' });
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes('day_overview'));
  assert.ok(names.includes('ledger_add_expense'));
  assert.ok(names.includes('schedule_create'));
  for (const tool of tools) assert.equal(typeof tool.input, 'object');
});

test('read scope excludes write tools', async () => {
  const api = createAgentApi({ docs: memoryDocs(), userId: 'u1' });
  const { tools } = await api.manifest({ scope: 'read' });
  assert.equal(tools.some((tool) => tool.name === 'ledger_add_expense'), false);
});

test('ledger_add_expense writes once for a repeated requestId', async () => {
  const api = createAgentApi({ docs: memoryDocs(), userId: 'u1' });
  const args = { title: '午饭', amountYuan: 18.5, category: '吃饭', date: '2026-11-23' };
  await api.call({ tool: 'ledger_add_expense', arguments: args, requestId: 'req-1' });
  await api.call({ tool: 'ledger_add_expense', arguments: args, requestId: 'req-1' });
  const records = await api.call({ tool: 'ledger_records', arguments: { from: '2026-11-23', to: '2026-11-23' }, requestId: 'req-2' });
  assert.equal(records.result.total, 1);
});

test('day_overview returns today facts', async () => {
  const api = createAgentApi({ docs: memoryDocs(), userId: 'u1' });
  const out = await api.call({ tool: 'day_overview', arguments: {}, requestId: 'req-3' });
  assert.equal(typeof out.result.date, 'string');
});

test('unknown tool raises a 404 AgentError', async () => {
  const api = createAgentApi({ docs: memoryDocs(), userId: 'u1' });
  await assert.rejects(
    () => api.call({ tool: 'nope', arguments: {}, requestId: 'req-4' }),
    (error) => error.code === 'unknown_tool' && error.status === 404,
  );
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test functions/agentApi.test.mjs`
Expected: FAIL，`Cannot find module './agentApi.mjs'`

- [ ] **Step 3: 让 bundle 也导出 zod**

修改 `tools/build-domain-bundle.mjs` 的 entry 字符串，末尾加一行：

```js
export { z } from 'zod';
```

esbuild 打包时会从 `node_modules` 解析它。重新生成：

Run: `npm run build:fn-domain`
Expected: 输出 `built functions/vendor/domain.mjs`

- [ ] **Step 4: 实现 functions/agentApi.mjs**

复制 `local-sync/agentApi.mjs` 全文到 `functions/agentApi.mjs`，执行四处替换：

1. 顶部两个 import 改为：
```js
import { z } from './vendor/domain.mjs';
import * as domain from './vendor/domain.mjs';
```
2. 所有 `crypto.createHash('sha256')...` 同步调用改为异步 `sha256Hex`（复用 `functions/lib.mjs` 的实现，或在文件内复制一份）。`derivedId` 因此变成 `async`，其调用点需加 `await`。
3. 工厂签名改为 `createAgentApi({ docs, userId, timeZone = 'Asia/Shanghai' })`，并在内部实现四个 IO 函数：

```js
  const plannerName = () => `${userId}:planner`;
  const ledgerName = () => `${userId}:ledger`;

  const emptyPlanner = () => ({ state: domain.createPlannerState(), serverId: null, entityVersions: {}, receipts: [] });

  async function readPlanner() {
    const doc = await docs.ensure(plannerName(), emptyPlanner);
    return { state: doc.value.state, revision: doc.revision, serverId: doc.value.serverId };
  }

  function execute({ baseRevision, command }) {
    // 由 commit() 内部改用文档锁：见下方说明
  }

  async function readLedger() {
    const doc = await docs.get(ledgerName());
    return doc?.value?.ledger ?? null;
  }

  async function writeLedger(ledger) {
    if (!domain.isLedgerState(ledger)) throw new AgentError(400, 'invalid_ledger', '账本校验失败，未保存。');
    const doc = await docs.get(ledgerName());
    await docs.replace(ledgerName(), { ledger, updatedAt: new Date().toISOString() }, doc?.revision ?? -1);
  }

  async function readCalendars() {
    const doc = await docs.get(`${userId}:calendar-snapshot`);
    return Array.isArray(doc?.value?.sources) ? doc.value.sources : [];
  }
```

`commit(tool, requestId, build)` 内部原为「读快照 + execute + 重试」，改为直接的「读文档 + 乐观并发替换」，失败时重复最多 3 次：

```js
  async function commit(tool, requestId, build) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = await docs.ensure(plannerName(), emptyPlanner);
      const patched = build({ doc: { state: doc.value.state, revision: doc.revision, serverId: doc.value.serverId } });
      const state = domain.applyCommand(doc.value.state, patched, Date.now());
      const receipts = Array.isArray(doc.value.receipts) ? doc.value.receipts : [];
      const key = domain.commandKey(patched);
      const next = {
        ...doc.value,
        state,
        entityVersions: { ...(doc.value.entityVersions ?? {}), [key]: doc.revision + 1 },
        receipts: [...receipts, { id: `${tool}:${requestId}`, revision: doc.revision + 1 }].slice(-1000),
      };
      try {
        const saved = await docs.replace(plannerName(), next, doc.revision);
        return { doc: { state, revision: saved.revision, serverId: doc.value.serverId } };
      } catch (error) {
        if (error?.code === 'conflict' || error?.message === 'conflict') continue;
        throw error;
      }
    }
    throw new AgentError(409, 'conflict', '数据正在被另一处修改，请稍后重试。');
  }
```

4. `manifest` 改为把 zod schema 转成 JSON Schema：

```js
  const SCHEMA_CACHE = new Map();
  function schemaOf(tool) {
    if (!SCHEMA_CACHE.has(tool.name)) SCHEMA_CACHE.set(tool.name, z.toJSONSchema(tool.input, { target: 'draft-7' }));
    return SCHEMA_CACHE.get(tool.name);
  }

  return {
    async manifest({ scope = 'read' } = {}) {
      return {
        tools: tools
          .filter((tool) => scope === 'write' || tool.scope === 'read')
          .map((tool) => ({ name: tool.name, description: tool.description, input: schemaOf(tool) })),
      };
    },
    // call 保持不变
  };
```

若 `z.toJSONSchema` 在该 zod 版本不可用，改用：
```js
import { toJSONSchema } from './vendor/domain.mjs';
```
并在 bundle entry 里改为 `export { z, toJSONSchema } from 'zod/v4/core';`（先跑 `node -e "console.log(Object.keys(require('zod/v4/core')))"` 确认导出名）。

**已验证**：`z.toJSONSchema` 在仓库当前 zod 版本可用（顶层导出，返回 draft-07 JSON Schema），正常情况下不需要上面的兜底。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test functions/agentApi.test.mjs`
Expected: 5 项全绿

- [ ] **Step 6: 验证工具数量与电脑端一致**

Run: `node --input-type=module -e "import {createAgentApi} from './functions/agentApi.mjs'; console.log((await createAgentApi({docs:{get:async()=>null,ensure:async()=>({value:{}})}, userId:'x'}).manifest({scope:'write'})).tools.length)"`
Expected: 与 `grep -c "name: '" local-sync/agentApi.mjs` 的数量相当（40 上下），不是 0 或个位数

- [ ] **Step 7: 提交**

```bash
git add functions/agentApi.mjs functions/agentApi.test.mjs tools/build-domain-bundle.mjs functions/vendor/domain.mjs
git commit -m "feat(functions): 云端工具层复用同一套 40+ 工具"
```

---

## Task 4: 云端助手核心

**Files:**
- Create: `functions/assistant.mjs`
- Test: `functions/assistant.test.mjs`

**Interfaces:**
- Consumes: `createAgentApi`（Task 3）、`createRedactor` / `normalizePrivacyMode`（Task 2）。
- Produces: `createAssistant({ docs, userId, env, fetch })` 返回 `{ readSettings, writeSettings, test, chat, briefing }`。
  - `readSettings()` → `{ baseUrl, model, hasApiKey, privacyMode, updatedAt, managedBy: 'site' }`
  - `chat(history)` → `{ reply, trace }`
  - `briefing({scope, fresh})` → `{ scope, date, facts, narrative, degraded, warning, model, generatedAt }`

- [ ] **Step 1: 写测试（先失败）**

创建 `functions/assistant.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistant } from './assistant.mjs';

function memoryDocs() {
  const store = new Map();
  return {
    async get(name) { const v = store.get(name); return v ? { name, value: v.value, revision: v.revision } : null; },
    async ensure(name, make) { if (!store.has(name)) store.set(name, { value: make(), revision: 0 }); const v = store.get(name); return { name, value: v.value, revision: v.revision }; },
    async replace(name, next, base) {
      const c = store.get(name);
      if (c && c.revision !== base) throw Object.assign(new Error('conflict'), { code: 'conflict' });
      store.set(name, { value: next, revision: (c?.revision ?? -1) + 1 });
      return { name, value: next, revision: store.get(name).revision };
    },
    _store: store,
  };
}

const env = (extra = {}) => ({ get: (key) => extra[key] });

function fakeFetch(responses) {
  let i = 0;
  return async () => {
    const next = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
}

test('settings come from env and never expose the key', async () => {
  const assistant = createAssistant({
    docs: memoryDocs(), userId: 'u1',
    env: env({ ASSISTANT_BASE_URL: 'https://api.test/v1', ASSISTANT_MODEL: 'm1', ASSISTANT_API_KEY: 'sk-secret' }),
    fetch: fakeFetch([{ body: {} }]),
  });
  const settings = await assistant.readSettings();
  assert.equal(settings.baseUrl, 'https://api.test/v1');
  assert.equal(settings.model, 'm1');
  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.managedBy, 'site');
  assert.equal(JSON.stringify(settings).includes('sk-secret'), false);
});

test('missing key makes chat fail with assistant_not_configured', async () => {
  const assistant = createAssistant({ docs: memoryDocs(), userId: 'u1', env: env({}), fetch: fakeFetch([{ body: {} }]) });
  await assert.rejects(
    () => assistant.chat([{ role: 'user', content: '你好' }]),
    (error) => error.code === 'assistant_not_configured',
  );
});

test('chat executes tool calls and records trace', async () => {
  const assistant = createAssistant({
    docs: memoryDocs(), userId: 'u1',
    env: env({ ASSISTANT_BASE_URL: 'https://api.test/v1', ASSISTANT_MODEL: 'm1', ASSISTANT_API_KEY: 'k' }),
    fetch: fakeFetch([
      { body: { choices: [{ message: { content: '', tool_calls: [{ id: 'call_1', function: { name: 'day_overview', arguments: '{}' } }] } }] } },
      { body: { choices: [{ message: { content: '今天有 0 项安排。' } }] } },
    ]),
  });
  const out = await assistant.chat([{ role: 'user', content: '今天有什么' }]);
  assert.equal(out.reply, '今天有 0 项安排。');
  assert.equal(out.trace.length, 1);
  assert.equal(out.trace[0].tool, 'day_overview');
});

test('briefing degrades to template when model fails', async () => {
  const assistant = createAssistant({
    docs: memoryDocs(), userId: 'u1',
    env: env({ ASSISTANT_BASE_URL: 'https://api.test/v1', ASSISTANT_MODEL: 'm1', ASSISTANT_API_KEY: 'k' }),
    fetch: fakeFetch([{ status: 500, body: {} }]),
  });
  const out = await assistant.briefing({ scope: 'day' });
  assert.equal(out.degraded, true);
  assert.ok(out.narrative.length > 5);
});

test('test() reports model presence', async () => {
  const assistant = createAssistant({
    docs: memoryDocs(), userId: 'u1',
    env: env({ ASSISTANT_BASE_URL: 'https://api.test/v1', ASSISTANT_MODEL: 'm1', ASSISTANT_API_KEY: 'k' }),
    fetch: fakeFetch([{ body: { data: [{ id: 'm1' }, { id: 'm2' }] } }]),
  });
  const out = await assistant.test();
  assert.equal(out.ok, true);
  assert.equal(out.modelFound, true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test functions/assistant.test.mjs`
Expected: FAIL，`Cannot find module './assistant.mjs'`

- [ ] **Step 3: 实现 functions/assistant.mjs**

复制 `local-sync/assistant.mjs` 到 `functions/assistant.mjs`，做以下替换：

1. 删除 `import fs from 'node:fs'` 与 `import path from 'node:path'`。`crypto` 改用全局 `crypto`（Deno 与 Node 都有 `crypto.randomUUID()`），删掉 `import crypto from 'node:crypto'`。
2. 删除 `import { dayBriefNarrative, weekReviewNarrative } from '../src/domain/insights.ts'`，改为 `import { dayBriefNarrative, weekReviewNarrative } from './vendor/domain.mjs'`。若 bundle 未导出这两个函数，在 `tools/build-domain-bundle.mjs` 的 entry 里补上它们（与 Task 1 的 insights 导出行合并）。
3. 工厂签名改为 `createAssistant({ docs, userId, env, fetch: transport = globalThis.fetch })`。
4. 设置改为「站点环境变量 + 用户隐私偏好」两层：

```js
const SETTINGS_KEY = () => `${userId}:assistant`;
const emptyPrefs = () => ({ privacyMode: 'redact', updatedAt: null });

function siteSettings() {
  return {
    baseUrl: String(env.get('ASSISTANT_BASE_URL') ?? '').trim().replace(/\/+$/, ''),
    model: String(env.get('ASSISTANT_MODEL') ?? '').trim(),
    apiKey: String(env.get('ASSISTANT_API_KEY') ?? '').trim(),
  };
}

async function readPrefs() {
  const doc = await docs.ensure(SETTINGS_KEY(), emptyPrefs);
  return { value: doc.value, revision: doc.revision };
}

async function readSettings() {
  const site = siteSettings();
  const { value } = await readPrefs();
  return {
    baseUrl: site.baseUrl,
    model: site.model,
    hasApiKey: Boolean(site.apiKey),
    privacyMode: normalizePrivacyMode(value.privacyMode),
    updatedAt: value.updatedAt ?? null,
    managedBy: 'site',
  };
}

async function writeSettings(input) {
  const keys = Object.keys(input ?? {});
  if (keys.some((key) => key !== 'privacyMode')) {
    throw new AssistantError(400, 'settings_readonly', '模型地址与 Key 由站点统一配置，只能修改隐私模式。');
  }
  const { revision } = await readPrefs();
  const next = { privacyMode: normalizePrivacyMode(input?.privacyMode), updatedAt: new Date().toISOString() };
  await docs.replace(SETTINGS_KEY(), next, revision);
  return readSettings();
}
```

5. 新增 `resolveModel()`，供 chat/test/briefing 共用：

```js
async function resolveModel() {
  const site = siteSettings();
  if (!site.baseUrl || !site.model || !site.apiKey) {
    throw new AssistantError(503, 'assistant_not_configured', '站点还没有配置模型，请联系管理员。');
  }
  const { value } = await readPrefs();
  const privacyMode = normalizePrivacyMode(value.privacyMode);
  const loopback = isLoopback(site.baseUrl);
  if (!loopback && privacyMode === 'local-only') {
    throw new AssistantError(409, 'privacy_local_only', '当前是“只在本机”隐私模式，但站点模型不在本机。请改为“云端脱敏”。');
  }
  return { ...site, privacyMode, redacting: !loopback && privacyMode === 'redact' };
}
```

6. `providerFetch(settings, path, init)` 内的 `fetch(` 改为 `transport(`；调用方传 `resolveModel()` 的返回值。
7. 工具接入：

```js
  const api = createAgentApi({ docs, userId });

  async function getTools() {
    return (await api.manifest({ scope: 'write' })).tools;
  }

  async function callTool({ tool, args, requestId }) {
    try {
      const out = await api.call({ tool, arguments: args, requestId });
      return { ok: true, result: out.result, revision: out.revision };
    } catch (error) {
      return {
        ok: false,
        error: error?.code ?? 'agent_error',
        message: error instanceof Error ? error.message : '操作未完成。',
      };
    }
  }

  async function getBriefFacts(scope) {
    const tool = scope === 'week' ? 'week_review' : 'day_brief';
    const out = await api.call({ tool, arguments: {}, requestId: `brief-${scope}-${Date.now()}` });
    return out.result;
  }
```

8. 脱敏器改为异步：`redactText`、`redactValue`、`redactFacts` 全部 `await`；`createRedactor()` 从 `./privacy.mjs` 引入。
9. `providerChat` 的 `tools` 字段直接使用 `manifest` 返回的 `input`（已是 JSON Schema），不再需要 `parameters` 转换。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test functions/assistant.test.mjs`
Expected: 5 项全绿

- [ ] **Step 5: 提交**

```bash
git add functions/assistant.mjs functions/assistant.test.mjs tools/build-domain-bundle.mjs functions/vendor/domain.mjs
git commit -m "feat(functions): 云端助手核心，模型配置走平台 Secret"
```

---

## Task 5: 云端路由接入

**Files:**
- Modify: `functions/routes.mjs:329-353`
- Test: `functions/routes.test.mjs`（新建）

**Interfaces:**
- Consumes: `createAssistant`（Task 4）、`createDocs`（`functions/lib.mjs:65`）。
- Produces: `/api/assistant/settings`（GET/PUT）、`/api/assistant/test`（POST）、`/api/assistant/chat`（POST）、`/api/assistant/briefing`（GET）全部可用。

- [ ] **Step 1: 写测试（先失败）**

创建 `functions/routes.test.mjs`。用内存 docs 直接调用 `application`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { application } from './routes.mjs';

function memoryDb() {
  const store = new Map();
  const rowsOfTable = () => [...store.entries()].map(([key, value]) => ({ key, ...value }));
  const from = () => ({
    select() { return this; },
    eq(column, value) { this._key = value; return this; },
    limit() { return { data: this._key ? rowsOfTable().filter((row) => row.key === this._key) : rowsOfTable(), error: null }; },
    insertIfAbsent(row) {
      if (!store.has(row.key)) store.set(row.key, { value: row.value, revision: row.revision });
      return { data: [{ key: row.key }], error: null };
    },
    update() { return this; },
    upsert(row) { store.set(row.key, { value: row.value, revision: row.revision }); return { data: [row], error: null }; },
  });
  return { from: () => { const t = from(); return t; } };
}

// 说明：真实的 createDocs 需要 select/replace 语义，这里只验证路由分支。
// 若内存桩与 createDocs 不匹配，改为直接测试 assistant 路由的错误分支：
// 未登录 → 401；未配置 Key → 503 assistant_not_configured。

test('assistant settings requires login', async () => {
  const app = application({ db: memoryDb() });
  const response = await app(new Request('https://x.test/api/assistant/settings'));
  assert.equal(response.status, 401);
});
```

> 若内存桩实现成本过高，本任务可改用「先实现后验证」：直接对线上 `/api/assistant/settings` 发未登录请求断言 401，并把该检查写进 Task 8 的验收脚本。测试文件保留但不强求内存 DB 全覆盖。

- [ ] **Step 2: 运行确认失败**

Run: `node --test functions/routes.test.mjs`
Expected: FAIL 或断言不符（当前 `/api/assistant/settings` 直接返回 200 假数据，不校验登录）

- [ ] **Step 3: 替换路由实现**

修改 `functions/routes.mjs`，把 329-353 行的两个 `/api/assistant/` 分支替换为：

```js
      if (path.startsWith('/api/assistant/')) {
        const docs = createDocs(db, userId);
        const assistant = createAssistant({
          docs, userId,
          env: { get: (key) => Deno.env.get(key) },
          fetch: transport,
        });

        if (path === '/api/assistant/settings') {
          if (request.method === 'GET') return json({ ok: true, ...await assistant.readSettings() });
          if (request.method === 'PUT') {
            const body = await readJson(request);
            return json({ ok: true, ...await assistant.writeSettings(body) });
          }
          fail(405, 'method_not_allowed', '不支持这个请求方法。');
        }

        if (path === '/api/assistant/test' && request.method === 'POST') {
          const result = await assistant.test();
          return json({ ok: true, result });
        }

        if (path === '/api/assistant/chat' && request.method === 'POST') {
          const body = await readJson(request);
          const messages = Array.isArray(body?.messages) ? body.messages : [];
          const out = await assistant.chat(messages);
          return json({ ok: true, ...out });
        }

        if (path === '/api/assistant/briefing' && request.method === 'GET') {
          const scope = new URL(request.url).searchParams.get('scope') === 'week' ? 'week' : 'day';
          const fresh = new URL(request.url).searchParams.get('fresh') === '1';
          const out = await assistant.briefing({ scope, fresh });
          return json({ ok: true, ...out });
        }

        fail(404, 'not_found', '没有这个助手接口。');
      }
```

并在文件顶部 import：

```js
import { createAssistant } from './assistant.mjs';
```

同时确认 `createDocs` 已从 `./lib.mjs` 解构导入（当前 `routes.mjs:9` 已含它）。

**错误映射**：`AssistantError` 是普通 Error 带 `status`/`code`，现有的 `catch (error)` 分支能处理 `ApiError`，需在同一处补上：

```js
      if (error?.code && Number.isInteger(error?.status) && error instanceof Error) {
        return json({ ok: false, error: error.code, message: error.message }, error.status);
      }
```

- [ ] **Step 4: 本地手工验证**

Run: `node --input-type=module -e "
import { application } from './functions/routes.mjs';
const app = application({ db: { from: () => ({ select(){return this}, eq(){return this}, limit(){return {data:[],error:null}}, insertIfAbsent(){return {data:[],error:null}} }) } });
const res = await app(new Request('https://x.test/api/assistant/settings'));
console.log('status:', res.status);
"`
Expected: `status: 401`（未登录被拒），而不是 200

- [ ] **Step 5: 运行路由测试**

Run: `node --test functions/routes.test.mjs`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add functions/routes.mjs functions/routes.test.mjs
git commit -m "feat(functions): 云端助手路由替换 503 占位"
```

---

## Task 6: 前端契约与设置页

**Files:**
- Modify: `src/data/assistant.ts`
- Modify: `src/features/settings/SettingsPage.tsx`
- Test: `src/features/settings/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: 云端路由（Task 5）。
- Produces: `AssistantSettings` 增加 `managedBy?: 'site'`；设置页云端模式渲染只读模型信息。

- [ ] **Step 1: 写测试（先失败）**

在 `src/features/settings/SettingsPage.test.tsx` 末尾追加：

```tsx
it('cloud mode shows read-only model info instead of key inputs', async () => {
  localStorage.setItem('shunshou.gateway.url', 'https://demo.qoder.zone/functions/v1/app');
  localStorage.setItem('shunshou.gateway.token', 'cloud-token');
  localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 3600_000));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes('/api/assistant/settings')) {
      return Response.json({ ok: true, baseUrl: 'https://api.test/v1', model: 'm1', hasApiKey: true, privacyMode: 'redact', updatedAt: null, managedBy: 'site' });
    }
    if (url.includes('/api/me')) return Response.json({ ok: true, user: { id: 'u1', username: '甲' } });
    return Response.json({ ok: true, ledger: null, updatedAt: null });
  }));
  render(<MemoryRouter initialEntries={['/settings']}><RecordsProvider today="2026-11-23"><App /></RecordsProvider></MemoryRouter>);

  expect(await screen.findByText('m1')).toBeInTheDocument();
  expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
  expect(screen.getByLabelText('隐私模式')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/features/settings/SettingsPage.test.tsx`
Expected: FAIL（云端模式当前显示的是「云端后端不运行内置助手」文案）

- [ ] **Step 3: 扩展 schema**

在 `src/data/assistant.ts` 的 `settingsSchema` 中加字段：

```ts
  managedBy: z.literal('site').optional(),
```

`saveAssistantSettings` 的输入类型保持 `AssistantSettingsInput`，但云端调用方只传 `privacyMode`。

- [ ] **Step 4: 改写设置页云端分支**

在 `src/features/settings/SettingsPage.tsx` 找到 Task 5 之前的云端分支：

```tsx
{cloudMode ? <p className="form-hint">云端后端不运行内置助手，下面是本机网关的做法：…</p>
```

替换为只读信息 + 隐私模式：

```tsx
{cloudMode ? <>
  <div className="setting-row">
    <Sparkles size={22} />
    <div>
      <h3>站点统一模型</h3>
      <p>
        模型 <code>{assistantModel || '未配置'}</code>
        {assistantHasKey ? ' · Key 已由站点配置' : ' · 站点还没配置 Key'}
        {assistantBaseUrl ? ' · 地址已隐藏' : ''}
      </p>
      <p className="form-hint">模型地址与 Key 由站点管理员统一配置，用户无需填写。这个模型会看到你发送的对话和工具结果。</p>
      <label>隐私模式
        <select value={assistantPrivacy} onChange={(event) => setAssistantPrivacy(event.target.value as AssistantSettings['privacyMode'])}>
          <option value="redact">云端脱敏（推荐）</option>
          <option value="off">不脱敏</option>
        </select>
      </label>
      <div className="setting-actions">
        <button type="button" className="button secondary compact" onClick={async () => {
          try {
            const saved = await saveAssistantSettings({ privacyMode: assistantPrivacy });
            setAssistantPrivacy(saved.privacyMode);
            setAssistantStatus('隐私模式已保存。');
          } catch (error) {
            setAssistantStatus(error instanceof Error ? error.message : '保存失败。');
          }
        }}>保存隐私模式</button>
        <button type="button" className="button secondary compact" onClick={testAssistantModel}>测试连接</button>
        <Link className="button secondary compact" to="/assistant">打开助手</Link>
      </div>
      {assistantStatus ? <p className="form-hint" role="status">{assistantStatus}</p> : null}
    </div>
  </div>
</> : !connected ? <p className="form-hint">先连接电脑，再配置模型。</p> : <>
```

同时确认 `useEffect` 拉取设置的依赖不含 `cloudMode`（当前是 `[connected]`，云端登录后也会拉取，保持即可）。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/features/settings/SettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/data/assistant.ts src/features/settings/SettingsPage.tsx src/features/settings/SettingsPage.test.tsx
git commit -m "feat(web): 云端模式下展示站点统一模型配置"
```

---

## Task 7: 解禁助手页与首页

**Files:**
- Modify: `src/features/assistant/AssistantPage.tsx`
- Modify: `src/features/home/HomePage.tsx`
- Test: `src/features/assistant/AssistantPage.test.tsx`（新建）

**Interfaces:**
- Consumes: 云端 `/api/assistant/*`（Task 5）。
- Produces: 云端模式下助手页与首页 composer 正常工作。

- [ ] **Step 1: 写测试（先失败）**

创建 `src/features/assistant/AssistantPage.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi, beforeEach } from 'vitest';
import { AssistantPage } from './AssistantPage';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('shunshou.gateway.url', 'https://demo.qoder.zone/functions/v1/app');
  localStorage.setItem('shunshou.gateway.token', 'cloud-token');
  localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 3600_000));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes('/api/assistant/settings')) {
      return Response.json({ ok: true, baseUrl: 'https://api.test/v1', model: 'm1', hasApiKey: true, privacyMode: 'redact', updatedAt: null, managedBy: 'site' });
    }
    return Response.json({ ok: true });
  }));
});

it('cloud mode renders the composer instead of the gateway notice', async () => {
  render(<MemoryRouter><AssistantPage /></MemoryRouter>);
  expect(await screen.findByLabelText('告诉助手要做什么')).toBeInTheDocument();
  expect(screen.queryByText('云端账号暂不运行助手')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/features/assistant/AssistantPage.test.tsx`
Expected: FAIL（当前渲染的是「云端账号暂不运行助手」说明卡）

- [ ] **Step 3: 移除助手页拦截**

在 `src/features/assistant/AssistantPage.tsx`：

1. 删除 `const cloudMode = mode === 'cloud';` 相关的整段拦截分支：

```tsx
{cloudMode ? <div className="assistant-setup">…云端账号暂不运行助手…</div>
```

改为直接走原有流程，即把

```tsx
{cloudMode ? <...> : !connected ? <...> : loadingSettings ? … }
```

简化为

```tsx
{!connected ? <...> : loadingSettings ? … }
```

2. 状态条 `{cloudMode ? '云端账号已登录' : connected ? '电脑已连接' : '未连接电脑'}` 改为：

```tsx
{connected ? (mode === 'cloud' ? '云端已登录' : '电脑已连接') : '未连接'}
```

3. 状态条模型项 `{cloudMode ? '云端不运行助手' : …}` 改回正常显示 `settings?.model`。

4. `send()` 内的 `if (cloudMode) { setError(...) }` 删除。

5. 侧栏 `{cloudMode ? '云端账号' : …}` 保留（后端标识仍有意义），但模型项 `{cloudMode ? '云端不运行' : …}` 改为正常显示。

- [ ] **Step 4: 移除首页拦截**

在 `src/features/home/HomePage.tsx`：

1. `ask()` 内删除 `if (cloudMode) { setAskError(...) ; return; }`。
2. 按钮副标题 `{cloudMode ? '内置助手需要电脑上的本机网关' : '查安排、记账、排日程、开专注'}` 改为固定文案 `查安排、记账、排日程、开专注`。
3. 问助手面板内的 `{cloudMode ? <说明卡> : <>…composer…</>}` 简化为只保留 composer 分支。
4. 同步状态行 `{cloudMode ? '内置助手需要本机网关，云端账号不同步操作记录' : …}` 改为走正常分支（云端没有 audit 接口时显示「云端记录已同步」会不准确，改为 `cloudMode ? '云端助手已就绪' : …`）。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/features/assistant/AssistantPage.test.tsx`
Expected: PASS

- [ ] **Step 6: 跑全量单测确认无回归**

Run: `npm test`
Expected: 除 `__tmp-review-smoke.test.tsx` 外全绿

- [ ] **Step 7: 提交**

```bash
git add src/features/assistant/AssistantPage.tsx src/features/home/HomePage.tsx src/features/assistant/AssistantPage.test.tsx
git commit -m "feat(web): 云端模式解禁助手对话与首页入口"
```

---

## Task 8: 简报云端启用与发布验收

**Files:**
- Modify: `src/data/useBriefing.ts`
- Create: `tools/verify-assistant.mjs`

**Interfaces:**
- Consumes: 全部前置任务。
- Produces: 云端模式下简报会拉取模型版；一份可重复运行的线上验收脚本。

- [ ] **Step 1: 让 briefing 在云端生效**

当前 `src/data/useBriefing.ts:42` 的 `if (!isGatewayConnected())` 已经允许云端（云端也满足 `isGatewayConnected`），无需改。**验证**这一点：

Run: `grep -n "isGatewayConnected" src/data/useBriefing.ts`
Expected: 只有一个判断，且不额外排除云端 → 无需修改

若发现额外排除云端的条件，删除它。

- [ ] **Step 2: 写线上验收脚本**

创建 `tools/verify-assistant.mjs`：

```js
// 用法：node tools/verify-assistant.mjs https://<站点>.qoder.zone <token>
const [base, token] = process.argv.slice(2);
if (!base) {
  console.error('用法: node tools/verify-assistant.mjs <baseUrl> <token>');
  process.exit(1);
}
const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const api = `${base.replace(/\/+$/, '')}/functions/v1/app`;

async function check(label, path, init) {
  const response = await fetch(`${api}${path}`, { ...init, headers });
  const body = await response.json().catch(() => null);
  console.log(`${response.ok ? 'PASS' : 'FAIL'} ${label} → ${response.status} ${JSON.stringify(body).slice(0, 160)}`);
  return { ok: response.ok, status: response.status, body };
}

const settings = await check('GET settings', '/api/assistant/settings');
if (settings.ok) {
  const { model, hasApiKey, managedBy } = settings.body ?? {};
  console.log(`  模型=${model || '(空)'} 已配Key=${hasApiKey} managedBy=${managedBy}`);
  if (!hasApiKey) console.error('  ⚠ 站点未配置 ASSISTANT_API_KEY，对话会返回 503');
}

await check('POST test', '/api/assistant/test', { method: 'POST', body: '{}' });
await check('POST chat', '/api/assistant/chat', {
  method: 'POST',
  body: JSON.stringify({ messages: [{ role: 'user', content: '今天有什么安排？用一句话回答。' }] }),
});
await check('GET briefing', '/api/assistant/briefing?scope=day');
```

- [ ] **Step 3: 构建并发布**

```bash
npm run build:fn-domain
npm run build
```

然后调用 Sites 工具：`prepare_site` 带 `functionDirectory: "functions"`、`databaseAccess: "read_write"`、`secretNames: ["ASSISTANT_BASE_URL","ASSISTANT_MODEL","ASSISTANT_API_KEY"]`、新的 `actionId`、`spa: true`。

- [ ] **Step 4: 配置 Secret**

在 Qoder Sites 设置里填入三个 Secret 值（地址、模型名、Key）。**值不要写进任何文件或提交。**

- [ ] **Step 5: 发布并验收**

`publish_site` → `get_publish_status` 确认 `published: true` → 运行：

```bash
node tools/verify-assistant.mjs https://athand-qnvq63y722x.qoder.zone <会话令牌>
```

Expected: `GET settings` PASS 且 `hasApiKey=true`；`POST chat` 200 且包含 `reply`；`GET briefing` 200。

- [ ] **Step 6: 提交**

```bash
git add src/data/useBriefing.ts tools/verify-assistant.mjs
git commit -m "feat: 云端助手线上验收脚本"
```

---

## Task 9: 对齐 e2e

**Files:**
- Modify: `e2e/assistant.spec.ts`

- [ ] **Step 1: 加云端模式用例**

在 `e2e/assistant.spec.ts` 末尾追加：

```ts
test('cloud mode exposes the assistant with a site-managed model', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('shunshou.gateway.url', 'https://demo.qoder.zone/functions/v1/app');
    localStorage.setItem('shunshou.gateway.token', 'cloud-token');
    localStorage.setItem('shunshou.gateway.expiresAt', String(Date.now() + 3600_000));
    localStorage.setItem('shunshou.gateway.username', '甲');
  });
  await page.route('**/api/assistant/settings', (route) => route.fulfill({
    json: { ok: true, baseUrl: 'https://api.test/v1', model: 'm1', hasApiKey: true, privacyMode: 'redact', updatedAt: null, managedBy: 'site' },
  }));
  await page.route('**/api/assistant/chat', (route) => route.fulfill({ json: { ok: true, reply: '今天有两项安排。', trace: [] } }));
  await page.route('**/api/me', (route) => route.fulfill({ json: { ok: true, user: { id: 'u1', username: '甲' } } }));
  await page.route('**/api/ledger**', (route) => route.fulfill({ json: { ok: true, ledger: null, updatedAt: null } }));
  await page.route('**/api/planner**', (route) => route.fulfill({ json: { ok: true, state: null, revision: 0, entityVersions: {} } }));

  await page.goto('/assistant');
  await expect(page.getByText('云端账号暂不运行助手')).toHaveCount(0);
  const input = page.getByLabel('告诉助手要做什么');
  await expect(input).toBeVisible();
  await input.fill('今天有什么安排');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('今天有两项安排。')).toBeVisible();
});
```

- [ ] **Step 2: 运行确认通过**

Run: `npx playwright test e2e/assistant.spec.ts --reporter=line`
Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add e2e/assistant.spec.ts
git commit -m "test(e2e): 云端模式助手用例"
```

---

## 完成标准

- [ ] `npm test` 除既有 `__tmp-review-smoke.test.tsx` 外全绿
- [ ] `npx tsc --noEmit` 通过
- [ ] `node --test functions/` 全部通过
- [ ] `node tools/verify-assistant.mjs <线上地址> <token>` 四项 PASS 且 `hasApiKey=true`
- [ ] 线上 `/assistant` 页面能正常对话，`/settings` 显示站点统一模型且无 Key 输入框
