package com.shunshou.app.data

import android.content.Context
import com.shunshou.collector.CalendarReader
import java.time.LocalDate
import java.util.UUID

data class CalendarSyncResult(
    val success: Boolean,
    val message: String,
    val state: CalendarState? = null,
    val unauthorized: Boolean = false,
)

object CloudCalendarSync {
    private const val PREFS = "shunshou_app_calendar"

    @Synchronized fun sync(
        context: Context,
        store: SessionStore,
        api: ShunshouApi,
        force: Boolean = false,
    ): CalendarSyncResult {
        val session = store.load()?.takeIf { store.isValid() }
            ?: return CalendarSyncResult(false, "登录已失效，请重新登录。", unauthorized = true)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val sourceId = CalendarReader.sourceId(context)
        val today = LocalDate.now().toString()
        return try {
            var sources = api.fetchCalendar(session.token)
            var remote = sources.firstOrNull { it.sourceId == sourceId }
            if (CalendarSyncPolicy.shouldSkip(
                    force = force,
                    lastSuccessDay = prefs.getString("lastSuccessDay", "").orEmpty(),
                    today = today,
                    remoteFetchedAt = remote?.fetchedAt ?: 0L,
                )
            ) {
                val cached = CalendarState(
                    sources = sources,
                    status = prefs.getString("status", "今天已同步").orEmpty(),
                    lastSuccess = prefs.getLong("lastSuccess", 0L),
                )
                store.cache("calendar", Models.calendarStateJson(cached).toString())
                return CalendarSyncResult(true, "今天已同步", cached)
            }

            val read = CalendarReader.read(context)
            val fetchedAt = System.currentTimeMillis()
            val events = read.items.map { item ->
                PlannerEvent(
                    id = item.id, title = item.title, kind = "event", location = item.location,
                    start = item.begin, end = item.end, allDay = item.allDay, source = "calendar",
                )
            }
            fun upload(baseRevision: Int): CalendarSnapshot {
                val payload = Models.calendarUploadJson(
                    sourceId = sourceId,
                    requestId = UUID.randomUUID().toString(),
                    baseRevision = baseRevision,
                    rangeStart = read.window.begin,
                    rangeEnd = read.window.end,
                    fetchedAt = fetchedAt,
                    calendarAvailable = read.available,
                    complete = read.complete,
                    events = events,
                )
                return api.uploadCalendarSnapshot(session.token, payload)
            }

            val uploaded = try {
                upload(remote?.revision ?: 0)
            } catch (error: ApiException) {
                if (error.status != 409) throw error
                sources = api.fetchCalendar(session.token)
                remote = sources.firstOrNull { it.sourceId == sourceId }
                upload(remote?.revision ?: 0)
            }
            val nextSources = sources.filterNot { it.sourceId == sourceId } + uploaded
            val message = CalendarSyncPolicy.message(read)
            val state = CalendarState(nextSources, message, fetchedAt)
            store.cache("calendar", Models.calendarStateJson(state).toString())
            prefs.edit()
                .putString("status", message)
                .putString("lastSuccessDay", if (read.complete || !read.available) today else "")
                .putLong("lastSuccess", if (read.complete) fetchedAt else prefs.getLong("lastSuccess", 0L))
                .apply()
            CalendarSyncResult(read.complete || !read.available, message, state)
        } catch (error: ApiException) {
            val unauthorized = error.status == 401
            val message = if (unauthorized) "登录已失效，请重新登录。" else ApiErrors.message(error)
            prefs.edit().putString("status", message).apply()
            CalendarSyncResult(false, message, unauthorized = unauthorized)
        } catch (_: Exception) {
            val message = "日历同步未完成，请检查网络后重试。"
            prefs.edit().putString("status", message).apply()
            CalendarSyncResult(false, message)
        }
    }
}
