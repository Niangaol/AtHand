# 手机 App 重做与账号功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `顺手采集` 安卓探针重做成原生完整客户端（Kotlin + Compose），账号接云端 Qoder Sites，视觉平移「纸与墨」，并同步调整 Web 手机布局。

**Architecture:** 新代码集中在 `android/app/src/main/java/com/shunshou/app/`（UI/网络/状态），旧采集类原地保留不动，只把启动 Activity 切到新入口。云端是唯一数据源：`ShunshouApi` 用 `HttpURLConnection` 直连云函数，所有请求固定带 `Origin` 与 `Bearer`。在线优先、读缓存、不做离线写队列。

**Tech Stack:** Kotlin 2.0.21 · Jetpack Compose (BOM 2024.12.01) · Material3 · navigation-compose 2.8.7 · lifecycle-viewmodel-compose 2.8.7 · org.json · Gradle 8.9 / AGP 8.7.3 / JDK 17 target

**Spec:** `docs/superpowers/specs/2026-11-23-mobile-app-design.md`

## Global Constraints

- 云端函数前缀：`https://athand-qnvq63y722x.qoder.zone/functions/v1/app`
- 所有请求必须带 `Origin: https://athand-qnvq63y722x.qoder.zone`（网关按 Origin 校验，缺失或陌生直接 403）
- 鉴权头：`Authorization: Bearer <token>`
- 金额一律 `Long` 分；时间戳一律 `Long` 毫秒；日期 `yyyy-MM-dd`
- 触控目标 ≥ 48dp；底部导航 ≥ 56dp
- 视觉令牌：纸 `#f2f3ee` / 纸面 `#fdfdf9` / 线 `#e0e2d8` / 墨 `#1c1f1a` / 次墨 `#464c43` / 说明 `#666c60` / 墨绿 `#2f5a45` / 印泥红 `#9e3b27` / 钢蓝 `#4b6067`
- 圆角仅 4/6/8dp 三档；无阴影（弹层除外）；动效 200ms easeOut
- 包名：`com.shunshou.collector` 不变；新类包路径 `com.shunshou.app.*`
- 不改旧采集类逻辑；不改云端后端；不改 Web 桌面端（>640px）
- 记录 `source` 合法值：`demo | manual | school | import`
- 账本写接口：`PUT /api/ledger` body `{ledger, baseUpdatedAt, force?}`；409 冲突需重拉
- Planner 写接口：`POST /api/planner/operations` body `{operationId, baseRevision, command}`；409 冲突需重拉
- `focus.start` 命令：`{kind, id, task, minutes, owner}`；`focus.control`：`{kind, id, action, owner, epoch}`（epoch 取自会话对象，初始 1）

## File Structure

**新建（Android）**

| 文件 | 职责 |
|---|---|
| `app/src/main/java/com/shunshou/app/MainActivity.kt` | 新启动入口：Compose host + 导航宿主 |
| `app/src/main/java/com/shunshou/app/data/ShunshouApi.kt` | 全部 HTTP：注册/登录/账本/planner/账号 |
| `app/src/main/java/com/shunshou/app/data/SessionStore.kt` | token/用户名/安装 ID 持久化 |
| `app/src/main/java/com/shunshou/app/data/Models.kt` | RecordEntry / LedgerState / PlannerSnapshot 等数据类与 JSON 解析 |
| `app/src/main/java/com/shunshou/app/data/AppRepository.kt` | 单一状态源：拉取、缓存、写回、错误映射 |
| `app/src/main/java/com/shunshou/app/domain/LedgerMath.kt` | 周汇总、分类合计（纯函数） |
| `app/src/main/java/com/shunshou/app/ui/theme/Theme.kt` | 纸与墨 Material3 主题、字体、颜色 |
| `app/src/main/java/com/shunshou/app/ui/components/Common.kt` | 顶栏、分隔线、数字文本、空态 |
| `app/src/main/java/com/shunshou/app/ui/LoginScreen.kt` | 登录/注册 |
| `app/src/main/java/com/shunshou/app/ui/HomeScreen.kt` | 首页简报 + 快捷入口 |
| `app/src/main/java/com/shunshou/app/ui/EntryScreen.kt` | 记一笔（支出/收入/工时） |
| `app/src/main/java/com/shunshou/app/ui/LedgerScreen.kt` | 周账单 |
| `app/src/main/java/com/shunshou/app/ui/ScheduleScreen.kt` | 本周日程 |
| `app/src/main/java/com/shunshou/app/ui/FocusScreen.kt` | 专注计时 |
| `app/src/main/java/com/shunshou/app/ui/MeScreen.kt` | 我的：账号/采集开关/退出 |
| `app/src/test/java/com/shunshou/app/domain/LedgerMathTest.kt` | 汇总纯函数单测 |
| `app/src/test/java/com/shunshou/app/data/ModelsTest.kt` | JSON 解析单测 |

**修改（Android）**

| 文件 | 改动 |
|---|---|
| `android/app/build.gradle.kts` | 加 Compose、navigation、lifecycle 依赖与 buildFeatures |
| `android/build.gradle.kts` | 加 compose compiler 插件声明 |
| `android/app/src/main/AndroidManifest.xml` | 启动 Activity 指向 `com.shunshou.app.MainActivity`；旧 MainActivity 改为非 launcher（保留调试入口） |

**修改（Web，仅 ≤640px）**

| 文件 | 改动 |
|---|---|
| `src/app/Shell.tsx` | 窄屏渲染底部 Tab（复用 `navigation` 前四项 + 更多） |
| `src/styles.css` | 新增 ≤640px 底部 Tab 样式；隐藏装饰元素 |

**不改动**：`com.shunshou.collector.*` 下所有采集类、`PaymentParser`、`CalendarWorker`、`ShizukuBridge`、`SampleStore`、旧 XML 布局。

---

## Task 1: Compose 构建基线

**Files:**
- Modify: `android/build.gradle.kts`
- Modify: `android/app/build.gradle.kts`
- Create: `android/app/src/main/java/com/shunshou/app/MainActivity.kt`
- Create: `android/app/src/main/java/com/shunshou/app/ui/theme/Theme.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: 无
- Produces: `ShunshouTheme(content: @Composable () -> Unit)`；`Paper` 颜色对象；`Type` 文本样式；`Dimens` 尺寸；`com.shunshou.app.MainActivity` 作为 launcher

- [ ] **Step 1: 在根 build.gradle.kts 声明 compose 编译器插件**

```kotlin
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
```

- [ ] **Step 2: 在 app/build.gradle.kts 启用 Compose 并加依赖**

plugins 块追加一行 `id("org.jetbrains.kotlin.plugin.compose")`。android 块内加：

```kotlin
buildFeatures { compose = true }
```

dependencies 追加：

```kotlin
implementation(platform("androidx.compose:compose-bom:2024.12.01"))
implementation("androidx.compose.ui:ui")
implementation("androidx.compose.material3:material3")
implementation("androidx.compose.material:material-icons-extended")
implementation("androidx.activity:activity-compose:1.9.3")
implementation("androidx.navigation:navigation-compose:2.8.7")
implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
```

- [ ] **Step 3: 写主题文件**

`app/src/main/java/com/shunshou/app/ui/theme/Theme.kt`：

```kotlin
package com.shunshou.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object Paper {
    val page = Color(0xFFF2F3EE)
    val sheet = Color(0xFFFDFDF9)
    val rule = Color(0xFFE0E2D8)
    val ruleStrong = Color(0xFFC1C5B5)
    val ink = Color(0xFF1C1F1A)
    val inkSoft = Color(0xFF464C43)
    val muted = Color(0xFF666C60)
    val brand = Color(0xFF2F5A45)
    val brandDeep = Color(0xFF1F4030)
    val brandWash = Color(0x142F5A45)
    val red = Color(0xFF9E3B27)
    val redWash = Color(0x129E3B27)
    val steel = Color(0xFF4B6067)
}

private val scheme = lightColorScheme(
    primary = Paper.brand,
    onPrimary = Color.White,
    secondary = Paper.steel,
    background = Paper.page,
    onBackground = Paper.ink,
    surface = Paper.sheet,
    onSurface = Paper.ink,
    surfaceVariant = Paper.page,
    onSurfaceVariant = Paper.inkSoft,
    error = Paper.red,
)

val Serif = FontFamily.Serif
val Sans = FontFamily.SansSerif

object Type {
    val pageTitle = TextStyle(fontFamily = Serif, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, lineHeight = 34.sp, color = Paper.ink)
    val sectionTitle = TextStyle(fontFamily = Sans, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, lineHeight = 24.sp, color = Paper.ink)
    val body = TextStyle(fontFamily = Sans, fontSize = 14.sp, fontWeight = FontWeight.Normal, lineHeight = 24.sp, color = Paper.ink)
    val caption = TextStyle(fontFamily = Sans, fontSize = 12.sp, fontWeight = FontWeight.Normal, lineHeight = 21.sp, color = Paper.muted)
    val figureLarge = TextStyle(fontFamily = Serif, fontSize = 38.sp, fontWeight = FontWeight.Medium, lineHeight = 50.sp, color = Paper.ink, fontFeatureSettings = "tnum")
    val figure = TextStyle(fontFamily = Serif, fontSize = 17.sp, fontWeight = FontWeight.Medium, lineHeight = 26.sp, color = Paper.ink, fontFeatureSettings = "tnum")
}

object Dimens {
    val gutter = 16.dp
    val rSm = 4.dp
    val rMd = 6.dp
    val rLg = 8.dp
}

@Composable
fun ShunshouTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}
```

- [ ] **Step 4: 写最小 MainActivity，先只显示标题**

`app/src/main/java/com/shunshou/app/MainActivity.kt`：

```kotlin
package com.shunshou.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.shunshou.app.ui.theme.ShunshouTheme
import com.shunshou.app.ui.theme.Type

@Composable
private fun Placeholder() {
    Scaffold { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
            Text("顺手", style = Type.pageTitle)
        }
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ShunshouTheme { Placeholder() } }
    }
}
```

- [ ] **Step 5: 切换 Manifest 启动入口**

把现有 `MainActivity` 的 `<intent-filter>` 整体移到新的 `com.shunshou.app.MainActivity` 上，旧 Activity 保留但去掉 intent-filter 并设为 `exported="false"`：

```xml
<activity
    android:name="com.shunshou.app.MainActivity"
    android:exported="true"
    android:label="顺手"
    android:theme="@android:style/Theme.Material.Light.NoActionBar">
    <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter>
</activity>

<activity
    android:name=".MainActivity"
    android:exported="false"
    android:theme="@android:style/Theme.Material.Light.NoActionBar" />
```

- [ ] **Step 6: 构建验证**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" assembleDebug`
Expected: `BUILD SUCCESSFUL`，产物 `android/app/build/outputs/apk/debug/app-debug.apk`

- [ ] **Step 7: 提交**

```bash
git add android/build.gradle.kts android/app/build.gradle.kts android/app/src/main/java/com/shunshou/app android/app/src/main/AndroidManifest.xml
git commit -m "feat(app): Compose 构建基线与主题"
```

