# Android 消息采集与自动日程设计

- 日期：2026-11-26
- 范围：Android APP、云端助手抽取接口、日程写入链路
- 状态：设计已确认，待实现计划

## 1. 目标与边界

首版让用户可以：

1. 从白名单应用的通知采集消息，或主动粘贴消息。
2. 自动从消息中提取日程。
3. 高置信度日程自动保存到云端日程。
4. 对低置信度结果进行编辑、重新识别或忽略。
5. 对自动创建的日程执行撤销，撤销后不会再次自动创建。

首版不包含：

- 短信读取。
- 后台读取剪贴板。
- 广泛无障碍读屏。
- 强制依赖 Shizuku。
- 自动保存低置信度或日期不明确的日程。
- 系统通知推送或新的通知发布权限。
- 修改现有支付采集的解析与入账逻辑。

当前工作树存在大量既有未提交改动。实施时只修改本功能明确涉及的文件，不覆盖、回滚或批量提交其他改动。

## 2. 已确认的产品决策

- 采集入口：通知采集 + 手动粘贴。
- 写入策略：高置信度自动创建。
- 纠错策略：自动保存后支持撤销，也可从收件箱删除。
- 通知来源：由用户选择应用白名单；白名单为空时不采集通知。
- 手动粘贴：不依赖通知使用权，登录后即可使用。
- 自动安排：可在“我的”页独立关闭；关闭后只生成待处理草稿。
- 数据保留：最多 200 条，保留 30 天，退出登录时清空。
- 隐私：原始消息默认只保存在本机；发送给模型前遵循现有助手隐私模式与脱敏规则。

## 3. 方案取舍

### 方案 A：通知 + 手动粘贴，自动保存高置信度日程（采用）

优点：

- 覆盖微信群聊、会议邀请、课程调整、截止日期等主要场景。
- 不需要短信权限或广泛无障碍权限。
- 手动粘贴为通知内容不完整、未授权或模型失败时提供兜底。
- 自动安排保留撤销和删除能力，误排可恢复。

代价：

- 需要本地收件箱、后台 Worker 和幂等写入。
- Android 对通知正文的读取受通知监听授权与应用白名单约束。
- 某些应用只显示“你有一条新消息”，无法提取具体日程，此类消息自然进入无结果或待处理状态。

### 方案 B：只做手动粘贴/系统分享

权限与隐私风险最低，但无法自动发现新消息，需要用户频繁切换应用，不满足本次自动采集目标。

### 方案 C：Shizuku/无障碍读屏

能力更广，但权限更敏感、稳定性受系统版本影响，并且容易采集到无关屏幕内容。首版不采用，现有 Shizuku 入口保持不变。

## 4. 总体架构

```text
白名单应用通知 ──┐
                  ├─> MessageInboxStore ──> MessageExtractionWorker
手动粘贴消息 ─────┘                              │
                                                 v
                                      POST /api/assistant/extract
                                                 │
                                    结构化日程草稿，不写入
                                                 │
                         ┌───────────────────────┴───────────────────────┐
                         │                                               │
                低置信度 / 缺失字段                             高置信度且自动安排开启
                         │                                               │
                  CaptureScreen 编辑                              PlannerEventSync
                         │                                     幂等 put/events + 缓存
                 用户确认后保存                                           │
                         └───────────────────────┬───────────────────────┘
                                                 v
                                     已安排 / 可撤销 / 可删除
```

职责边界：

- `PaymentNotificationListener` 只负责把普通通知转交给消息采集层，不执行网络请求或 AI 抽取。
- `MessageInboxStore` 负责本机消息、设置和草稿状态，不直接访问网络。
- `MessageExtractionWorker` 负责调用抽取接口、执行自动保存门槛和写入日程。
- `POST /api/assistant/extract` 只返回结构化草稿，不访问 planner，不提供写工具。
- `PlannerEventSync` 负责带版本冲突重试的幂等日程写入，UI 与 Worker 共用。
- `CaptureScreen` 负责低置信度草稿编辑、手动保存、忽略、重新识别和撤销。

## 5. Android 采集层

### 5.1 通知监听复用与改造

在现有 `PaymentNotificationListener.onNotificationPosted` 中：

