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
    // 网页端 isLedgerState 要求 settings.hourlyRateCents > 0；缺失时用这个默认值而不是 0，
    // 否则手机写回的账本会被网页判为「格式无法识别」。
    companion object { val EMPTY = LedgerState(1, emptyList(), emptyList(), 2000L) }
}

data class PlannerEvent(
    val id: String, val title: String, val kind: String, val location: String,
    val start: Long, val end: Long, val allDay: Boolean, val source: String,
)

data class FocusSegment(val start: Long, val end: Long?)

data class FocusSession(
    val id: String, val task: String, val minutes: Int, val startedAt: Long, val status: String,
    val segments: List<FocusSegment>, val owner: String, val epoch: Int,
)

data class PlannerSnapshot(
    val revision: Int, val events: List<PlannerEvent>, val focusSessions: List<FocusSession>,
    val focusMinutes: Int,
) {
    companion object { val EMPTY = PlannerSnapshot(0, emptyList(), emptyList(), 25) }
}

object Models {
    private val VALID_SOURCES = setOf("demo", "manual", "school", "import")
    private val EXPENSE_CATEGORIES = setOf("吃饭", "交通", "日用", "娱乐", "学习", "其他")

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
                source = row.optString("source").takeIf { it in VALID_SOURCES } ?: "manual",
            )
        }
        val workplaces = (ledger.optJSONArray("workplaces") ?: JSONArray()).objects().map { row ->
            Workplace(
                id = row.optString("id"), name = row.optString("name"),
                hourlyRateCents = row.optLong("hourlyRateCents"),
                description = row.optString("description"),
                source = row.optString("source").takeIf { it == "demo" || it == "manual" } ?: "manual",
            )
        }
        val settings = ledger.optJSONObject("settings")
        // 0 与「缺失」在网页端语义不同：positiveInteger 要求 > 0，所以 0 一律归一为默认值。
        val rate = settings?.optLong("hourlyRateCents") ?: 0L
        return LedgerState(
            version = ledger.optInt("version", 1), records = records, workplaces = workplaces,
            hourlyRateCents = if (rate > 0L) rate else 2000L,
        )
    }

    /**
     * 网页端 isLedgerState 的等价校验。服务端 validLedger 很宽松，
     * 不合规的记录能落库但会让网页整份拒收，所以写回前必须自己拦一遍。
     */
    fun ledgerProblems(state: LedgerState): List<String> {
        val problems = mutableListOf<String>()
        if (state.version != 1) problems += "账本版本必须是 1"
        if (state.hourlyRateCents <= 0L) problems += "默认时薪必须大于 0"
        val unitIds = state.workplaces.map { it.id }.toSet()
        state.workplaces.forEach { unit ->
            if (unit.id.isBlank()) problems += "单位缺少 id"
            if (unit.name.isBlank()) problems += "单位「${unit.id}」缺少名称"
            if (unit.hourlyRateCents <= 0L) problems += "单位「${unit.name}」时薪必须大于 0"
            if (unit.source != "demo" && unit.source != "manual") problems += "单位「${unit.name}」来源非法"
        }
        state.records.forEach { record ->
            if (record.id.isBlank()) problems += "记录缺少 id"
            if (record.source !in VALID_SOURCES) problems += "记录「${record.title}」来源非法"
            if (record.amountCents <= 0L) problems += "记录「${record.title}」金额必须大于 0"
            if (record.type == "expense") {
                if (record.category !in EXPENSE_CATEGORIES) problems += "记录「${record.title}」分类非法"
            } else if (record.type == "work") {
                val minutes = record.durationMinutes ?: 0
                val rate = record.hourlyRateCents ?: 0L
                if (record.workplaceId !in unitIds) problems += "记录「${record.title}」的单位不存在"
                if (minutes <= 0 || minutes > 1440) problems += "记录「${record.title}」时长必须在 1-1440 分钟"
                if (rate <= 0L) problems += "记录「${record.title}」时薪必须大于 0"
                if (record.amountCents != (minutes.toLong() * rate + 30) / 60) problems += "记录「${record.title}」金额与时长×时薪不一致"
            } else {
                problems += "记录「${record.title}」类型非法"
            }
        }
        if (state.records.map { it.id }.toSet().size != state.records.size) problems += "记录 id 有重复"
        return problems
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
            // segment 的 start 必须保留：暂停→继续后两段之间的间隙不能算作专注时长。
            val segments = (row.optJSONArray("segments") ?: JSONArray()).let { array ->
                (0 until array.length()).mapNotNull { i ->
                    val item = array.optJSONObject(i) ?: return@mapNotNull null
                    FocusSegment(start = item.optLong("start"), end = item.optLongOrNull("end"))
                }
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
                            row.segments.forEach { segment ->
                                put(JSONObject().apply {
                                    put("start", segment.start)
                                    if (segment.end == null) put("end", JSONObject.NULL) else put("end", segment.end)
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
