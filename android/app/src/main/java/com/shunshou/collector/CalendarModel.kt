package com.shunshou.collector

import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

data class CalendarWindow(val begin: Long, val end: Long) {
    companion object {
        fun around(now: Long, zone: ZoneId = ZoneId.systemDefault()): CalendarWindow {
            val day = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
            return CalendarWindow(day.atStartOfDay(zone).toInstant().toEpochMilli(), day.plusDays(14).atStartOfDay(zone).toInstant().toEpochMilli())
        }
    }
}

fun calendarInstanceId(source: String, eventId: Long, originalBegin: Long): String = "$source:$eventId:$originalBegin"
fun calendarStableId(source: String, eventId: Long, begin: Long, recurring: Boolean, originalId: Long? = null, originalBegin: Long? = null): String =
    if (originalId != null && originalBegin != null) calendarInstanceId(source, originalId, originalBegin)
    else if (recurring) calendarInstanceId(source, eventId, begin) else "$source:$eventId:single"
fun calendarRejectIsFinal(status: Int): Boolean = status == 400 || status == 409
fun calendarAllDayLocal(stamp: Long, zone: ZoneId): Long = Instant.ofEpochMilli(stamp).atZone(ZoneOffset.UTC).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()

data class CalendarItem(
    val id: String, val title: String, val location: String,
    val begin: Long, val end: Long, val calendarName: String,
    val allDay: Boolean, val timeZone: String,
)
data class CalendarReadResult(
    val window: CalendarWindow, val available: Boolean, val complete: Boolean,
    val items: List<CalendarItem>, val error: String = "",
)