1. 保留原有支付宝/微信支付识别逻辑。
2. 对非支付通知调用 `MessageNotificationCapture.capture(this, sbn)`。
3. 捕获过程只做同步的轻量过滤、哈希和本地持久化。
4. 持久化成功后入队 `MessageExtractionWorker`，不在服务中执行 HTTP。

普通通知文本提取规则：

- 优先读取 `Notification.EXTRA_MESSAGES` 中最新一条 `MessagingStyle.Message.text`，避免把整段历史聊天重复送检。
- 没有 MessagingStyle 时依次使用 `EXTRA_TEXT`、`EXTRA_BIG_TEXT`、`EXTRA_SUB_TEXT`。
- 标题使用 `EXTRA_TITLE`， Conversations 标题可使用 `EXTRA_CONVERSATION_TITLE`。
- 多个候选文本去重后拼接，单条消息正文最多保留 4000 字符。

### 5.2 采集过滤

以下通知不进入消息收件箱：

- 未登录或会话已过期时的通知，避免内容跨账号留存。
- 顺手自身通知。
- `PaymentParser.supportedPackages` 中的支付通知，继续走原支付链路。
- ongoing 通知。
- group summary 通知。
- `VISIBILITY_SECRET` 通知。
- 空白标题且空白正文。
- 命中验证码规则的消息，例如包含“验证码”“校验码”“动态码”“verification code”“OTP”。
- 不在用户应用白名单中的应用。
- 用户关闭消息采集时的通知。

白名单只控制通知采集，不影响手动粘贴。

### 5.3 通知使用权

- 使用 `NotificationManagerCompat.getEnabledListenerPackages(context)` 判断通知监听是否已授权。
- 未授权时引导用户打开 `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`。
- 不申请 `POST_NOTIFICATIONS`；该权限只影响 APP 自己发布通知。
- 应用列表通过可启动应用查询生成，并在 Manifest 中增加对应的 `<queries>` 声明。

## 6. 本机消息模型与存储

### 6.1 数据结构

```text
CapturedMessage
  id: String
  source: notification | manual
  packageName: String
  notificationKey: String?
  title: String
  body: String
  receivedAt: Long
  contentHash: String
  extractedAt: Long?
  lastError: String?
  autoBlocked: Boolean
  drafts: List<ScheduleDraft>

ScheduleDraft
  id: String
  title: String
  kind: course | shift | exam | deadline | event
  location: String
  startLocal: String
  endLocal: String
  allDay: Boolean
  timeZone: String
  confidence: Double
  missingFields: List<String>
  warnings: List<String>
  status: ready | scheduled | ignored | failed
  eventId: String?
  operationId: String?
```

`startLocal/endLocal` 是不带时区的 ISO 本地时间，例如 `2026-11-27T15:00:00`。全天事件的 `endLocal` 为结束日期的次日零点。Android 使用设备请求时相同的 `ZoneId` 转换为毫秒时间戳。

### 6.2 状态派生

- `pending`：尚未抽取，也没有草稿。
- `needs_review`：存在 `ready` 草稿。
- `scheduled`：至少有一个草稿，且全部草稿为 `scheduled` 或 `ignored`。
- `ignored`：用户忽略整条消息。
- `failed`：抽取失败且没有草稿。

`extracting` 只作为 Worker 运行中的临时状态，不持久化。进程被系统杀死后，消息仍保持 `pending`，下次 Worker 启动会重新处理。

### 6.3 持久化

- 使用独立 SharedPreferences 文件 `shunshou_messages`，不复用支付样本存储。
- 消息与设置使用 JSON 保存；写操作在进程内同步串行。
- 读取时清理 30 天前记录，并将总条数限制为 200 条，优先保留较新记录。
- 应用已设置 `allowBackup=false`，本机消息不进入系统云备份。
- 退出登录、会话过期或切换账号时清空消息与白名单，并取消唯一消息处理任务。

## 7. 后台抽取与自动保存

### 7.1 Worker 调度

- 新增唯一工作名 `message-capture-drain`。
- 约束：已登录、存在网络、存在待处理消息。
- 手动粘贴消息不受通知采集总开关和白名单限制；只有自动保存受自动安排开关控制。
- 通知或手动粘贴入队后，使用 `ExistingWorkPolicy.KEEP` 防止重复任务堆积。
- 每次最多处理 10 条 `pending` 消息，按接收时间从旧到新执行。
- 处理完后如果仍有 `pending` 消息，重新入队。
- 网络错误、模型 5xx 和超时使用 WorkManager 指数退避重试。
- 隐私模式禁止出网、输入非法、模型未配置等确定性失败不重试，消息标记为 `failed` 并展示原因。

