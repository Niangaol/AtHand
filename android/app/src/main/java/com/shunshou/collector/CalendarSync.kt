package com.shunshou.collector

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.util.UUID

object CalendarSync {
    @Synchronized fun sync(context: Context, force: Boolean = false): Boolean {
        val settings = context.getSharedPreferences("shunshou_probe", Context.MODE_PRIVATE)
        val base = SyncClient.urlOrDefault(settings.getString("syncUrl", null)).trimEnd('/')
        val password = settings.getString("syncPassword", "").orEmpty()
        val prefs = context.getSharedPreferences("shunshou_calendar", Context.MODE_PRIVATE)
        if (password.isBlank()) { prefs.edit().putString("status", "先保存电脑地址和访问口令").apply(); return false }
        val key = syncIdentity(base, "")
        val snapshot = CalendarReader.read(context)
        val today = LocalDate.now().toString()
        val availableKey = "$key:available"
        if (!force && prefs.getString("$key:day", "") == today && prefs.getBoolean(availableKey, !snapshot.available) == snapshot.available && !prefs.contains("$key:pending")) return true
        try {
            val token = SyncSession.token(context, base, password)
            val remote = SyncClient.calendars(base, token)
            val serverId = remote.getString("serverId")
            val known = prefs.getString("$key:serverId", null)
            check(known == null || known == serverId) { "服务器身份改变，请使用新的连接地址" }
            check(prefs.edit().putString("$key:serverId", serverId).commit()) { "无法保存服务器身份" }
            val source = CalendarReader.sourceId(context)
            val sources = remote.getJSONArray("sources")
            var revision = 0L
            for (i in 0 until sources.length()) if (sources.getJSONObject(i).getString("sourceId") == source) revision = sources.getJSONObject(i).getLong("revision")
            val pending = prefs.getString("$key:pending", null)
            if (pending != null) {
                try {
                    revision = SyncClient.uploadCalendar(base, token, pending).getLong("revision")
                    check(prefs.edit().remove("$key:pending").commit()) { "无法保存上传确认" }
                } catch (error: SyncHttpException) {
                    if (!calendarRejectIsFinal(error.status)) throw error
                    check(prefs.edit().putString("$key:rejected", pending).remove("$key:pending").commit()) { "无法保存拒绝记录" }
                    if (error.status == 409) {
                        prefs.edit().putString("status", "日历版本冲突，保留服务器数据，下次刷新重试").apply()
                        return false
                    }
                }
            }
            val events = JSONArray()
            for (item in snapshot.items) events.put(JSONObject().apply {
                put("id", item.id); put("title", item.title); put("location", item.location)
                put("kind", "event"); put("start", item.begin); put("end", item.end)
                put("allDay", item.allDay); put("timeZone", item.timeZone); put("source", "calendar"); put("sourceId", source)
            })
            val body = JSONObject().apply {
                put("sourceId", source); put("requestId", UUID.randomUUID().toString()); put("baseRevision", revision)
                put("rangeStart", snapshot.window.begin); put("rangeEnd", snapshot.window.end); put("fetchedAt", System.currentTimeMillis())
                put("calendarAvailable", snapshot.available); put("complete", snapshot.complete); put("events", events)
            }.toString()
            check(prefs.edit().putString("$key:pending", body).commit()) { "无法保存待上传日历" }
            SyncClient.uploadCalendar(base, token, body)
            val message = when {
                !snapshot.available -> "已同步权限撤销，网页不再展示此来源"
                snapshot.complete -> "已同步未来14天，共${snapshot.items.size}条"
                else -> "已同步部分结果；${snapshot.error}，未删除旧日程"
            }
            val edit = prefs.edit().remove("$key:pending").putBoolean(availableKey, snapshot.available).putString("status", message)
            if (snapshot.complete || !snapshot.available) edit.putString("$key:day", today)
            if (snapshot.complete) edit.putLong("lastSuccess", System.currentTimeMillis())
            check(edit.commit()) { "无法保存上传确认，下次将安全重试" }
            return snapshot.complete || !snapshot.available
        } catch (error: Exception) {
            if (error is SyncHttpException && error.status == 401) SyncSession.clear(context)
            prefs.edit().putString("status", when {
                error is SyncHttpException && error.status == 401 -> "登录过期，将重新登录后重试"
                error is SyncHttpException && error.status == 400 -> "日历数据被拒绝，请检查日程字段；待上传内容已保留"
                else -> "同步未完成，已保留待上传数据，请检查连接后重试"
            }).apply()
            return false
        }
    }
}
