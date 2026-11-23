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