### 7.2 高置信度门槛

只有单个草稿同时满足以下条件才自动保存：

- `confidence >= 0.9`。
- 标题非空且不超过 100 字符。
- 日期和时间可以完整解析。
- 定时事件必须有明确的开始与结束时间，且结束晚于开始。
- 全天事件必须有明确日期，并按次日零点生成排他结束时间。
- `missingFields` 为空，`warnings` 为空。
- 开始时间不早于当前时间前 5 分钟。
- 开始时间不晚于当前时间后 2 年。
- 地点不超过 200 字符，类型属于现有日程枚举。
- 自动安排开关已开启。

任一条件不满足时，草稿状态为 `ready`，等待用户编辑或忽略，不写入日程。

### 7.3 去重与幂等

消息去重键：

```text
SHA-256(packageName + "|" + notificationKey + "|" + normalizedBody)
```

手动消息使用 UUID 作为本地 ID。

日程去重键：

```text
SHA-256(normalizedTitle + "|" + start + "|" + end + "|" + normalizedLocation)
```

- `event.id = "msg-" + 日程去重键前 32 位`
- `event.source = "manual"`
- `event.sourceId = "message:" + 日程去重键前 32 位`
- `operationId = "message-save-" + event.id`

自动保存前先读取最新 planner：

- 如果相同事件 ID 已存在，直接关联该事件并标记 `scheduled`，不覆盖用户可能已经做过的编辑。
- 不存在时执行 `put/events`。
- 遇到 409 时重新读取 revision，并使用相同 `operationId` 和相同命令重试一次。
- 网络重试或进程恢复后再次执行时，服务端 operation receipt 保证同一操作不会重复应用。

### 7.4 撤销与删除

- 撤销时通过 planner `delete/events` 删除对应事件，操作 ID 为 `message-undo-<eventId>`。
- 删除成功后，草稿标记为 `ignored`，整条消息设置 `autoBlocked=true`。
- `autoBlocked` 消息不会再次进入自动抽取和自动保存队列。
- 用户仍可从详情手动修改并重新保存。
- 删除失败时保持 `scheduled` 状态并提示重试，不制造“已撤销”的假象。

## 8. 云端抽取接口

### 8.1 路由

新增：

```text
POST /api/assistant/extract
```

请求：

```json
{
  "text": "明天下午三点在图书馆讨论项目，预计一小时",
  "title": "项目群",
  "sourcePackage": "com.tencent.mm",
  "now": "2026-11-26T20:00:00+08:00",
  "timeZone": "Asia/Shanghai"
}
```

约束：

- `text` 必填，1 到 4000 字符。
- `title` 最多 200 字符。
- `sourcePackage` 最多 200 字符。
- `now` 必须为合法 ISO 时间。
- `timeZone` 必须为合法 IANA 时区。
- 单条消息最多返回 10 个草稿。

响应：

```json
{
  "ok": true,
  "events": [
    {
      "title": "讨论项目",
      "kind": "event",
      "location": "图书馆",
      "startLocal": "2026-11-27T15:00:00",
      "endLocal": "2026-11-27T16:00:00",
      "allDay": false,
      "timeZone": "Asia/Shanghai",
      "confidence": 0.96,
      "missingFields": [],
      "warnings": []
    }
  ],
  "model": "site-configured-model"
}
```

没有明确日程时返回 `events: []`，不要求模型编造结果。

### 8.2 模型调用

- 复用 `resolveModel`、`providerChat`、`createRedactor` 和现有站点模型配置。
- 请求中不传 `tools`。
- 使用 `response_format: { type: "json_object" }`、低温度和流式关闭。
- 提示词提供请求中的当前时间、时区和日期，要求只输出 JSON。
- 日期或时间不明确时，必须放入 `missingFields` 或 `warnings`，不得猜测后标高置信度。
- 隐私模式为 `redact` 时先脱敏发送，返回后还原标题和地点中的占位符。
- 不保存原始消息，不读取或修改 planner 文档。

### 8.3 服务端校验

