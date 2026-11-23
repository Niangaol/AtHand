# 顺手的 Agent 接口与内置助手

顺手现在有两个 AI 入口，共用同一套工具：

1. **内置助手页**：在顺手里直接说话，助手查数据、做安全写操作。模型可以是本机 Ollama，也可以是云端 OpenAI 兼容服务。
2. **外部 Agent 接口**：给脚本、桌面 agent 或别的程序一把可撤销的令牌，通过 HTTP 调用同一套工具。

两者都不会删除数据，也不会替你付款、提交申请或签字。

## 内置助手

### 配置模型

1. 电脑上启动网关：`npm run sync`。
2. 网页「设置 → 电脑与网页」连接电脑。
3. 在「AI 助手」里填：
   - **本机 Ollama**：地址 `http://127.0.0.1:11434/v1`，模型填 `ling-3.0-tiny:32k`，API Key 留空。先确保 Ollama 正在运行。
   - **云端**：填兼容 OpenAI 的地址、模型名和 Key。
4. 点「保存模型设置」，再点「测试连接」。

本机推荐模型是 Ling-3.0-tiny（1.3B 激活参数的 MoE，支持工具调用）。先拉取，再做一个 32k 上下文的版本：

```bash
ollama pull maternion/ling-3.0-tiny:8b
printf 'FROM maternion/ling-3.0-tiny:8b\nPARAMETER num_ctx 32768\n' > Modelfile
ollama create ling-3.0-tiny:32k -f Modelfile
```

40 个工具加上系统提示约 6500 token，Ollama 默认 4096 上下文会直接报错，所以要用 32k 版本。首次回答需要把约 5 GB 模型读进显存，通常要等 1 分钟左右；之后一般 1–2 秒。对 `127.0.0.1`/`localhost` 的模型，顺手会自动关闭思考模式，保证日常操作够快。

API Key 只保存在电脑的 `local-sync/data/assistant.json`，不会回传到浏览器；设置页只显示“有没有保存 Key”。接云端时，默认先做本地脱敏，再把脱敏后的对话和工具摘要发给服务商；本机模型不脱敏。

### 使用

打开侧栏顶部的「AI 工作台」、右上角的「问助手」，或在任意页面按 `Ctrl K`。可以：

- “今天怎么安排？”
- “这周花了多少？按分类说一下。”
- “明晚七点安排复习一小时。”
- “午饭花了 18 块 5，记吃饭。”
- “每周三下午两点到四点英语课，从第一周上到第十六周。”
- “下周去上海，帮我建个旅记，加上外滩和充电器。”
- “把课表同步进来”“我下一节课在哪”“最近考试还有几天”“这周有什么通知”“饭卡还剩多少。”

助手会先调用工具，再回答。每次工具调用都会显示在回复下面的“操作”里；设置页的「最近操作」也会留记录。

### 助手的边界

- 可以：查全部数据；新建/修改日程、课程、倒计时；记/改支出和工时；新建/修改兼职单位；开始/控制专注；新建/修改旅记、添加行程和打包项、添加内置城市足迹。
- 不可以：删除日程、记录、单位、课程、倒计时、旅记；删除仍在对应页面做。
- 校园服务只读，不会编造政策、材料或办理入口，也不会代提交、代签字、代付款。
- 校园数据需要先在网页连接杭电助手并开启个人只读；同步课表/考试只新增或更新 `hdu:` 条目，不删除任何条目。
- 模型调用一次最多 90 秒（含首次加载模型），最多连续 5 轮工具调用；失败会如实提示，不会假装成功。

### 隐私

- 对话存在当前浏览器的 `localStorage`，最多保留 40 条；页面里有「清空对话」。
- 工具返回的数据只在本次模型调用中使用；不会另外上传到顺手自己的服务器。
- 设置里可选三种隐私模式：
  - **云端脱敏（默认）**：姓名、学号、手机、卡号、课程名等先换成 `[[PHONE:哈希]]` 这类占位符，工具参数在执行前于本机还原，模型回复也在本机还原。脱敏映射只驻内存，按请求丢弃，不写日志。
  - **只在本机**：模型地址必须是 `127.0.0.1`/`localhost` 等本机地址；配了云端地址会直接拒绝。
  - **不脱敏**：对话和工具结果原样发给模型，适合完全信任的服务商。
- 本机模型（Ollama）始终直接读原文，不经过占位符。
- 脱敏是尽力而为，不是硬隔离：时间、金额、课程结构仍可能被推断；昵称、未加标签的姓名也可能漏掉。最稳的做法仍是个人数据只交给本机模型。


## 外部 Agent 接口

### 生成令牌

1. 网页连接电脑。
2. 「设置 → Agent 接口」生成令牌：
   - **只读**：只能看。
   - **可写**：可以执行安全写操作。
