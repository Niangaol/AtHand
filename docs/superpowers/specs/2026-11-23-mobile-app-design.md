# 顺手 · 手机 App 重做与账号功能（演示版）

- 日期：2026-11-23
- 状态：已实现（2026-11-23 起执行）
- 范围：原生 Android 客户端重做 + 云端账号 + Web 手机布局调整
- 交付：2026-11-30 前可演示

## 1. 要解决什么

当前「顺手」有两个入口，但都不到位：

- **网页**：功能完整，账号体系完整，桌面体验好；手机浏览器能用，但底部无导航、信息密度按桌面设计，不像 App。
- **安卓 App**：叫「顺手采集」，本质是调试面板——XML 界面、无账号、只能扫码连电脑。演示时无法作为「手机 App」展示。

目标：

1. 把安卓端从「采集探针」重做成**原生完整客户端**，能登录、看首页、记账、看账本、看日程、做专注。
2. 账号**接到云端 Qoder Sites**，不依赖电脑开机，多设备同一份数据。
3. 视觉**平移「纸与墨」**设计语言，让 App 和网页是同一个产品。
4. 网页在手机宽度下的布局同步调整，桌面端不动。

## 2. 非目标

- 不做 iOS。
- 不做离线写队列（在线优先，写失败明确提示重试）。
- 不在手机端实现图表、旅记、校园、生活服务、AI 助手（网页保留）。
- 不做推送通知、后台常驻同步。
- 不改云端后端接口（已实测够用）。
- 不做应用商店上架，APK 直接安装。

## 3. 现状约束（已实测）

| 项 | 结论 |
|---|---|
| 云端接口 | `/api/register` `/api/login` `/api/account/*` `/api/me` `/api/ledger` `/api/calendar` `/api/planner` `/api/samples` 全部可用 |
| 云端助手 | `/api/assistant/*` 返回 503，**手机端不做助手** |
| 跨域 | 网关按 Origin 校验：无 Origin 或陌生 Origin → 403；带站点 Origin → 通过 |
| 鉴权头 | `Authorization: Bearer <token>`，云端同时接受 `X-Shunshou-Session` |
| 站点地址 | `https://athand-qnvq63y722x.qoder.zone`，函数前缀 `/functions/v1/app` |
| 构建链 | Gradle 8.9 / JDK 21 / SDK 35 / build-tools 35 均在本机；Google Maven 可达 |
| 验证设备 | 本机无真机、无模拟器；由用户手机安装 APK 验证 |
| 采集代码 | 通知监听、无障碍、日历 Worker、Shizuku、OCR 均已存在，重做时保留 |

## 4. 架构

```
┌─ 手机 App（Kotlin + Compose）────────────────┐
│  UI: Compose 页面（首页/账本/日程/专注/我的）    │
│  Data: ShunshouApi（HttpURLConnection）       │
│        SessionStore（SharedPreferences 加密）  │
│        AppRepository（内存状态 + 读缓存）        │
│  Collect: PaymentNotification / Accessibility │
│           CalendarWorker / Shizuku（保留）     │
└───────────────┬──────────────────────────────┘
                │ HTTPS + Bearer + Origin
                ▼
   Qoder Sites 云端函数 /functions/v1/app
   ├─ /api/register /api/login /api/me
   ├─ /api/account/*（改密/会话/注销）
   ├─ /api/ledger（GET/PUT，LWW + baseUpdatedAt）
   ├─ /api/planner（GET + POST operations，revision 校验）
   └─ /api/samples（GET/POST 批量合并）
```

- **单一数据源是云端**。App 启动拉取，操作后回写；不做本地权威副本。
- **采集器保留**：支付样本仍走 `/api/samples`，日历仍走 `/api/calendar/snapshot`；采集开关在「我的」页。
- **配对码**：保留「扫码配对」作为兼容路径，但主路径改为账号登录。
- **包结构边界**：新界面与网络层放 `com.shunshou.app.*`；旧采集类（`PaymentNotificationListener`、`PaymentAccessibilityService`、`CalendarWorker`、`ShizukuBridge`、`SampleStore` 等）原地保留，只把 `MainActivity` 的启动入口切到 `app.MainActivity`。旧 XML 布局与旧类暂不删除，D7 确认无引用后再清理。

## 5. 连通层设计