---

## Task 2: 数据模型与 JSON 解析

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/data/Models.kt`
- Test: `android/app/src/test/java/com/shunshou/app/data/ModelsTest.kt`

**Interfaces:**
- Consumes: 无
- Produces:
  - `data class UserSummary(val id: String, val username: String)`
  - `data class Workplace(val id: String, val name: String, val hourlyRateCents: Long, val description: String, val source: String)`
  - `data class RecordEntry(val id: String, val type: String, val date: String, val title: String, val amountCents: Long, val category: String?, val workplaceId: String?, val startTime: String?, val endTime: String?, val durationMinutes: Int?, val hourlyRateCents: Long?, val source: String)`
  - `data class LedgerState(val version: Int, val records: List<RecordEntry>, val workplaces: List<Workplace>, val hourlyRateCents: Long)` + `LedgerState.EMPTY`
  - `data class PlannerEvent(val id: String, val title: String, val kind: String, val location: String, val start: Long, val end: Long, val allDay: Boolean, val source: String)`
  - `data class FocusSession(val id: String, val task: String, val minutes: Int, val startedAt: Long, val status: String, val segments: List<Long?>, val owner: String, val epoch: Int)`
  - `data class PlannerSnapshot(val revision: Int, val events: List<PlannerEvent>, val focusSessions: List<FocusSession>, val focusMinutes: Int)` + `PlannerSnapshot.EMPTY`
  - `Models.parseLedger(body: JSONObject): LedgerState`
  - `Models.parsePlanner(body: JSONObject): PlannerSnapshot`
  - `Models.recordJson(record: RecordEntry): JSONObject`
  - `Models.ledgerJson(state: LedgerState): JSONObject`

- [ ] **Step 1: 写失败测试**

`app/src/test/java/com/shunshou/app/data/ModelsTest.kt`：

```kotlin
package com.shunshou.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelsTest {
    @Test
    fun parsesLedgerResponse() {
        val body = JSONObject(
            """{"ok":true,"ledger":{"version":1,"records":[
                 {"id":"r1","type":"expense","date":"2026-11-23","title":"午饭",
                  "amountCents":1850,"category":"吃饭","source":"manual"},
                 {"id":"r2","type":"work","date":"2026-11-22","title":"家教",
                  "amountCents":9000,"workplaceId":"w1","startTime":"14:00","endTime":"16:00",
                  "durationMinutes":120,"hourlyRateCents":4500,"source":"manual"}],
               "workplaces":[{"id":"w1","name":"家教","hourlyRateCents":4500,"description":"","source":"manual"}],
               "settings":{"hourlyRateCents":4500}},"updatedAt":"2026-11-23T02:00:00.000Z"}"""
        )
        val state = Models.parseLedger(body)
        assertEquals(2, state.records.size)
        assertEquals(1850L, state.records[0].amountCents)
        assertEquals("吃饭", state.records[0].category)
        assertEquals(120, state.records[1].durationMinutes)
        assertEquals(4500L, state.workplaces[0].hourlyRateCents)
        assertEquals(4500L, state.hourlyRateCents)
    }

    @Test
    fun toleratesNullLedger() {
        val state = Models.parseLedger(JSONObject("""{"ok":true,"ledger":null}"""))
        assertEquals(0, state.records.size)
        assertEquals(0L, state.hourlyRateCents)
    }

    @Test
    fun parsesPlannerResponse() {
        val body = JSONObject(
            """{"state":{"version":1,"events":[{"id":"e1","title":"课","kind":"course",
                 "location":"A101","start":1795000000000,"end":1795003600000,"allDay":false,
                 "timeZone":"Asia/Shanghai","source":"manual","sourceId":""}],
                "courseRules":[],"focusSessions":[{"id":"f1","task":"看书","minutes":25,
                 "startedAt":1795000000000,"status":"running","segments":[{"start":1795000000000,"end":null}],
                 "owner":"dev1","epoch":1}],
                "countdowns":[],"trips":[],"serviceEntries":[],
                "preferences":{"focusMinutes":30},"reminderReceipts":[]},
               "revision":7}"""
        )
        val snapshot = Models.parsePlanner(body)
        assertEquals(7, snapshot.revision)
        assertEquals("课", snapshot.events[0].title)
        assertEquals(1, snapshot.focusSessions[0].epoch)
        assertNull(snapshot.focusSessions[0].segments[0])
        assertEquals(30, snapshot.focusMinutes)
    }

    @Test
    fun serializesLedgerRoundTrip() {
        val record = RecordEntry(
            id = "r1", type = "expense", date = "2026-11-23", title = "午饭",
            amountCents = 1850, category = "吃饭", workplaceId = null, startTime = null,
            endTime = null, durationMinutes = null, hourlyRateCents = null, source = "manual"
        )
        val json = Models.recordJson(record)
        assertEquals("r1", json.getString("id"))
        assertEquals(1850L, json.getLong("amountCents"))
        assertEquals("吃饭", json.getString("category"))
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" testDebugUnitTest --tests "com.shunshou.app.data.ModelsTest"`
Expected: 编译失败，`Unresolved reference: Models`

- [ ] **Step 3: 实现 Models.kt**

```kotlin
package com.shunshou.app.data

import org.json.JSONArray
import org.json.JSONObject

data class UserSummary(val id: String, val username: String)

data class Workplace(
    val id: String, val name: String, val hourlyRateCents: Long,
    val description: String, val source: String,
)

data class RecordEntry(
    val id: String, val type: String, val date: String, val title: String, val amountCents: Long,
    val category: String?, val workplaceId: String?, val startTime: String?, val endTime: String?,
    val durationMinutes: Int?, val hourlyRateCents: Long?, val source: String,
)

data class LedgerState(
    val version: Int, val records: List<RecordEntry>, val workplaces: List<Workplace>,
    val hourlyRateCents: Long,
) {
    companion object { val EMPTY = LedgerState(1, emptyList(), emptyList(), 0L) }
}

data class PlannerEvent(
    val id: String, val title: String, val kind: String, val location: String,
    val start: Long, val end: Long, val allDay: Boolean, val source: String,
)

data class FocusSession(
    val id: String, val task: String, val minutes: Int, val startedAt: Long, val status: String,
    val segments: List<Long?>, val owner: String, val epoch: Int,
)

data class PlannerSnapshot(
    val revision: Int, val events: List<PlannerEvent>, val focusSessions: List<FocusSession>,
    val focusMinutes: Int,
) {
    companion object { val EMPTY = PlannerSnapshot(0, emptyList(), emptyList(), 25) }
}

object Models {
    private fun JSONArray.objects(): List<JSONObject> =
        (0 until length()).mapNotNull { optJSONObject(it) }

    fun parseLedger(body: JSONObject): LedgerState {
        val ledger = body.optJSONObject("ledger") ?: return LedgerState.EMPTY
        val records = (ledger.optJSONArray("records") ?: JSONArray()).objects().map { row ->
            RecordEntry(
                id = row.optString("id"),
                type = row.optString("type"),
                date = row.optString("date"),
                title = row.optString("title"),
                amountCents = row.optLong("amountCents"),
                category = row.optStringOrNull("category"),
                workplaceId = row.optStringOrNull("workplaceId"),
                startTime = row.optStringOrNull("startTime"),
                endTime = row.optStringOrNull("endTime"),
                durationMinutes = row.optIntOrNull("durationMinutes"),
                hourlyRateCents = row.optLongOrNull("hourlyRateCents"),
                source = row.optString("source", "manual"),
            )
        }
        val workplaces = (ledger.optJSONArray("workplaces") ?: JSONArray()).objects().map { row ->
            Workplace(
                id = row.optString("id"), name = row.optString("name"),
                hourlyRateCents = row.optLong("hourlyRateCents"),
                description = row.optString("description"), source = row.optString("source", "manual"),
            )
        }
        val settings = ledger.optJSONObject("settings")
        return LedgerState(
            version = ledger.optInt("version", 1), records = records, workplaces = workplaces,
            hourlyRateCents = settings?.optLong("hourlyRateCents") ?: 0L,
        )
    }

    fun parsePlanner(body: JSONObject): PlannerSnapshot {
        val state = body.optJSONObject("state") ?: return PlannerSnapshot.EMPTY
        val events = (state.optJSONArray("events") ?: JSONArray()).objects().map { row ->
            PlannerEvent(
                id = row.optString("id"), title = row.optString("title"), kind = row.optString("kind"),
                location = row.optString("location"), start = row.optLong("start"), end = row.optLong("end"),
                allDay = row.optBoolean("allDay"), source = row.optString("source"),
            )
        }
        val sessions = (state.optJSONArray("focusSessions") ?: JSONArray()).objects().map { row ->
            val segments = (row.optJSONArray("segments") ?: JSONArray()).let { array ->
                (0 until array.length()).map { i -> array.optJSONObject(i)?.let { it.optLongOrNull("end") } }
            }
            FocusSession(
                id = row.optString("id"), task = row.optString("task"), minutes = row.optInt("minutes"),
                startedAt = row.optLong("startedAt"), status = row.optString("status"),
                segments = segments, owner = row.optString("owner"), epoch = row.optInt("epoch", 1),
            )
        }
        return PlannerSnapshot(
            revision = body.optInt("revision", 0), events = events, focusSessions = sessions,
            focusMinutes = state.optJSONObject("preferences")?.optInt("focusMinutes", 25) ?: 25,
        )
    }

    fun plannerJson(snapshot: PlannerSnapshot): JSONObject = JSONObject().apply {
        // 只保留客户端读取的字段，用于离线缓存；服务端解析以完整响应为准。
        put("revision", snapshot.revision)
        put("state", JSONObject().apply {
            put("version", 1)
            put("events", JSONArray().apply {
                snapshot.events.forEach { row ->
                    put(JSONObject().apply {
                        put("id", row.id); put("title", row.title); put("kind", row.kind)
                        put("location", row.location); put("start", row.start); put("end", row.end)
                        put("allDay", row.allDay); put("timeZone", "Asia/Shanghai")
                        put("source", row.source); put("sourceId", "")
                    })
                }
            })
            put("courseRules", JSONArray())
            put("focusSessions", JSONArray().apply {
                snapshot.focusSessions.forEach { row ->
                    put(JSONObject().apply {
                        put("id", row.id); put("task", row.task); put("minutes", row.minutes)
                        put("startedAt", row.startedAt); put("status", row.status)
                        put("segments", JSONArray().apply {
                            row.segments.forEach { end ->
                                put(JSONObject().apply {
                                    put("start", row.startedAt)
                                    if (end == null) put("end", JSONObject.NULL) else put("end", end)
                                })
                            }
                        })
                        put("owner", row.owner); put("epoch", row.epoch)
                    })
                }
            })
            put("countdowns", JSONArray())
            put("trips", JSONArray())
            put("serviceEntries", JSONArray())
            put("preferences", JSONObject().put("focusMinutes", snapshot.focusMinutes))
            put("reminderReceipts", JSONArray())
        })
    }

    fun recordJson(record: RecordEntry): JSONObject = JSONObject().apply {
        put("id", record.id); put("type", record.type); put("date", record.date)
        put("title", record.title); put("amountCents", record.amountCents); put("source", record.source)
        record.category?.let { put("category", it) }
        record.workplaceId?.let { put("workplaceId", it) }
        record.startTime?.let { put("startTime", it) }
        record.endTime?.let { put("endTime", it) }
        record.durationMinutes?.let { put("durationMinutes", it) }
        record.hourlyRateCents?.let { put("hourlyRateCents", it) }
    }

    fun ledgerJson(state: LedgerState): JSONObject = JSONObject().apply {
        put("version", state.version)
        put("records", JSONArray().apply { state.records.forEach { put(recordJson(it)) } })
        put("workplaces", JSONArray().apply {
            state.workplaces.forEach { row ->
                put(JSONObject().apply {
                    put("id", row.id); put("name", row.name)
                    put("hourlyRateCents", row.hourlyRateCents)
                    put("description", row.description); put("source", row.source)
                })
            }
        })
        put("settings", JSONObject().put("hourlyRateCents", state.hourlyRateCents))
    }
}

internal fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key, "").takeIf { it.isNotEmpty() }

internal fun JSONObject.optIntOrNull(key: String): Int? = if (isNull(key)) null else optInt(key)

internal fun JSONObject.optLongOrNull(key: String): Long? = if (isNull(key)) null else optLong(key)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" testDebugUnitTest --tests "com.shunshou.app.data.ModelsTest"`
Expected: `BUILD SUCCESSFUL`，4 个测试通过

- [ ] **Step 5: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/data/Models.kt android/app/src/test/java/com/shunshou/app/data/ModelsTest.kt
git commit -m "feat(app): 数据模型与 JSON 解析"
```

---

## Task 3: 会话存储与安装 ID

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/data/SessionStore.kt`
- Test: `android/app/src/test/java/com/shunshou/app/data/SessionStoreTest.kt`

**Interfaces:**
- Consumes: 无
- Produces:
  - `class SessionStore(context: Context)`
  - `fun load(): Session?` where `data class Session(val baseUrl: String, val token: String, val expiresAt: Long, val username: String)`
  - `fun save(session: Session)`
  - `fun clear()`
  - `fun isValid(): Boolean`（`expiresAt - now > 60_000`）
  - `fun deviceId(): String`（首次调用生成并持久化 UUID）
  - `fun cached(key: String): String?` / `fun cache(key: String, json: String)`

注：`SessionStore` 依赖 Android `Context`，单元测试通过 `SessionStore` 的纯逻辑部分（`isValidAt`）验证，不做 Robolectric（避免新依赖）。

- [ ] **Step 1: 写失败测试**

`app/src/test/java/com/shunshou/app/data/SessionStoreTest.kt`：

```kotlin
package com.shunshou.app.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionStoreTest {
    @Test
    fun validWhenExpiryIsFarEnough() {
        val now = 1_795_000_000_000L
        assertTrue(SessionStore.isValidAt(expiresAt = now + 3_600_000L, now = now))
    }

    @Test
    fun invalidWithinRefreshWindow() {
        val now = 1_795_000_000_000L
        assertFalse(SessionStore.isValidAt(expiresAt = now + 30_000L, now = now))
    }

    @Test
    fun invalidWhenExpired() {
        val now = 1_795_000_000_000L
        assertFalse(SessionStore.isValidAt(expiresAt = now - 1L, now = now))
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" testDebugUnitTest --tests "com.shunshou.app.data.SessionStoreTest"`
Expected: 编译失败，`Unresolved reference: SessionStore`

- [ ] **Step 3: 实现 SessionStore.kt**

```kotlin
package com.shunshou.app.data

import android.content.Context
import java.util.UUID

data class Session(
    val baseUrl: String,
    val token: String,
    val expiresAt: Long,
    val username: String,
)

class SessionStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("shunshou_app", Context.MODE_PRIVATE)

    fun load(): Session? {
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        val baseUrl = prefs.getString(KEY_BASE, null) ?: return null
        return Session(
            baseUrl = baseUrl,
            token = token,
            expiresAt = prefs.getLong(KEY_EXPIRES, 0L),
            username = prefs.getString(KEY_USERNAME, "").orEmpty(),
        )
    }

    fun save(session: Session) {
        prefs.edit()
            .putString(KEY_BASE, session.baseUrl)
            .putString(KEY_TOKEN, session.token)
            .putLong(KEY_EXPIRES, session.expiresAt)
            .putString(KEY_USERNAME, session.username)
            .apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_BASE).remove(KEY_TOKEN).remove(KEY_EXPIRES).remove(KEY_USERNAME).apply()
    }

    fun isValid(): Boolean {
        val session = load() ?: return false
        return isValidAt(session.expiresAt, System.currentTimeMillis())
    }

    fun deviceId(): String {
        val existing = prefs.getString(KEY_DEVICE, null)
        if (existing != null) return existing
        val created = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE, created).apply()
        return created
    }

    fun cached(key: String): String? = prefs.getString("cache_$key", null)

    fun cache(key: String, json: String) {
        prefs.edit().putString("cache_$key", json).apply()
    }

    companion object {
        const val DEFAULT_BASE = "https://athand-qnvq63y722x.qoder.zone/functions/v1/app"
        private const val KEY_BASE = "base"
        private const val KEY_TOKEN = "token"
        private const val KEY_EXPIRES = "expiresAt"
        private const val KEY_USERNAME = "username"
        private const val KEY_DEVICE = "deviceId"
        private const val REFRESH_WINDOW_MS = 60_000L

        fun isValidAt(expiresAt: Long, now: Long): Boolean = expiresAt - now > REFRESH_WINDOW_MS
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" testDebugUnitTest --tests "com.shunshou.app.data.SessionStoreTest"`
Expected: `BUILD SUCCESSFUL`，3 个测试通过

- [ ] **Step 5: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/data/SessionStore.kt android/app/src/test/java/com/shunshou/app/data/SessionStoreTest.kt
git commit -m "feat(app): 会话存储与安装 ID"
```

---

## Task 4: HTTP 客户端

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/data/ShunshouApi.kt`
- Test: `android/app/src/test/java/com/shunshou/app/data/ShunshouApiTest.kt`

**Interfaces:**
- Consumes: `Session`, `SessionStore.DEFAULT_BASE`, `Models`, `LedgerState`, `PlannerSnapshot`, `UserSummary`
- Produces:
  - `class ApiException(val status: Int, message: String)`
  - `class ShunshouApi(baseUrl: String = SessionStore.DEFAULT_BASE)`
  - `fun register(username: String, password: String): AuthResult`
  - `fun login(username: String, password: String): AuthResult`
  - `fun me(token: String): UserSummary?`
  - `fun logout(token: String)`
  - `fun fetchLedger(token: String): Pair<LedgerState, String?>`（state, updatedAt）
  - `fun putLedger(token: String, state: LedgerState, baseUpdatedAt: String?): String`（返回新 updatedAt；409 抛 `ApiException(409)`）
  - `fun fetchPlanner(token: String): PlannerSnapshot`
  - `fun plannerOperation(token: String, operationId: String, baseRevision: Int, command: JSONObject): PlannerSnapshot`
  - `data class AuthResult(val token: String, val expiresAt: Long, val user: UserSummary)`
  - `val baseUrl: String`（公开，供 SessionStore 保存）
  - `object ApiErrors { fun message(e: ApiException): String }`

- [ ] **Step 1: 写失败测试（纯逻辑：错误文案与 URL 拼接）**

`app/src/test/java/com/shunshou/app/data/ShunshouApiTest.kt`：

```kotlin
package com.shunshou.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ShunshouApiTest {
    @Test
    fun mapsErrorCodesToChineseMessages() {
        assertEquals("账号或密码不对。", ApiErrors.message(ApiException(401, "")))
        assertEquals("服务地址不被允许，请稍后再试。", ApiErrors.message(ApiException(403, "")))
        assertEquals("数据在别处更新了，已为你刷新。", ApiErrors.message(ApiException(409, "")))
        assertEquals("云端暂时不可用，请稍后再试。", ApiErrors.message(ApiException(503, "")))
    }

    @Test
    fun joinsBaseUrlAndPath() {
        assertEquals(
            "https://example.com/functions/v1/app/api/login",
            ShunshouApi.endpoint("https://example.com/functions/v1/app/", "/api/login"),
        )
    }

    @Test
    fun keepsOriginFromBaseUrl() {
        assertEquals(
            "https://athand-qnvq63y722x.qoder.zone",
            ShunshouApi.originOf(SessionStore.DEFAULT_BASE),
        )
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" testDebugUnitTest --tests "com.shunshou.app.data.ShunshouApiTest"`
Expected: 编译失败，`Unresolved reference: ApiErrors`

- [ ] **Step 3: 实现 ShunshouApi.kt**

```kotlin
package com.shunshou.app.data

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val status: Int, message: String) : Exception(message)

data class AuthResult(val token: String, val expiresAt: Long, val user: UserSummary)

object ApiErrors {
    fun message(error: ApiException): String = when (error.status) {
        401 -> "账号或密码不对。"
        403 -> "服务地址不被允许，请稍后再试。"
        409 -> "数据在别处更新了，已为你刷新。"
        429 -> "尝试次数过多，请稍后再试。"
        in 500..599 -> "云端暂时不可用，请稍后再试。"
        else -> if (error.message.isNullOrBlank()) "请求失败，请重试。" else error.message!!
    }
}

class ShunshouApi(val baseUrl: String = SessionStore.DEFAULT_BASE) {
    private val origin = originOf(baseUrl)

    private fun request(
        method: String,
        path: String,
        token: String? = null,
        body: JSONObject? = null,
    ): JSONObject {
        val connection = URL(endpoint(baseUrl, path)).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("Accept", "application/json")
            // 云端网关按 Origin 校验，缺失或陌生直接 403。
            connection.setRequestProperty("Origin", origin)
            if (token != null) {
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("X-Shunshou-Session", token)
            }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                val message = runCatching { JSONObject(text).optString("message") }.getOrNull().orEmpty()
                throw ApiException(code, message)
            }
            if (text.isBlank()) JSONObject() else JSONObject(text)
        } catch (error: java.io.IOException) {
            throw ApiException(0, "网络不通，请检查网络后重试。")
        } finally {
            connection.disconnect()
        }
    }

    fun register(username: String, password: String): AuthResult {
        val body = request("POST", "/api/register", body = JSONObject()
            .put("username", username.trim()).put("password", password))
        return authOf(body, username.trim())
    }

    fun login(username: String, password: String): AuthResult {
        val body = request("POST", "/api/login", body = JSONObject()
            .put("username", username.trim()).put("password", password))
        return authOf(body, username.trim())
    }

    private fun authOf(body: JSONObject, fallbackName: String): AuthResult {
        val token = body.optString("token")
        val expiresAt = body.optLong("expiresAt")
        if (token.isBlank() || expiresAt <= 0L) throw ApiException(0, "登录响应异常，请重试。")
        val user = body.optJSONObject("user")
        return AuthResult(
            token = token,
            expiresAt = expiresAt,
            user = UserSummary(
                id = user?.optString("id").orEmpty(),
                username = user?.optString("username").orEmpty().ifBlank { fallbackName },
            ),
        )
    }

    fun me(token: String): UserSummary? {
        val body = request("GET", "/api/me", token)
        val user = body.optJSONObject("user") ?: return null
        return UserSummary(user.optString("id"), user.optString("username"))
    }

    fun logout(token: String) {
        runCatching { request("POST", "/api/logout", token) }
    }

    fun fetchLedger(token: String): Pair<LedgerState, String?> {
        val body = request("GET", "/api/ledger", token)
        return Models.parseLedger(body) to body.optStringOrNull("updatedAt")
    }

    fun putLedger(token: String, state: LedgerState, baseUpdatedAt: String?): String {
        val payload = JSONObject()
            .put("ledger", Models.ledgerJson(state))
            .put("baseUpdatedAt", baseUpdatedAt ?: JSONObject.NULL)
        val body = request("PUT", "/api/ledger", token, payload)
        return body.optString("updatedAt")
    }

    fun fetchPlanner(token: String): PlannerSnapshot =
        Models.parsePlanner(request("GET", "/api/planner", token))

    fun plannerOperation(
        token: String, operationId: String, baseRevision: Int, command: JSONObject,
    ): PlannerSnapshot {
        val payload = JSONObject()
            .put("operationId", operationId)
            .put("baseRevision", baseRevision)
            .put("command", command)
        val body = request("POST", "/api/planner/operations", token, payload)
        return Models.parsePlanner(body)
    }

    fun pushSamples(token: String, samples: JSONArray): Int =
        request("POST", "/api/samples", token, JSONObject().put("samples", samples))
            .optInt("added", 0)

    companion object {
        fun endpoint(baseUrl: String, path: String): String =
            baseUrl.trimEnd('/') + path

        fun originOf(baseUrl: String): String {
            val parsed = URL(baseUrl)
            return "${parsed.protocol}://${parsed.host}"
        }
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" testDebugUnitTest --tests "com.shunshou.app.data.ShunshouApiTest"`
Expected: `BUILD SUCCESSFUL`，3 个测试通过

- [ ] **Step 5: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/data/ShunshouApi.kt android/app/src/test/java/com/shunshou/app/data/ShunshouApiTest.kt
git commit -m "feat(app): 云端 HTTP 客户端"
```

---

## Task 5: 账本汇总纯函数

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/domain/LedgerMath.kt`
- Test: `android/app/src/test/java/com/shunshou/app/domain/LedgerMathTest.kt`

**Interfaces:**
- Consumes: `RecordEntry`, `LedgerState`
- Produces:
  - `data class Totals(val incomeCents: Long, val expenseCents: Long, val workMinutes: Int)`
  - `object LedgerMath.summarize(records: List<RecordEntry>, from: String, to: String): Totals`（闭区间，日期字符串比较）
  - `object LedgerMath.weekRange(mondayIso: String?): Pair<String, String>`（返回该周一到周日）
  - `object LedgerMath.mondayOf(date: String): String`
  - `object LedgerMath.shiftDays(date: String, days: Int): String`
  - `object LedgerMath.groupByDate(records: List<RecordEntry>): List<Pair<String, List<RecordEntry>>>`（日期倒序）
  - `object LedgerMath.byCategory(records: List<RecordEntry>): List<Pair<String, Long>>`（金额降序）
  - `object LedgerMath.formatYuan(cents: Long): String`（`1850` → `18.50`）

- [ ] **Step 1: 写失败测试**

`app/src/test/java/com/shunshou/app/domain/LedgerMathTest.kt`：

```kotlin
package com.shunshou.app.domain

import com.shunshou.app.data.RecordEntry
import org.junit.Assert.assertEquals
import org.junit.Test

class LedgerMathTest {
    private fun expense(id: String, date: String, cents: Long, category: String = "吃饭") = RecordEntry(
        id = id, type = "expense", date = date, title = "x", amountCents = cents,
        category = category, workplaceId = null, startTime = null, endTime = null,
        durationMinutes = null, hourlyRateCents = null, source = "manual",
    )

    private fun work(id: String, date: String, cents: Long, minutes: Int) = RecordEntry(
        id = id, type = "work", date = date, title = "家教", amountCents = cents,
        category = null, workplaceId = "w1", startTime = "14:00", endTime = "16:00",
        durationMinutes = minutes, hourlyRateCents = 4500, source = "manual",
    )

    @Test
    fun sumsIncomeExpenseAndMinutesInRange() {
        val records = listOf(
            expense("e1", "2026-11-23", 1850),
            expense("e2", "2026-11-24", 2100),
            expense("e3", "2026-11-30", 999),
            work("w1", "2026-11-22", 9000, 120),
        )
        val totals = LedgerMath.summarize(records, "2026-11-23", "2026-11-29")
        assertEquals(0L, totals.incomeCents)
        assertEquals(3950L, totals.expenseCents)
        assertEquals(0, totals.workMinutes)
    }

    @Test
    fun ignoresDemoRecords() {
        val records = listOf(
            expense("e1", "2026-11-23", 1000).copy(source = "demo"),
            expense("e2", "2026-11-23", 500),
        )
        assertEquals(500L, LedgerMath.summarize(records, "2026-11-23", "2026-11-23").expenseCents)
    }

    @Test
    fun mondayOfAnyDayReturnsThatWeekMonday() {
        assertEquals("2026-11-23", LedgerMath.mondayOf("2026-11-23"))
        assertEquals("2026-11-23", LedgerMath.mondayOf("2026-11-29"))
        assertEquals("2026-11-30", LedgerMath.mondayOf("2026-12-01"))
    }

    @Test
    fun weekRangeEndsOnSunday() {
        assertEquals("2026-11-23" to "2026-11-29", LedgerMath.weekRange("2026-11-23"))
    }

    @Test
    fun groupsByDateDescending() {
        val grouped = LedgerMath.groupByDate(listOf(
            expense("e1", "2026-11-22", 100),
            expense("e2", "2026-11-24", 200),
            expense("e3", "2026-11-24", 300),
        ))
        assertEquals(listOf("2026-11-24", "2026-11-22"), grouped.map { it.first })
        assertEquals(2, grouped[0].second.size)
    }

    @Test
    fun sumsCategoryDescending() {
        val rows = LedgerMath.byCategory(listOf(
            expense("e1", "2026-11-23", 100, "吃饭"),
            expense("e2", "2026-11-23", 300, "交通"),
            expense("e3", "2026-11-23", 200, "吃饭"),
        ))
        // 交通 300 与 吃饭 300 同额，顺序由 sortedByDescending 稳定性决定：保持输入顺序。
        assertEquals(300L, rows[0].second)
        assertEquals(300L, rows[1].second)
        assertEquals(setOf("交通", "吃饭"), rows.map { it.first }.toSet())
    }

    @Test
    fun formatsYuanWithTwoDecimals() {
        assertEquals("18.50", LedgerMath.formatYuan(1850))
        assertEquals("0.05", LedgerMath.formatYuan(5))
        assertEquals("1200.00", LedgerMath.formatYuan(120000))
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" testDebugUnitTest --tests "com.shunshou.app.domain.LedgerMathTest"`
Expected: 编译失败，`Unresolved reference: LedgerMath`

- [ ] **Step 3: 实现 LedgerMath.kt**

```kotlin
package com.shunshou.app.domain

import com.shunshou.app.data.RecordEntry
import java.time.LocalDate
import java.time.format.DateTimeFormatter

data class Totals(val incomeCents: Long, val expenseCents: Long, val workMinutes: Int)

object LedgerMath {
    private val iso: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    fun summarize(records: List<RecordEntry>, from: String, to: String): Totals {
        var income = 0L
        var expense = 0L
        var minutes = 0
        for (record in records) {
            if (record.source == "demo") continue
            if (record.date < from || record.date > to) continue
            if (record.type == "expense") expense += record.amountCents
            if (record.type == "work") {
                income += record.amountCents
                minutes += record.durationMinutes ?: 0
            }
        }
        return Totals(income, expense, minutes)
    }

    fun mondayOf(date: String): String {
        val parsed = LocalDate.parse(date, iso)
        return parsed.minusDays((parsed.dayOfWeek.value - 1).toLong()).format(iso)
    }

    fun shiftDays(date: String, days: Int): String =
        LocalDate.parse(date, iso).plusDays(days.toLong()).format(iso)

    fun weekRange(mondayIso: String?): Pair<String, String> {
        val monday = mondayIso ?: mondayOf(LocalDate.now().format(iso))
        return monday to shiftDays(monday, 6)
    }

    fun groupByDate(records: List<RecordEntry>): List<Pair<String, List<RecordEntry>>> =
        records.filter { it.source != "demo" }
            .groupBy { it.date }
            .toList()
            .sortedByDescending { it.first }

    fun byCategory(records: List<RecordEntry>): List<Pair<String, Long>> =
        records.filter { it.type == "expense" && it.source != "demo" }
            .groupBy { it.category ?: "其他" }
            .map { (category, rows) -> category to rows.sumOf { it.amountCents } }
            .sortedByDescending { it.second }

    fun formatYuan(cents: Long): String {
        val sign = if (cents < 0) "-" else ""
        val abs = kotlin.math.abs(cents)
        return "$sign${abs / 100}.${(abs % 100).toString().padStart(2, '0')}"
    }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" testDebugUnitTest --tests "com.shunshou.app.domain.LedgerMathTest"`
Expected: `BUILD SUCCESSFUL`，7 个测试通过

- [ ] **Step 5: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/domain/LedgerMath.kt android/app/src/test/java/com/shunshou/app/domain/LedgerMathTest.kt
git commit -m "feat(app): 账本汇总纯函数"
```

---

## Task 6: 应用状态仓库

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/data/AppRepository.kt`

**Interfaces:**
- Consumes: `ShunshouApi`, `SessionStore`, `Models`, `LedgerState`, `PlannerSnapshot`, `RecordEntry`, `AuthResult`, `ApiException`, `ApiErrors`
- Produces:
  - `data class AppUiState(val signedIn: Boolean, val username: String, val ledger: LedgerState, val planner: PlannerSnapshot, val ledgerUpdatedAt: String?, val loading: Boolean, val message: String?, val error: String?)`
  - `class AppRepository(api: ShunshouApi, store: SessionStore, scope: CoroutineScope)`
  - `val state: StateFlow<AppUiState>`
  - `fun refresh()`
  - `fun signIn(username: String, password: String, register: Boolean)`
  - `fun signOut()`
  - `fun addRecord(record: RecordEntry)`
  - `fun deleteRecord(id: String)`
  - `fun startFocus(task: String, minutes: Int)`
  - `fun controlFocus(action: String)`
  - `fun clearMessage()`

- [ ] **Step 1: 实现 AppRepository.kt**

```kotlin
package com.shunshou.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

data class AppUiState(
    val signedIn: Boolean = false,
    val username: String = "",
    val ledger: LedgerState = LedgerState.EMPTY,
    val planner: PlannerSnapshot = PlannerSnapshot.EMPTY,
    val ledgerUpdatedAt: String? = null,
    val loading: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

class AppRepository(
    private val api: ShunshouApi,
    private val store: SessionStore,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow(restore())
    val state: StateFlow<AppUiState> = _state.asStateFlow()
    private val deviceId = store.deviceId()

    private fun restore(): AppUiState {
        val ledger = store.cached("ledger")
            ?.let { runCatching { Models.parseLedger(JSONObject(it)) }.getOrNull() }
            ?: LedgerState.EMPTY
        val planner = store.cached("planner")
            ?.let { runCatching { Models.parsePlanner(JSONObject(it)) }.getOrNull() }
            ?: PlannerSnapshot.EMPTY
        return AppUiState(
            signedIn = store.isValid(),
            username = store.load()?.username.orEmpty(),
            ledger = ledger,
            planner = planner,
        )
    }

    private fun token(): String? = store.load()?.takeIf { store.isValid() }?.token

    fun clearMessage() {
        _state.value = _state.value.copy(message = null, error = null)
    }

    fun refresh() {
        val token = token() ?: return
        _state.value = _state.value.copy(loading = true)
        scope.launch(Dispatchers.IO) {
            try {
                val (ledger, updatedAt) = api.fetchLedger(token)
                val planner = api.fetchPlanner(token)
                store.cache("ledger", JSONObject().put("ledger", Models.ledgerJson(ledger)).toString())
                store.cache("planner", Models.plannerJson(planner).toString())
                _state.value = _state.value.copy(
                    ledger = ledger, planner = planner, ledgerUpdatedAt = updatedAt,
                    loading = false, error = null,
                )
            } catch (error: ApiException) {
                if (error.status == 401) expireSession()
                else _state.value = _state.value.copy(loading = false, error = ApiErrors.message(error))
            }
        }
    }

    fun signIn(username: String, password: String, register: Boolean) {
        _state.value = _state.value.copy(loading = true, error = null)
        scope.launch(Dispatchers.IO) {
            try {
                val result = if (register) api.register(username, password) else api.login(username, password)
                store.save(Session(api.baseUrl, result.token, result.expiresAt, result.user.username))
                _state.value = _state.value.copy(
                    signedIn = true, username = result.user.username, loading = false,
                )
                refresh()
            } catch (error: ApiException) {
                _state.value = _state.value.copy(loading = false, error = ApiErrors.message(error))
            }
        }
    }

    fun signOut() {
        val token = token()
        if (token != null) scope.launch(Dispatchers.IO) { api.logout(token) }
        store.clear()
        _state.value = AppUiState(signedIn = false)
    }

    fun addRecord(record: RecordEntry) {
        val current = _state.value.ledger
        val next = current.copy(records = current.records + record)
        _state.value = _state.value.copy(ledger = next, message = "已记一笔")
        persistLedger(current, next)
    }

    fun deleteRecord(id: String) {
        val current = _state.value.ledger
        val next = current.copy(records = current.records.filter { it.id != id })
        _state.value = _state.value.copy(ledger = next, message = "已删除")
        persistLedger(current, next)
    }

    private fun persistLedger(previous: LedgerState, next: LedgerState) {
        val token = token() ?: return
        val baseUpdatedAt = _state.value.ledgerUpdatedAt
        scope.launch(Dispatchers.IO) {
            try {
                val updatedAt = api.putLedger(token, next, baseUpdatedAt)
                _state.value = _state.value.copy(ledgerUpdatedAt = updatedAt)
            } catch (error: ApiException) {
                if (error.status == 409) {
                    _state.value = _state.value.copy(ledger = previous, error = "数据在别处更新了，已为你刷新。")
                    refresh()
                } else {
                    _state.value = _state.value.copy(ledger = previous, error = ApiErrors.message(error))
                }
            }
        }
    }

    fun startFocus(task: String, minutes: Int) {
        val command = JSONObject()
            .put("kind", "focus.start")
            .put("id", "focus-${UUID.randomUUID()}")
            .put("task", task)
            .put("minutes", minutes)
            .put("owner", deviceId)
        plannerCall(command)
    }

    fun controlFocus(action: String) {
        val active = _state.value.planner.focusSessions
            .firstOrNull { it.status == "running" || it.status == "paused" } ?: return
        val command = JSONObject()
            .put("kind", "focus.control")
            .put("id", active.id)
            .put("action", action)
            .put("owner", deviceId)
            .put("epoch", active.epoch)
        plannerCall(command)
    }

    private fun plannerCall(command: JSONObject) {
        val token = token() ?: return
        val revision = _state.value.planner.revision
        scope.launch(Dispatchers.IO) {
            try {
                val updated = api.plannerOperation(token, UUID.randomUUID().toString(), revision, command)
                store.cache("planner", Models.plannerJson(updated).toString())
                _state.value = _state.value.copy(planner = updated)
            } catch (error: ApiException) {
                if (error.status == 409) {
                    _state.value = _state.value.copy(error = "数据在别处更新了，已为你刷新。")
                    refresh()
                } else {
                    _state.value = _state.value.copy(error = ApiErrors.message(error))
                }
            }
        }
    }

    private fun expireSession() {
        store.clear()
        _state.value = AppUiState(signedIn = false)
    }
}
```

- [ ] **Step 2: 编译验证**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" compileDebugKotlin`
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/data/AppRepository.kt
git commit -m "feat(app): 应用状态仓库"
```

---

## Task 7: 导航壳与共用组件

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/ui/components/Common.kt`
- Create: `android/app/src/main/java/com/shunshou/app/AppRoot.kt`
- Modify: `android/app/src/main/java/com/shunshou/app/MainActivity.kt`

**Interfaces:**
- Consumes: `ShunshouTheme`, `Paper`, `Type`, `Dimens`, `AppRepository`, `AppUiState`
- Produces:
  - `@Composable fun PageHeader(title: String, subtitle: String? = null, action: (@Composable () -> Unit)? = null)`
  - `@Composable fun RuleLine()`
  - `@Composable fun FigureText(text: String, style: TextStyle = Type.figure)`
  - `@Composable fun EmptyHint(text: String)`
  - `@Composable fun MessageBar(message: String?, error: String?, onDismiss: () -> Unit)`
  - `enum class Tab(val route: String, val label: String) { Home, Ledger, Schedule, Me }`
  - `@Composable fun AppRoot(repository: AppRepository)`

- [ ] **Step 1: 写共用组件**

`app/src/main/java/com/shunshou/app/ui/components/Common.kt`：

```kotlin
package com.shunshou.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type

@Composable
fun PageHeader(
    title: String,
    subtitle: String? = null,
    action: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text(title, style = Type.pageTitle)
            if (subtitle != null) Text(subtitle, style = Type.caption)
        }
        action?.invoke()
    }
    RuleLine()
}

@Composable
fun RuleLine() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Paper.rule))
}

@Composable
fun FigureText(text: String, style: TextStyle = Type.figure) {
    Text(text, style = style)
}

@Composable
fun EmptyHint(text: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 28.dp)) {
        Text(text, style = Type.caption)
    }
}

@Composable
fun MessageBar(message: String?, error: String?, onDismiss: () -> Unit) {
    val text = error ?: message ?: return
    Box(
        Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 8.dp)
            .background(if (error != null) Paper.redWash else Paper.brandWash, RoundedCornerShape(Dimens.rSm))
            .padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 4.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text,
                style = Type.caption.copy(color = if (error != null) Paper.red else Paper.brandDeep),
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) { Text("知道了", style = Type.caption) }
        }
    }
}
```

- [ ] **Step 2: 写导航壳**

`app/src/main/java/com/shunshou/app/AppRoot.kt`：

```kotlin
package com.shunshou.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EventNote
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.shunshou.app.data.AppRepository
import com.shunshou.app.ui.EntryScreen
import com.shunshou.app.ui.FocusScreen
import com.shunshou.app.ui.HomeScreen
import com.shunshou.app.ui.LedgerScreen
import com.shunshou.app.ui.LoginScreen
import com.shunshou.app.ui.MeScreen
import com.shunshou.app.ui.ScheduleScreen
import com.shunshou.app.ui.components.MessageBar
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type

enum class Tab(val route: String, val label: String, val icon: ImageVector) {
    Home("home", "首页", Icons.Outlined.Home),
    Ledger("ledger", "账本", Icons.Outlined.Receipt),
    Schedule("schedule", "日程", Icons.Outlined.EventNote),
    Me("me", "我的", Icons.Outlined.Person),
}

@Composable
fun AppRoot(repository: AppRepository) {
    val state by repository.state.collectAsStateWithLifecycle()
    if (!state.signedIn) {
        LoginScreen(state, repository::signIn)
        return
    }
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val current = entry?.destination?.route
    Scaffold(
        containerColor = Paper.page,
        bottomBar = {
            if (Tab.entries.any { it.route == current }) {
                NavigationBar(containerColor = Paper.sheet, contentColor = Paper.ink) {
                    Tab.entries.forEach { tab ->
                        NavigationBarItem(
                            selected = current == tab.route,
                            onClick = {
                                nav.navigate(tab.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label, style = Type.caption) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            NavHost(nav, startDestination = Tab.Home.route) {
                composable(Tab.Home.route) {
                    HomeScreen(state, onGoEntry = { nav.navigate("entry") }, onGoFocus = { nav.navigate("focus") })
                }
                composable(Tab.Ledger.route) { LedgerScreen(state, repository::deleteRecord) }
                composable(Tab.Schedule.route) { ScheduleScreen(state) }
                composable(Tab.Me.route) { MeScreen(state, repository::signOut, repository::refresh) }
                composable("entry") {
                    EntryScreen(state, onSave = repository::addRecord, onBack = { nav.popBackStack() })
                }
                composable("focus") {
                    FocusScreen(state, repository::startFocus, repository::controlFocus, onBack = { nav.popBackStack() })
                }
            }
            MessageBar(state.message, state.error, repository::clearMessage)
        }
    }
}
```

- [ ] **Step 3: 改 MainActivity 使用 AppRoot**

```kotlin
package com.shunshou.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import com.shunshou.app.data.AppRepository
import com.shunshou.app.data.SessionStore
import com.shunshou.app.data.ShunshouApi
import com.shunshou.app.ui.theme.ShunshouTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SessionStore(this)
        val repository = AppRepository(ShunshouApi(), store, lifecycleScope)
        if (store.isValid()) repository.refresh()
        setContent { ShunshouTheme { AppRoot(repository) } }
    }
}
```

- [ ] **Step 4: 编译验证**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" compileDebugKotlin`
Expected: 此时会因缺少各 Screen 文件失败——这是预期的，下一步补齐后再编译

- [ ] **Step 5: 先提交壳层（编译在 Task 8 完成后统一验证）**

```bash
git add android/app/src/main/java/com/shunshou/app/AppRoot.kt android/app/src/main/java/com/shunshou/app/MainActivity.kt android/app/src/main/java/com/shunshou/app/ui/components/Common.kt
git commit -m "feat(app): 导航壳与共用组件"
```

---

## Task 8: 登录与注册页

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/ui/LoginScreen.kt`

**Interfaces:**
- Consumes: `AppUiState`, `Paper`, `Type`, `Dimens`
- Produces: `@Composable fun LoginScreen(state: AppUiState, onSubmit: (username: String, password: String, register: Boolean) -> Unit)`

- [ ] **Step 1: 实现 LoginScreen.kt**

```kotlin
package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type

@Composable
fun LoginScreen(state: AppUiState, onSubmit: (String, String, Boolean) -> Unit) {
    var username by remember { mutableStateOf(state.username) }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var register by remember { mutableStateOf(false) }
    val mismatch = register && confirm != password
    val canSubmit = username.trim().length >= 3 && password.length >= 8 && !mismatch && !state.loading

    Box(Modifier.fillMaxSize().background(Paper.page)) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 48.dp)
        ) {
            Text("顺手", style = Type.pageTitle.copy(fontSize = Type.pageTitle.fontSize * 1.4f))
            Spacer(Modifier.height(6.dp))
            Text("把零散的校园日子，收进一处。", style = Type.caption)
            Spacer(Modifier.height(40.dp))

            OutlinedTextField(
                value = username,
                onValueChange = { username = it },
                label = { Text("账号") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("密码") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            )
            if (register) {
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = confirm,
                    onValueChange = { confirm = it },
                    label = { Text("确认密码") },
                    singleLine = true,
                    isError = mismatch,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                )
            }

            if (state.error != null) {
                Spacer(Modifier.height(12.dp))
                Text(state.error, style = Type.caption.copy(color = Paper.red))
            }

            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { onSubmit(username.trim(), password, register) },
                enabled = canSubmit,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Paper.brand),
            ) {
                Text(if (state.loading) "请稍候…" else if (register) "注册并进入" else "登录", style = Type.body)
            }

            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Text(if (register) "已经有账号？" else "还没有账号？", style = Type.caption)
                TextButton(onClick = { register = !register }) {
                    Text(if (register) "去登录" else "注册一个", style = Type.caption.copy(color = Paper.brand))
                }
            }

            Spacer(Modifier.height(24.dp))
            Text(
                "账号数据保存在云端，账本与日程按账号隔离；同一账号可在网页和手机上查看。",
                style = Type.caption,
            )
        }
    }
}
```

- [ ] **Step 2: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/ui/LoginScreen.kt
git commit -m "feat(app): 登录与注册页"
```