3. 令牌只显示一次，复制到 agent 的配置里；随时可以在同一页吊销。

Agent 令牌默认 365 天过期，只能调用 `/api/v1/agent/*`，不能管理令牌，也不能调用内置助手的模型设置。

### 认证与调用

```http
Authorization: Bearer <Agent 令牌>
```

先读 manifest：

```bash
curl -s http://127.0.0.1:18787/api/v1/agent/manifest \
  -H "Authorization: Bearer $TOKEN"
```

再调用工具：

```http
POST /api/v1/agent/call
Content-Type: application/json
Idempotency-Key: <写操作必填，8–100 个字符>

{ "tool": "day_overview", "arguments": {} }
```

读操作不需要幂等键；写操作必须带。重试时用同一个 key，网关不会重复创建。工具名和参数按 OpenAI function calling 的格式组织，可以直接转成工具列表。

### 工具表（40 个）

| 工具 | 权限 | 作用 |
| --- | --- | --- |
| `day_overview` | 只读 | 某天的统一时间表、倒计时、进行中的专注、今日/本周专注分钟 |
| `schedule_list` | 只读 | 日期范围内的日程、课程、工时、手机日历和专注段 |
| `schedule_create` | 可写 | 新建手动日程 |
| `schedule_update` | 可写 | 修改手动日程 |
| `courses_list` | 只读 | 查看每周课程规则 |
| `courses_create` | 可写 | 新建每周课程 |
| `courses_update` | 可写 | 修改每周课程 |
| `focus_start` | 可写 | 开始专注 |
| `focus_control` | 可写 | 暂停、继续、完成或结束专注 |
| `focus_summary` | 只读 | 今天/本周专注分钟与最近记录 |
| `countdowns_list` | 只读 | 未来倒计时和已过期项 |
| `countdowns_create` | 可写 | 新建证件或生日倒计时 |
| `countdowns_update` | 可写 | 修改倒计时 |
| `services_search` | 只读 | 搜校园办事服务 |
| `campus_status` | 只读 | 杭电助手连接状态、个人只读开关、会话过期时间 |
| `campus_calendar` | 只读 | 学年、学期、开学/结课日期、当前教学周 |
| `campus_notices` | 只读 | 校园公开通知，可搜关键词 |
| `campus_courses` | 只读 | 本学期课表（需开启个人只读） |
| `campus_exams` | 只读 | 本学期考试（需开启个人只读） |
| `campus_life` | 只读 | 饭卡、电费、图书馆，三类各自返回成功或错误 |
| `campus_sync_courses` | 可写 | 把课表同步成课程规则，只新增/更新 `hdu:` 条目 |
| `campus_sync_exams` | 可写 | 把考试同步成日程，只新增/更新 `hdu:` 条目 |
| `ledger_summary` | 只读 | 收支、净额、工时、支出分类 |
| `ledger_records` | 只读 | 收支明细，可按日期/类型/分类筛选 |
| `ledger_monthly` | 只读 | 月度汇总、分类和单位工时 |
| `ledger_workplaces` | 只读 | 兼职单位列表 |
| `workplaces_add` | 可写 | 新建兼职单位 |
| `workplaces_update` | 可写 | 修改兼职单位 |
| `ledger_add_expense` | 可写 | 记一笔支出 |
| `ledger_update_expense` | 可写 | 修改一笔支出 |
| `ledger_add_work` | 可写 | 记一笔工时 |
| `ledger_update_work` | 可写 | 修改一笔工时 |
| `trips_list` | 只读 | 旅记列表 |
| `trips_get` | 只读 | 旅行详情 |
| `trips_create` | 可写 | 新建旅行 |
| `trips_update` | 可写 | 修改标题、日期、备注 |
| `trips_add_day_item` | 可写 | 添加某天的攻略 |
| `trips_add_packing` | 可写 | 添加打包项 |
| `trips_set_packing` | 可写 | 勾选/取消打包项 |
| `trips_add_visit` | 可写 | 添加内置城市足迹 |

**没有删除工具。** 删除仍在网页里做。

校园工具需要电脑上的杭电助手已连接；`campus_courses`、`campus_exams`、`campus_life` 还要求网页里开启了“个人数据（只读）”。`campus_sync_courses` / `campus_sync_exams` 只写入 `hdu:` 开头的课程规则和考试事件，不修改手动、ICS 或手机日历条目，也不会删除已消失的校园条目，只在结果里列出其 ID。日程页和倒计时会自动使用同步进来的内容。

### 时间与金额