模型返回必须整体通过以下校验，否则返回 `502 extract_invalid_response`：

- 顶层包含 `events` 数组。
- 草稿数量不超过 10。
- 标题、类型、地点、时间、全天标记、时区、置信度、缺失字段和警告字段类型正确。
- 本地时间严格匹配 `YYYY-MM-DDTHH:mm:ss`，并且是真实日期。
- 结束时间晚于开始时间。
- 全天事件开始和结束都必须是零点。
- 置信度在 0 到 1 之间。
- 时区与请求时区一致。

## 9. 日程写入模型改造

安卓 `PlannerEvent` 当前缺少 `timeZone` 和 `sourceId`，缓存时还会硬编码为空。为实现跨时区保存和来源追溯：

- 在 `PlannerEvent` 增加 `timeZone: String` 和 `sourceId: String`。
- 解析 planner 和日历时保留这两个字段；缺失时使用系统时区和空来源 ID。
- 新增统一的 `Models.eventJson(event)`，供 planner 缓存、日历上传和日程写入共用。
- 写入前校验标题、类型、地点、毫秒时间戳、时区、来源和 `end > start`。
- 现有只读日程页继续使用新增字段，不改变展示逻辑。
- 不新增 `message` 来源枚举，避免扩大 Web、vendor domain 和云端 schema 的改动面。

## 10. UI 设计

### 10.1 入口

- 首页新增“采集消息”纸签入口，并显示待处理条数。
- 使用现有 `PaperQuickAction`、`PaperNote`、`PageHeader`、`PaperListRow` 和纸胶带视觉，不新增底部 Tab。
- `AppRoot` 新增 `capture` 路由。

### 10.2 CaptureScreen

页面包含：

1. 手动粘贴输入区与“采集并识别”按钮。
2. 通知授权状态卡片；未授权时提供系统设置入口。
3. 消息列表，按接收时间倒序展示来源、时间、正文摘要和状态。
4. 消息详情：完整原文、识别警告、草稿列表。
5. 草稿编辑：标题、类型、地点、日期、开始时间、结束时间、全天开关。
6. 操作：保存日程、重新识别、忽略、删除消息。
7. 已安排草稿：查看关联日程、撤销。

日期和时间使用 Material 3 日期/时间选择器；所有确认按钮保持至少 48dp 触控高度。

### 10.3 MeScreen

新增“消息采集”设置卡片：

- 通知使用权状态与授权入口。
- 消息采集总开关。
- 自动安排开关。
- 应用白名单选择。
- 隐私说明：只采集白名单通知、原始消息仅存本机、按现有助手隐私模式出网、最多 200 条/30 天。
- 清空本机消息按钮。

保留现有 Shizuku、日历、支付采集入口，不做隐藏或替换。

### 10.4 状态反馈

- 自动保存成功后，CaptureScreen 的草稿和首页待处理数立即更新。
- 打开 APP 时刷新 planner，CaptureScreen 根据已安排草稿展示关联日程。
- 撤销按钮在消息详情中常驻，不依赖易错过的 Snackbar。
- 失败原因使用用户可理解的中文，例如“模型未配置”“隐私模式禁止出网”“网络不通，稍后重试”。

## 11. 安全与隐私

- 不记录通知正文、消息草稿或模型请求正文到 Logcat。
- 默认不采集任何通知，必须由用户开启并选择白名单。
- 验证码、支付和锁屏私密通知不进入收件箱。
- 原始消息只保存在本机；云端接口不持久化消息正文。
- 模型出网遵循 `redact` 与 `local-only` 设置。
- 退出登录和会话过期时清空本机消息，避免跨账号泄露。
- 自动保存只开放既有 `manual` 来源，不扩大服务端可写类型。
- 自动写入使用稳定 ID 和 operation ID，避免重试产生重复日程。

## 12. 主要文件变更

### 新增 Android

- `app/src/main/java/com/shunshou/app/capture/MessageModels.kt`
- `app/src/main/java/com/shunshou/app/capture/MessageInboxCodec.kt`
- `app/src/main/java/com/shunshou/app/capture/MessageInboxStore.kt`
- `app/src/main/java/com/shunshou/app/capture/MessageNotificationCapture.kt`
- `app/src/main/java/com/shunshou/app/capture/MessageExtractionWorker.kt`
- `app/src/main/java/com/shunshou/app/capture/ScheduleDraftPolicy.kt`
- `app/src/main/java/com/shunshou/app/data/PlannerEventSync.kt`
- `app/src/main/java/com/shunshou/app/ui/CaptureScreen.kt`
- `app/src/main/java/com/shunshou/app/ui/components/CaptureControls.kt`