`ShunshouApi` 一个类承担全部 HTTP：

- 固定注入 `Origin: https://athand-qnvq63y722x.qoder.zone`（可被调试设置覆盖）。
- 统一超时：连接 8s、读取 15s。
- 统一错误映射：401 → 会话失效，跳登录；403 → 「服务地址不被允许」；409 → 「数据在别处被修改」；5xx → 「云端暂时不可用」。
- JSON 用 `org.json`（Android 平台自带，无需新依赖）。

**会话**：`SessionStore` 保存 `baseUrl / token / expiresAt / username`，启动时若 `expiresAt - now < 60s` 则视为未登录。token 存 `SharedPreferences`（`MODE_PRIVATE`），不引入额外的加密依赖；App 未开启 `allowBackup`，token 不会进云备份。

**读缓存**：上次成功的 `ledger / planner` JSON 存 SharedPreferences，冷启动先渲染缓存再刷新，避免白屏。

## 6. 数据模型（Kotlin 侧最小子集）

```kotlin
data class RecordEntry(
  val id: String, val type: String,        // work | expense
  val date: String,                        // yyyy-MM-dd
  val title: String,
  val amountCents: Long,
  val category: String?,                   // expense
  val workplaceId: String?,                // work
  val startTime: String?, val endTime: String?,
  val durationMinutes: Int?, val hourlyRateCents: Long?,
  val source: String,                      // demo | manual | school | import
  val updatedAt: String?, val deletedAt: String?
)
data class Workplace(val id: String, val name: String, val hourlyRateCents: Long, val description: String, val source: String)
data class LedgerState(val version: Int, val records: List<RecordEntry>, val workplaces: List<Workplace>, val settings: Settings)

data class PlannerEvent(
  val id: String, val title: String, val kind: String, val location: String,
  val start: Long, val end: Long, val allDay: Boolean, val timeZone: String,
  val source: String, val sourceId: String
)
data class FocusSession(
  val id: String, val task: String, val minutes: Int, val startedAt: Long,
  val status: String, val segments: List<FocusSegment>, val owner: String, val epoch: Int
)
```

- 金额一律 `Long` 分，不用浮点。
- 时间戳一律 `Long` 毫秒（UTC），展示时转本地。
- 字段名与 JSON 一致，用 `optString/optLong` 容错解析。

## 7. 页面与交互

### 7.1 信息架构

底部 4 Tab + 2 个全屏页：

```
Tab 首页   → 今日简报、快捷入口（记一笔 / 专注）
Tab 账本   → 本周账单、汇总、周切换
Tab 日程   → 本周时间线、今天高亮
Tab 我的   → 账号、采集开关、同步状态、配对码、退出
全屏 记一笔 → 支出 / 收入 / 工时
全屏 专注   → 计时器（开始/暂停/完成）
全屏 登录/注册
```

### 7.2 各页要点

**登录/注册**：账号 + 密码 + （注册时）确认密码；云端地址默认内置，折叠在「高级」里；错误就地显示；成功后进首页。

**首页**：今日收支两个数字（宋体大号）、今日安排 3 条、进行中的专注（若有）、两个大按钮。空态给一句引导文案，不留白。

**记一笔**：默认支出；分类选择用横向 chip；金额是第一焦点；保存后回首页并轻提示。

**账本**：按日分组列表，每行「标题 · 分类 → 金额」；顶部合计条（双线压顶）；周切换箭头；左右滑动切换周。

**日程**：本周 7 天纵向列表（不是横向周视图，手机竖屏更易读）；今天是淡绿底 + 红刻度；每条显示「时间 · 标题 · 地点」。

**专注**：大号倒计时、任务名、开始/暂停/完成；后台计时用 `startedAt + segments` 计算，不依赖定时器精度。`focus.start` 需带 `owner`（本机安装 ID，首次启动生成并持久化）；`focus.control` 需带 `owner` 与 `epoch`（从当前会话对象读取；`startFocus` 初始为 1，每次 `takeover` 加一），用于多设备抢占判定。

**我的**：账号名 + 注册时间、采集开关（无障碍授权状态）、最近同步时间、生成配对码、退出登录。

### 7.3 交互规则