---

## Task 9: 首页

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/ui/HomeScreen.kt`

**Interfaces:**
- Consumes: `AppUiState`, `LedgerMath`, `Paper`, `Type`, `Dimens`, `PageHeader`, `RuleLine`, `FigureText`, `EmptyHint`
- Produces: `@Composable fun HomeScreen(state: AppUiState, onGoEntry: () -> Unit, onGoFocus: () -> Unit)`

- [ ] **Step 1: 实现 HomeScreen.kt**

```kotlin
package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.domain.LedgerMath
import com.shunshou.app.ui.components.EmptyHint
import com.shunshou.app.ui.components.FigureText
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.RuleLine
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val iso = DateTimeFormatter.ISO_LOCAL_DATE

@Composable
fun HomeScreen(state: AppUiState, onGoEntry: () -> Unit, onGoFocus: () -> Unit) {
    val today = remember { LocalDate.now().format(iso) }
    val dayTotals = remember(state.ledger, today) {
        LedgerMath.summarize(state.ledger.records, today, today)
    }
    val weekTotals = remember(state.ledger, today) {
        val (from, to) = LedgerMath.weekRange(null)
        LedgerMath.summarize(state.ledger.records, from, to)
    }
    val todayEvents = remember(state.planner, today) {
        val startOfDay = LocalDate.parse(today).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val endOfDay = startOfDay + 86_400_000L
        state.planner.events.filter { it.start < endOfDay && it.end > startOfDay }
            .sortedBy { it.start }
            .take(5)
    }
    val activeFocus = remember(state.planner) {
        state.planner.focusSessions.firstOrNull { it.status == "running" || it.status == "paused" }
    }

    Column(Modifier.fillMaxSize().background(Paper.page).verticalScroll(rememberScrollState())) {
        PageHeader(title = "今天", subtitle = today)
        Column(Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp)) {
            Text("今日收支", style = Type.caption)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                Column {
                    Text("支出", style = Type.caption)
                    FigureText(LedgerMath.formatYuan(dayTotals.expenseCents), Type.figureLarge.copy(color = Paper.red))
                }
                Column {
                    Text("收入", style = Type.caption)
                    FigureText(LedgerMath.formatYuan(dayTotals.incomeCents), Type.figureLarge.copy(color = Paper.brand))
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "本周支出 ${LedgerMath.formatYuan(weekTotals.expenseCents)} · 收入 ${LedgerMath.formatYuan(weekTotals.incomeCents)}",
                style = Type.caption,
            )
        }

        RuleLine()
        Column(Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp)) {
            Text("今日安排", style = Type.sectionTitle)
            Spacer(Modifier.height(10.dp))
            if (todayEvents.isEmpty()) {
                EmptyHint("今天没有安排。要不要先把账记一记？")
            } else {
                val zone = ZoneId.systemDefault()
                todayEvents.forEach { event ->
                    val start = LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(event.start), zone)
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 7.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Text(
                            start.format(DateTimeFormatter.ofPattern("HH:mm")),
                            style = Type.caption.copy(color = Paper.inkSoft),
                            modifier = Modifier.padding(end = 12.dp),
                        )
                        Column {
                            Text(event.title, style = Type.body)
                            if (event.location.isNotBlank()) Text(event.location, style = Type.caption)
                        }
                    }
                }
            }
        }

        if (activeFocus != null) {
            RuleLine()
            Column(Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp)) {
                Text("正在专注", style = Type.sectionTitle)
                Spacer(Modifier.height(6.dp))
                Text("${activeFocus.task} · ${activeFocus.minutes} 分钟", style = Type.body)
                Text(if (activeFocus.status == "paused") "已暂停" else "进行中", style = Type.caption)
            }
        }

        RuleLine()
        Row(Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            QuickAction("记一笔", "支出、收入或工时", Modifier.weight(1f), onGoEntry)
            QuickAction("专注", "25 分钟起步", Modifier.weight(1f), onGoFocus)
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun QuickAction(
    title: String,
    hint: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier.fillMaxWidth().heightIn(min = 84.dp)
            .background(Paper.sheet, androidx.compose.foundation.shape.RoundedCornerShape(Dimens.rMd))
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, style = Type.sectionTitle)
        Spacer(Modifier.height(2.dp))
        Text(hint, style = Type.caption)
    }
}
```

- [ ] **Step 2: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/ui/HomeScreen.kt
git commit -m "feat(app): 首页简报"
```