- 时间使用**带时区偏移的 ISO**，例如 `2026-11-22T19:00:00+08:00`；暂不支持全天日程。
- 日期参数用 `YYYY-MM-DD`；月份用 `YYYY-MM`。
- 专注 1–180 分钟；工时单次最长 24 小时，跨午夜自动按次日计算。
- 金额参数：`amountYuan`、`hourlyRateYuan` 用**元**；工具返回的 `amountCents` 用**分**。
- 课程：`semesterStart` 必须是学期首周周一，`weekday` 用 1–7 表示周一到周日。
- 旅记城市只支持内置列表：杭州、上海、北京、南京、苏州、成都、广州、西安。

### 例子：记支出和工时

```bash
curl -s http://127.0.0.1:18787/api/v1/agent/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: expense-20261121-1" \
  -d '{ "tool": "ledger_add_expense", "arguments": { "title": "午饭", "amountYuan": 18.5, "category": "吃饭" } }'
```

```json
{
  "tool": "ledger_add_work",
  "arguments": {
    "workplaceId": "unit-…",
    "date": "2026-11-21",
    "startTime": "14:00",
    "endTime": "18:00"
  }
}
```

### 例子：建课程和旅记

```json
{
  "tool": "courses_create",
  "arguments": {
    "title": "英语",
    "semesterStart": "2026-09-07",
    "weekday": 3,
    "startTime": "14:00",
    "endTime": "16:00",
    "firstWeek": 1,
    "lastWeek": 16,
    "location": "A101"
  }
}
```

```json
{
  "tool": "trips_create",
  "arguments": { "title": "上海周末", "startDate": "2026-11-28", "endDate": "2026-11-29", "notes": "看展" }
}
```

### 例子：同步课表和考试

```json
{ "tool": "campus_sync_courses", "arguments": {} }
```

```json
{ "tool": "campus_sync_exams", "arguments": {} }
```

写操作记得带 `Idempotency-Key`。返回 `written`、`unchanged`、`removed` 和 `warnings`；`removed` 只列出 ID，不会自动删除。

### 错误码

| HTTP | error | 含义 |
| --- | --- | --- |
| 400 | `invalid_arguments` | 参数格式不对 |
| 400 | `missing_idempotency_key` | 写操作没带幂等键 |
| 400 | `trip_dates_conflict` | 缩短旅行日期时，范围外还有攻略或城市记录 |
| 401 | `unauthorized` | 令牌无效或过期 |
| 403 | `scope_read_only` | 只读令牌尝试写入 |
| 403 | `agent_token_restricted` | Agent 令牌调用了非 Agent 接口 |
| 403 | `session_required` | 令牌管理/助手设置只允许网页登录 |
| 404 | `unknown_tool` | 工具名不存在 |
| 404 | `workplace_not_found` / `record_not_found` / `trip_not_found` | 对应数据不存在 |
| 409 | `focus_active` | 已有进行中的专注 |
| 409 | `focus_not_finished` | 专注还没到计划时长 |
| 409 | `campus_not_connected` | 还没有连接杭电助手 |
| 409 | `conflict` | 数据在另一处被修改，重试即可 |
| 409 | `request_id_reused` | 同一个幂等键用于不同操作 |
| 403 | `campus_personal_disabled` | 个人只读开关没开 |
| 403 | `campus_owner_binding_required` | 杭电助手未开启本人绑定 |
| 503 | `campus_helper_unavailable` | 连不上杭电助手 |
| 503 | `campus_schema_changed` | 学校字段和预期不一致，暂不同步 |
| 504 | `campus_timeout` | 杭电助手响应超时 |
| 503 | `storage_unavailable` | 电脑上的存储文件异常 |

内置助手另外可能返回：

| HTTP | error | 含义 |
| --- | --- | --- |
| 409 | `provider_not_configured` | 还没有填模型名称 |
| 502 | `provider_unreachable` / `provider_error` | 连不上模型或模型报错 |
| 504 | `provider_timeout` | 模型响应超时 |

### 操作记录

Agent 和内置助手的每次工具调用都会留一条记录：时间、名称、工具、参数摘要、成功/失败。设置页显示最近 12 条；完整记录在 `local-sync/data/agent-audit.json`，最多 200 条。记录里没有令牌。

### 安全建议

- 只读令牌优先；确认要写入时再生成可写令牌。
- 不用时在设置页吊销。
- 不要把网关直接暴露到公网；远程用 HTTPS 隧道，并保持访问口令和令牌分开。
- 接云端模型时注意数据会发给服务商；本机 Ollama 不出电脑。
- 定期导出账本和原始备份。

## 验证

```bash
node --test local-sync/*.test.mjs
npm test
npx playwright test e2e/agent.spec.ts e2e/assistant.spec.ts
```

当前真机 Android 采集仍需在设备可见时单独验证；助手与 Agent 接口本身在浏览器和本地网关里已验证。