- 所有写操作先本地乐观更新 UI，失败回滚并提示。
- 账本 PUT 冲突（409）→ 提示「数据在别处更新了，已为你刷新」，自动重拉。
- Planner 操作带 `baseRevision`，冲突同样重拉。
- 触控目标 ≥ 48dp，底部导航 ≥ 56dp。

## 8. 视觉（平移纸与墨）

| 令牌 | 值 |
|---|---|
| 纸 | `#f2f3ee`（页面）、`#fdfdf9`（纸面）、`#e0e2d8`（细分隔线） |
| 墨 | `#1c1f1a`（主文字）、`#464c43`（次文字）、`#666c60`（说明） |
| 色 | `#2f5a45`（墨绿，收入/主按钮）、`#9e3b27`（印泥红，支出/强调）、`#4b6067`（钢蓝，同步） |

- **字体**：标题用 `NotoSerifSC`（通过 `res/font` 内置或系统宋体 fallback）；正文用系统黑体；数字用 `FontFeatureSetting("tnum")`。
- **结构**：不用卡片墙；数据区用 1px 线分段；只有可点击块才给圆角和底色。
- **圆角**：4dp / 6dp / 8dp 三档，与 Web 一致；无阴影（弹层除外）。
- **动效**：200ms `easeOut`，`prefers-reduced-motion` 对应的系统「移除动画」开关生效。

## 9. Web 手机布局调整（仅 ≤640px）

- 侧栏导航改为**底部固定 Tab**（首页 / 账本 / 日程 / 我的 / 更多），桌面侧栏不变。
- 首页、账本、设置页在窄屏改为单列，卡片内边距 16px。
- 隐藏装饰性元素（侧栏便签、页脚双列）。
- 桌面端（>640px）零改动。

## 10. 实施顺序（7 天）

| 日 | 内容 | 完成标志 |
|---|---|---|
| D1 | Compose 骨架、主题、底部导航、`ShunshouApi` + `SessionStore` | 能编译出 APK，登录页可打开 |
| D2 | 登录/注册接通云端，会话持久化，首页骨架 | 真机登录成功，冷启动保持登录 |
| D3 | 首页简报 + 记一笔（支出/收入/工时） | 记一笔后云端有数据 |
| D4 | 账本页（周列表 + 汇总 + 周切换） | 与网页数据一致 |
| D5 | 日程页 + 专注页 | 日程读得到，专注可开始/完成 |
| D6 | 我的页（账号/采集开关/配对码/退出）+ Web 手机布局 | 采集开关可用，Web 窄屏有底部 Tab |
| D7 | 构建 release APK、真机走查、演示彩排、修 bug | APK 可安装，主流程无阻断 |

**砍范围顺序**（时间不够时从后往前砍）：专注 → 日程 → 工时类记账 → Web 窄屏调整。**登录 + 首页 + 支出记账 + 账本**不可砍。

## 11. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| 无真机/模拟器，界面只能靠用户手机验 | 视觉问题发现晚 | D2 先给可安装 APK，尽早装；每完成一页就装一次 |
| 云端 Origin 校验策略变化 | App 全部请求 403 | 403 文案明确提示；保留可覆盖 Origin 的调试项 |
| Compose 首次构建下载依赖慢 | D1 延误 | 已实测 Google Maven 可达；提前在 D1 触发一次构建 |
| 采集侧改动引发权限/崩溃 | 演示翻车 | 采集逻辑只做「开关 + 状态展示」，不改解析代码 |
| 工作树有 5000 行未提交改动 | 冲突、误覆盖 | 按用户决定直接叠加；新代码放独立包 `com.shunshou.app.*`，旧采集文件不动，只在清单里切换启动 Activity |

## 12. 验收

1. 真机安装 APK，冷启动进登录页；注册新账号能进首页。
2. 首页显示今日收支与今日安排，数据与网页同账号一致。
3. 记一笔支出后，网页刷新能看到该笔。
4. 账本页周切换正确，合计与网页一致。
5. 日程页显示本周条目，今天高亮。
6. 专注可开始、暂停、完成，网页能看到记录。
7. 「我的」可退出登录，退出后回到登录页；采集开关状态与系统设置一致。
8. Web 在 375px 宽度下出现底部 Tab，无横向溢出；桌面端视觉无变化。
9. `./gradlew assembleDebug` 与 `npm run build` 均通过。