---

## Task 10: 记一笔

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/ui/EntryScreen.kt`

**Interfaces:**
- Consumes: `AppUiState`, `RecordEntry`, `Paper`, `Type`, `Dimens`, `PageHeader`
- Produces: `@Composable fun EntryScreen(state: AppUiState, onSave: (RecordEntry) -> Unit, onBack: () -> Unit)`

- [ ] **Step 1: 实现 EntryScreen.kt**

```kotlin
package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.data.RecordEntry
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID

private val categories = listOf("吃饭", "交通", "日用", "娱乐", "学习", "其他")
private val iso = DateTimeFormatter.ISO_LOCAL_DATE

@Composable
fun EntryScreen(state: AppUiState, onSave: (RecordEntry) -> Unit, onBack: () -> Unit) {
    var type by remember { mutableStateOf("expense") }
    var amount by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(categories[0]) }
    var date by remember { mutableStateOf(LocalDate.now().format(iso)) }
    var hours by remember { mutableStateOf("") }
    var rate by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        if (type == "expense") {
            val cents = amount.trim().toBigDecimalOrNull()
                ?.multiply(java.math.BigDecimal(100))?.setScale(0, java.math.RoundingMode.HALF_UP)?.toLong()
            if (cents == null || cents <= 0) { error = "金额需大于 0。"; return }
            onSave(
                RecordEntry(
                    id = "r-${UUID.randomUUID()}", type = "expense", date = date,
                    title = title.trim().ifBlank { category }, amountCents = cents,
                    category = category, workplaceId = null, startTime = null, endTime = null,
                    durationMinutes = null, hourlyRateCents = null, source = "manual",
                )
            )
        } else {
            val durationMinutes = hours.trim().toBigDecimalOrNull()
                ?.multiply(java.math.BigDecimal(60))?.setScale(0, java.math.RoundingMode.HALF_UP)?.toInt()
            val rateCents = rate.trim().toBigDecimalOrNull()
                ?.multiply(java.math.BigDecimal(100))?.setScale(0, java.math.RoundingMode.HALF_UP)?.toLong()
            if (durationMinutes == null || durationMinutes < 1 || durationMinutes > 1440) {
                error = "时长需在 1 分钟到 24 小时之间。"; return
            }
            if (rateCents == null || rateCents <= 0) { error = "时薪需大于 0。"; return }
            onSave(
                RecordEntry(
                    id = "r-${UUID.randomUUID()}", type = "work", date = date,
                    title = title.trim().ifBlank { "兼职" },
                    amountCents = Math.round(durationMinutes * rateCents / 60.0),
                    category = null, workplaceId = state.ledger.workplaces.firstOrNull()?.id ?: "default",
                    startTime = "00:00", endTime = "00:00", durationMinutes = durationMinutes,
                    hourlyRateCents = rateCents, source = "manual",
                )
            )
        }
        onBack()
    }

    Column(Modifier.fillMaxSize().background(Paper.page).verticalScroll(rememberScrollState())) {
        PageHeader(title = "记一笔", action = { TextButton(onClick = onBack) { Text("取消", style = Type.caption) } })
        Column(Modifier.padding(horizontal = Dimens.gutter, vertical = 16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("expense" to "支出", "work" to "收入").forEach { (value, label) ->
                    FilterChip(
                        selected = type == value,
                        onClick = { type = value },
                        label = { Text(label, style = Type.caption) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = Paper.brandWash,
                            selectedLabelColor = Paper.brandDeep,
                        ),
                        modifier = Modifier.heightIn(min = 48.dp),
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = amount,
                onValueChange = { amount = it; error = null },
                label = { Text("金额（元）") },
                singleLine = true,
                isError = error != null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("备注（可空）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            )
            if (type == "expense") {
                Spacer(Modifier.height(16.dp))
                Text("分类", style = Type.caption)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    categories.take(3).forEach { name ->
                        FilterChip(
                            selected = category == name,
                            onClick = { category = name },
                            label = { Text(name, style = Type.caption) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    categories.drop(3).forEach { name ->
                        FilterChip(
                            selected = category == name,
                            onClick = { category = name },
                            label = { Text(name, style = Type.caption) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        )
                    }
                }
            } else {
                Spacer(Modifier.height(16.dp))
                Text("工时收入按「时长 × 时薪」自动算钱；金额栏填的是时长（小时）。", style = Type.caption)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = hours,
                    onValueChange = { hours = it; error = null },
                    label = { Text("时长（小时）") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = rate,
                    onValueChange = { rate = it; error = null },
                    label = { Text("时薪（元）") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = date,
                onValueChange = { date = it; error = null },
                label = { Text("日期") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, style = Type.caption.copy(color = Paper.red))
            }
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { submit() },
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Paper.brand),
            ) { Text("保存", style = Type.body) }
        }
    }
}
```

- [ ] **Step 2: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/ui/EntryScreen.kt
git commit -m "feat(app): 记一笔"
```

---

## Task 11: 账本页

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/ui/LedgerScreen.kt`

**Interfaces:**
- Consumes: `AppUiState`, `LedgerMath`, `RecordEntry`, `Paper`, `Type`, `Dimens`, `PageHeader`, `RuleLine`, `FigureText`, `EmptyHint`
- Produces: `@Composable fun LedgerScreen(state: AppUiState, onDelete: (String) -> Unit)`

- [ ] **Step 1: 实现 LedgerScreen.kt**

```kotlin
package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.data.RecordEntry
import com.shunshou.app.domain.LedgerMath
import com.shunshou.app.ui.components.EmptyHint
import com.shunshou.app.ui.components.FigureText
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.RuleLine
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type

@Composable
fun LedgerScreen(state: AppUiState, onDelete: (String) -> Unit) {
    var monday by remember { mutableStateOf(LedgerMath.mondayOf(java.time.LocalDate.now().toString())) }
    val (from, to) = remember(monday) { LedgerMath.weekRange(monday) }
    val weekRecords = remember(state.ledger, from, to) {
        state.ledger.records.filter { it.source != "demo" && it.date in from..to }
    }
    val totals = remember(weekRecords, from, to) { LedgerMath.summarize(weekRecords, from, to) }
    val grouped = remember(weekRecords) { LedgerMath.groupByDate(weekRecords) }
    var pendingDelete by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize().background(Paper.page).verticalScroll(rememberScrollState())) {
        PageHeader(title = "账本", subtitle = "按周查看收支")
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            IconButton(onClick = { monday = LedgerMath.shiftDays(monday, -7) }) {
                Icon(Icons.Outlined.ChevronLeft, contentDescription = "上一周")
            }
            Text("$from — $to", style = Type.caption.copy(color = Paper.inkSoft))
            IconButton(onClick = { monday = LedgerMath.shiftDays(monday, 7) }) {
                Icon(Icons.Outlined.ChevronRight, contentDescription = "下一周")
            }
        }
        RuleLine()

        Row(
            Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            Column {
                Text("支出", style = Type.caption)
                FigureText(LedgerMath.formatYuan(totals.expenseCents), Type.figureLarge.copy(color = Paper.red))
            }
            Column {
                Text("收入", style = Type.caption)
                FigureText(LedgerMath.formatYuan(totals.incomeCents), Type.figureLarge.copy(color = Paper.brand))
            }
            Column {
                Text("工时", style = Type.caption)
                FigureText("${totals.workMinutes / 60}h${totals.workMinutes % 60}m")
            }
        }
        RuleLine()

        if (grouped.isEmpty()) {
            EmptyHint("这一周还没有记录。点首页的「记一笔」开始吧。")
        } else {
            grouped.forEach { (date, rows) ->
                Column(Modifier.padding(horizontal = Dimens.gutter, vertical = 12.dp)) {
                    Text(date, style = Type.caption.copy(color = Paper.muted))
                    Spacer(Modifier.height(6.dp))
                    rows.forEach { record -> RecordRow(record, onDelete = { pendingDelete = record.id }) }
                }
                RuleLine()
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    val deleting = pendingDelete
    if (deleting != null) {
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除这条记录？", style = Type.sectionTitle) },
            text = { Text("删除后网页上也会消失。", style = Type.caption) },
            confirmButton = {
                TextButton(onClick = { onDelete(deleting); pendingDelete = null }) {
                    Text("删除", style = Type.caption.copy(color = Paper.red))
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("保留", style = Type.caption) }
            },
        )
    }
}

@Composable
private fun RecordRow(record: RecordEntry, onDelete: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(record.title, style = Type.body)
            Text(
                if (record.type == "work") "工时 ${record.durationMinutes ?: 0} 分钟"
                else record.category ?: "其他",
                style = Type.caption,
            )
        }
        FigureText(
            (if (record.type == "work") "+" else "−") + LedgerMath.formatYuan(record.amountCents),
            Type.figure.copy(color = if (record.type == "work") Paper.brand else Paper.red),
        )
        TextButton(onClick = onDelete) { Text("删", style = Type.caption, textAlign = TextAlign.Center) }
    }
}
```

- [ ] **Step 2: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/ui/LedgerScreen.kt
git commit -m "feat(app): 账本页"
```

---

## Task 12: 日程页与专注页

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/ui/ScheduleScreen.kt`
- Create: `android/app/src/main/java/com/shunshou/app/ui/FocusScreen.kt`

**Interfaces:**
- Consumes: `AppUiState`, `PlannerEvent`, `FocusSession`, `LedgerMath.shiftDays`, `Paper`, `Type`, `Dimens`
- Produces:
  - `@Composable fun ScheduleScreen(state: AppUiState)`
  - `@Composable fun FocusScreen(state: AppUiState, onStart: (String, Int) -> Unit, onControl: (String) -> Unit, onBack: () -> Unit)`

- [ ] **Step 1: 实现 ScheduleScreen.kt**

```kotlin
package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.data.PlannerEvent
import com.shunshou.app.domain.LedgerMath
import com.shunshou.app.ui.components.EmptyHint
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.RuleLine
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val hm = DateTimeFormatter.ofPattern("HH:mm")
private val weekLabel = DateTimeFormatter.ofPattern("M月d日")

@Composable
fun ScheduleScreen(state: AppUiState) {
    val zone = ZoneId.systemDefault()
    val monday = remember { LedgerMath.mondayOf(LocalDate.now().toString()) }
    val days = remember(monday) { (0..6).map { LedgerMath.shiftDays(monday, it) } }
    val today = remember { LocalDate.now().toString() }
    val byDate = remember(state.planner, monday) {
        state.planner.events.groupBy { dateOf(it.start, zone) }
    }

    Column(Modifier.fillMaxSize().background(Paper.page).verticalScroll(rememberScrollState())) {
        PageHeader(title = "日程", subtitle = "本周")
        days.forEach { date ->
            val events = byDate[date].orEmpty().sortedBy { it.start }
            val isToday = date == today
            Column(
                Modifier.fillMaxWidth()
                    .background(if (isToday) Paper.brandWash else Paper.page)
                    .padding(horizontal = Dimens.gutter, vertical = 12.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        LocalDate.parse(date).format(weekLabel),
                        style = Type.sectionTitle.copy(color = if (isToday) Paper.ink else Paper.inkSoft),
                    )
                    if (isToday) {
                        Spacer(Modifier.height(0.dp))
                        Text("今天", style = Type.caption.copy(color = Paper.red))
                    }
                }
                Spacer(Modifier.height(6.dp))
                if (events.isEmpty()) {
                    Text("空闲", style = Type.caption)
                } else {
                    events.forEach { event -> EventRow(event, zone) }
                }
            }
            RuleLine()
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun EventRow(event: PlannerEvent, zone: ZoneId) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.Top) {
        Text(
            LocalDateTime.ofInstant(Instant.ofEpochMilli(event.start), zone).format(hm),
            style = Type.caption.copy(color = Paper.inkSoft),
            modifier = Modifier.padding(end = 12.dp),
        )
        Column {
            Text(event.title, style = Type.body)
            if (event.location.isNotBlank()) Text(event.location, style = Type.caption)
        }
    }
}

private fun dateOf(epochMillis: Long, zone: ZoneId): String =
    Instant.ofEpochMilli(epochMillis).atZone(zone).toLocalDate().toString()
```

- [ ] **Step 2: 实现 FocusScreen.kt**

```kotlin
package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.data.FocusSession
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import kotlinx.coroutines.delay

@Composable
fun FocusScreen(
    state: AppUiState,
    onStart: (String, Int) -> Unit,
    onControl: (String) -> Unit,
    onBack: () -> Unit,
) {
    val active = state.planner.focusSessions
        .firstOrNull { it.status == "running" || it.status == "paused" }
    var task by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf(state.planner.focusMinutes.toString()) }

    Column(Modifier.fillMaxSize().background(Paper.page)) {
        PageHeader(title = "专注", action = { TextButton(onClick = onBack) { Text("返回", style = Type.caption) } })
        Column(
            Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (active == null) {
                Text("开始一段专注", style = Type.sectionTitle)
                Spacer(Modifier.height(20.dp))
                OutlinedTextField(
                    value = task,
                    onValueChange = { task = it },
                    label = { Text("要做什么") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = minutes,
                    onValueChange = { minutes = it },
                    label = { Text("分钟（1–180）") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
                Spacer(Modifier.height(20.dp))
                Button(
                    onClick = { onStart(task.ifBlank { "专注" }, minutes.toIntOrNull() ?: 25) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Paper.brand),
                ) { Text("开始", style = Type.body) }
            } else {
                Text(active.task, style = Type.sectionTitle, textAlign = TextAlign.Center)
                Spacer(Modifier.height(20.dp))
                Countdown(active)
                Spacer(Modifier.height(12.dp))
                Text(
                    if (active.status == "paused") "已暂停" else "进行中",
                    style = Type.caption,
                )
                Spacer(Modifier.height(24.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (active.status == "running") {
                        OutlinedButton(
                            onClick = { onControl("pause") },
                            modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                        ) { Text("暂停", style = Type.body) }
                    } else {
                        Button(
                            onClick = { onControl("resume") },
                            modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Paper.brand),
                        ) { Text("继续", style = Type.body) }
                    }
                    OutlinedButton(
                        onClick = { onControl("cancel") },
                        modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                    ) { Text("结束", style = Type.body.copy(color = Paper.red)) }
                }
            }
        }
    }
}

@Composable
private fun Countdown(session: FocusSession) {
    // 用 segments 与当前时间算剩余，不依赖定时器精度；tick 只为驱动重绘。
    var tick by remember(session.id) { mutableIntStateOf(0) }
    LaunchedEffect(session.id, session.status) {
        while (session.status == "running") {
            delay(1_000)
            tick += 1
        }
    }
    val now = System.currentTimeMillis()
    // segment 只存了 end；start 从上一段 end 或 startedAt 推出。
    var cursor = session.startedAt
    var elapsedMillis = 0L
    session.segments.forEachIndexed { index, end ->
        val start = session.segments.getOrNull(index - 1) ?: cursor
        val segmentEnd = end ?: now
        elapsedMillis += maxOf(0L, segmentEnd - start)
        cursor = segmentEnd
    }
    val remaining = (session.minutes * 60_000L - elapsedMillis).coerceAtLeast(0L)
    val text = "%02d:%02d".format(remaining / 60_000, (remaining / 1_000) % 60)
    Text(
        text,
        style = Type.figureLarge.copy(fontSize = Type.figureLarge.fontSize * 2.2f),
        color = Paper.brand,
    )
}
```

- [ ] **Step 3: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/ui/ScheduleScreen.kt android/app/src/main/java/com/shunshou/app/ui/FocusScreen.kt
git commit -m "feat(app): 日程页与专注页"
```

---

## Task 13: 我的页

**Files:**
- Create: `android/app/src/main/java/com/shunshou/app/ui/MeScreen.kt`

**Interfaces:**
- Consumes: `AppUiState`, `Paper`, `Type`, `Dimens`, `PageHeader`, `RuleLine`
- Produces: `@Composable fun MeScreen(state: AppUiState, onSignOut: () -> Unit, onRefresh: () -> Unit)`

采集开关读取系统无障碍服务状态（不修改旧 `PaymentAccessibilityService`），点击跳系统设置页。

- [ ] **Step 1: 实现 MeScreen.kt**

```kotlin
package com.shunshou.app.ui

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.RuleLine
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type

@Composable
fun MeScreen(state: AppUiState, onSignOut: () -> Unit, onRefresh: () -> Unit) {
    val context = LocalContext.current
    var confirmSignOut by remember { mutableStateOf(false) }
    val captureOn = remember {
        // 只读系统设置判断采集服务是否开启，不改动旧采集类。
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?.contains(context.packageName + "/.PaymentAccessibilityService") == true
    }

    Column(Modifier.fillMaxSize().background(Paper.page).verticalScroll(rememberScrollState())) {
        PageHeader(title = "我的")
        SettingRow(
            title = if (state.username.isBlank()) "未登录" else state.username,
            subtitle = "账号数据在云端，按账号隔离",
        )
        RuleLine()
        SettingRow(
            title = "采集支付",
            subtitle = if (captureOn) "已开启：只读支付结果页" else "未开启：点此去系统设置开启",
            onClick = {
                context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            },
        )
        RuleLine()
        SettingRow(title = "刷新数据", subtitle = if (state.loading) "正在刷新…" else "从云端拉取最新账本与日程", onClick = onRefresh)
        RuleLine()
        SettingRow(title = "退出登录", subtitle = "退出后本机不再保留会话", danger = true, onClick = { confirmSignOut = true })
        RuleLine()
        Spacer(Modifier.height(20.dp))
        Text("顺手 v1.0 · 纸与墨", style = Type.caption, modifier = Modifier.padding(horizontal = Dimens.gutter))
    }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text("退出登录？", style = Type.sectionTitle) },
            text = { Text("云端数据不会删除，下次登录还能看到。", style = Type.caption) },
            confirmButton = {
                TextButton(onClick = { confirmSignOut = false; onSignOut() }) {
                    Text("退出", style = Type.caption.copy(color = Paper.red))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmSignOut = false }) { Text("取消", style = Type.caption) }
            },
        )
    }
}

@Composable
private fun SettingRow(
    title: String,
    subtitle: String,
    danger: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = Dimens.gutter, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text(title, style = Type.body.copy(color = if (danger) Paper.red else Paper.ink))
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = Type.caption)
        }
    }
}
```

- [ ] **Step 2: 编译并构建 APK**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" assembleDebug`
Expected: `BUILD SUCCESSFUL`，产出 `android/app/build/outputs/apk/debug/app-debug.apk`

- [ ] **Step 3: 真机验证（用户操作）**

把 APK 拷到安卓手机安装，按顺序验证并截图反馈：

1. 打开 App 看到登录页 → 注册新账号 → 进入首页
2. 首页显示今日收支、快捷入口
3. 记一笔支出 → 返回首页看到数字变化
4. 账本页看到该笔记录
5. 杀进程重开 → 仍在登录态，数据还在

- [ ] **Step 4: 提交**

```bash
git add android/app/src/main/java/com/shunshou/app/ui/MeScreen.kt
git commit -m "feat(app): 我的页"
```

---

## Task 14: Web 窄屏底部导航

**Files:**
- Modify: `src/app/Shell.tsx`
- Modify: `src/styles.css`
- Test: `e2e/foundation.spec.ts`（现有 375px 用例需保持通过）

**Interfaces:**
- Consumes: `navigation`, `Tab` 概念对齐 App（首页/账本/日程/我的）
- Produces: `.mobile-tabbar` 类名；窄屏下渲染 4 个 Tab + 更多入口

现有 `e2e/foundation.spec.ts` 的 `getByRole('navigation', { name: '主导航' })` 必须继续可用，因此移动 Tab 也要放在 `aria-label="主导航"` 的 nav 内，或保留原 nav 只做样式改造。

- [ ] **Step 1: 改造 Shell 导航结构，让窄屏复用同一 nav**

在 `src/app/Shell.tsx` 中，把 `<nav aria-label="主导航" className="main-nav">` 改为同时承载桌面分组与移动 Tab，保持 `aria-label="主导航"` 不变。窄屏下通过 CSS 只显示 4 个高频项：

```tsx
{/* 移动端底部 Tab：窄屏只展示高频四项，其余在设置页可达 */}
<nav aria-label="主导航" className="main-nav">
  {navigationGroups.map((group) => (
    <div className="nav-group" key={group.title}>
      <span className="nav-caption">{group.title}</span>
      {group.items.map(({ path, label, icon: Icon }) => (
        <NavLink key={path} to={path} end={path === '/'}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}${mobilePrimaryPaths.has(path) ? ' mobile-primary' : ''}`}>
          <Icon size={19} strokeWidth={1.7} /><span>{label}</span>
        </NavLink>
      ))}
    </div>
  ))}