### 修改 Android

- `app/src/main/AndroidManifest.xml`：增加可启动应用查询声明。
- `app/src/main/java/com/shunshou/collector/PaymentNotificationListener.kt`：分发普通通知。
- `app/src/main/java/com/shunshou/app/data/Models.kt`：补全事件字段和统一 JSON。
- `app/src/main/java/com/shunshou/app/data/ShunshouApi.kt`：增加抽取请求和长超时支持。
- `app/src/main/java/com/shunshou/app/data/AppRepository.kt`：暴露消息状态、手动保存、撤销和清理。
- `app/src/main/java/com/shunshou/app/data/SessionStore.kt`：退出登录时清理消息存储。
- `app/src/main/java/com/shunshou/app/AppRoot.kt`：增加 capture 路由。
- `app/src/main/java/com/shunshou/app/ui/HomeScreen.kt`：增加采集入口和待处理数。
- `app/src/main/java/com/shunshou/app/ui/MeScreen.kt`：增加消息采集设置。

### 新增或修改云端

- `functions/assistant.mjs`：增加 `extractSchedule` 方法、提示词、结果解析与校验。
- `functions/routes.mjs`：增加 `/api/assistant/extract` 路由。
- `functions/assistant.test.mjs`：增加抽取、脱敏、隐私和非法结果测试。
- `functions/routes.test.mjs`：增加路由契约测试。

## 13. 测试与验收

### 13.1 云端测试

- 抽取请求不包含 `tools`，不触发 planner 写入。
- 返回结构化草稿并保留请求时区。
- `redact` 模式发送前脱敏，返回后正确还原。
- `local-only` 模式拒绝远程模型。
- 模型未配置、超时、非法 JSON、非法日期和非法字段返回明确错误。
- 空消息、超长消息和非法时区在入口被拒绝。
- 路由要求登录，未登录返回 401。

### 13.2 Android JVM 测试

- MessagingStyle 最新消息提取与普通通知回退。
- 验证码、ongoing、group summary、私密通知、非白名单应用过滤。
- 相同通知重复投递只保留一条，内容变化生成新消息。
- 收件箱序列化、200 条上限、30 天清理和状态恢复。
- 高置信度门槛：缺失时间、过去事件、超过两年、非法结束时间均不自动保存。
- 本地时间转毫秒、全天事件次日零点、时区保留。
- 日程稳定 ID、完整事件 JSON 和写入前校验。

### 13.3 真机验收

使用既有 PLG110 / Android 17 设备验证：

1. 未开启通知权限时，手动粘贴仍可使用。
2. 开启通知使用权，选择微信白名单，收到“明天下午三点开会”后自动创建日程。
3. 相同通知重复投递不重复创建。
4. 低置信度消息进入待处理，可编辑后保存。
5. 自动创建的日程可撤销，撤销后不再自动恢复。
6. 验证码通知不进入收件箱。
7. 关闭自动安排后只生成草稿，不写日程。
8. 断网后恢复网络能够继续处理，且不重复创建。
9. 退出登录后本机消息与白名单清空。
10. 现有支付采集、Shizuku、日历同步和手账页面无回归。

### 13.4 构建验证

- 运行 `functions` 包的 Node 测试。
- 使用本机缓存的 Gradle 8.9 运行 Android JVM 测试和 `assembleDebug`。
- 安装到真机并完成上述 golden path。
- 如遇 USB 掉线或“屏幕过近”遮罩，按既有真机排障流程处理，不修改无关代码。

## 14. 实施顺序

1. 云端只抽取接口与测试。
2. Android 消息模型、过滤、去重和本机收件箱。
3. WorkManager 抽取与高置信度自动保存。
4. PlannerEvent 字段补全、幂等写入和撤销。
5. CaptureScreen、首页入口和 MeScreen 设置。
6. 真机验收与回归测试。

每个步骤独立可验证，先打通“手动粘贴 → 抽取 → 自动保存 → 撤销”，再启用通知后台链路。