</nav>
```

在文件顶部加：

```tsx
const mobilePrimaryPaths = new Set(['/', '/ledger', '/schedule', '/settings']);
```

注意：底部 Tab 的 4 项与 App 对齐（首页 / 周账单 / 日程 / 设置），不再额外加「更多」——其余页面（记一笔、专注、校园等）从首页与设置页进入。

- [ ] **Step 2: 加窄屏样式**

在 `src/styles.css` 的 `@media (max-width: 640px)` 块内替换原有 `.sidebar`、`.main-nav`、`.nav-item`、`.workspace` 相关规则为：

```css
/* 移动端：把侧栏导航变成底部固定 Tab */
.sidebar { position: fixed; inset: auto 0 0 0; z-index: 40; width: 100%; padding: 0; border-right: 0; border-top: 1px solid var(--rule-strong); background: var(--sheet); }
.brand, .assistant-entry, .nav-caption, .sidebar-bottom { display: none; }
.nav-group { display: contents; }
.main-nav { position: static; display: flex; justify-content: space-around; gap: 0; overflow: visible; padding: 4px 2px calc(4px + env(safe-area-inset-bottom)); }
.nav-item { flex: 1; flex-direction: column; gap: 3px; min-height: 56px; padding: 6px 2px; border-radius: 0; font-size: 11px; position: relative; }
.nav-item:not(.mobile-primary) { display: none; }
.nav-item.mobile-primary { display: flex; }
.nav-item.active { background: transparent; color: var(--brand-deep); }
.nav-item.active::before { display: none; }
.nav-item.active::after { content: ""; position: absolute; top: 0; left: 50%; width: 18px; height: 2px; margin-left: -9px; background: var(--red); }
.workspace { margin-left: 0; width: 100%; padding-bottom: 68px; }
.topbar { height: 48px; }
```

- [ ] **Step 3: 更新移动端 e2e 用例以匹配新导航**

`e2e/foundation.spec.ts` 的 `mobile pages fit 375px` 用例中，原第 68-74 行点击「今天」与「设置」：

```ts
const nav = page.getByRole('navigation', { name: '主导航' });
await nav.getByRole('link', { name: '今天', exact: true }).click();
```

改为点击移动端可见的「周账单」：

```ts
const nav = page.getByRole('navigation', { name: '主导航' });
await nav.getByRole('link', { name: '周账单', exact: true }).click();
```

其后 `nav.getByRole('link', { name: '设置' })` 保持不变（设置仍在 4 个 Tab 内）。

- [ ] **Step 4: 跑现有测试确认未破坏**

Run: `npx vitest run src/app/App.test.tsx`
Expected: 全部通过

Run: `npx playwright test e2e/foundation.spec.ts`
Expected: 通过；若 375px 用例中「标题不被导航遮挡」断言失败，说明底部 Tab 与吸顶导航相互影响，调整 `.workspace { padding-bottom }` 与 `scroll-margin-top` 后重跑

- [ ] **Step 5: 手动确认桌面端零改动**

Run: `npm run dev`，浏览器 1440px 宽打开，确认侧栏仍为左侧竖排、无底部 Tab

- [ ] **Step 6: 提交**

```bash
git add src/app/Shell.tsx src/styles.css e2e/foundation.spec.ts
git commit -m "feat(web): 手机窄屏底部导航"
```

---

## Task 15: 收尾与演示准备

**Files:**
- Modify: `docs/superpowers/specs/2026-11-23-mobile-app-design.md`（状态改「已实现」）
- 无代码改动

- [ ] **Step 1: 全量回归**

Run: `cd android && "C:/Users/niangao/.gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle" testDebugUnitTest assembleDebug`
Expected: 全部单测通过、APK 产出

Run: `npx vitest run && npm run build`
Expected: 前端测试通过、构建成功

- [ ] **Step 2: 真机走查清单（用户操作，逐项截图）**

1. 冷启动 → 登录页
2. 注册 → 首页（今日收支为 0）
3. 记一笔支出 18.50 → 首页支出变为 18.50
4. 账本页出现该记录，周切换正常
5. 网页同账号登录 → 看到同一笔（跨端一致）
6. 日程页显示本周条目，今天有高亮
7. 专注：开始 → 暂停 → 继续 → 结束
8. 我的：采集开关状态与系统一致；退出登录回登录页

- [ ] **Step 3: 更新 spec 状态并提交**

把 spec 第 3 行 `状态：待评审` 改为 `状态：已实现（2026-11-23 起执行）`。

```bash
git add docs/superpowers/specs/2026-11-23-mobile-app-design.md
git commit -m "docs: 手机 App 设计状态更新"
```

---

## 风险与砍范围顺序

时间不够时从后往前砍：**专注（Task 12 后半） → 日程（Task 12 前半） → 工时收入（Task 10 的收入分支） → Web 窄屏（Task 14）**。

**不可砍**：Task 1–4（骨架与连通）、Task 7（壳）、Task 8（登录）、Task 9（首页）、Task 10 支出、Task 11（账本）。
