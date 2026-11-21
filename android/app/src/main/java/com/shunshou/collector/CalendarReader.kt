package com.shunshou.collector

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract.Instances
import java.time.ZoneId
import java.util.UUID

object CalendarReader {
    @Synchronized fun sourceId(context: Context): String {
        val prefs = context.getSharedPreferences("shunshou_calendar", Context.MODE_PRIVATE)
        return prefs.getString("sourceId", null) ?: "phone:${UUID.randomUUID()}".also {
            check(prefs.edit().putString("sourceId", it).commit()) { "设备标识保存失败" }
        }
    }

    fun read(context: Context): CalendarReadResult {
        val zone = ZoneId.systemDefault()
        val window = CalendarWindow.around(System.currentTimeMillis(), zone)
        if (context.checkSelfPermission(Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) {
            return CalendarReadResult(window, false, false, emptyList())
        }
        val result = mutableListOf<CalendarItem>()
        var skipped = 0
        return try {
            val source = sourceId(context)
            // 全天实例由系统按UTC日期保存，额外查询边缘再按本地日期筛选。
            val uri = Instances.CONTENT_URI.buildUpon().appendPath((window.begin - 86400000).toString()).appendPath((window.end + 86400000).toString()).build()
            val projection = arrayOf(Instances.EVENT_ID, Instances.TITLE, Instances.EVENT_LOCATION, Instances.BEGIN, Instances.END, Instances.CALENDAR_DISPLAY_NAME, Instances.ALL_DAY, Instances.EVENT_TIMEZONE, Instances.RRULE, Instances.RDATE, Instances.ORIGINAL_ID, Instances.ORIGINAL_INSTANCE_TIME)
            val cursor = context.contentResolver.query(uri, projection, null, null, "${Instances.BEGIN} ASC")
                ?: return CalendarReadResult(window, true, false, emptyList(), "日历提供方没有返回结果")
            cursor.use {
                while (it.moveToNext()) {
                    val originalBegin = it.getLong(3)
                    val allDay = it.getInt(6) != 0
                    val begin = if (allDay) calendarAllDayLocal(originalBegin, zone) else originalBegin
                    val end = if (allDay) calendarAllDayLocal(it.getLong(4), zone) else it.getLong(4)
                    if (begin >= window.end || end <= window.begin) continue
                    if (end <= begin) throw IllegalStateException("日历包含无效起止时间")
                    if (result.size >= 5000) return CalendarReadResult(window, true, false, result, "日程超过5000条，本次仅部分读取")
                    val title = it.getString(1)?.takeIf(String::isNotBlank) ?: "(无标题)"
                    val location = it.getString(2).orEmpty()
                    if (title.length > 100 || location.length > 200) { skipped++; continue }
                    val timeZone = if (allDay) zone.id else it.getString(7)?.takeIf { value -> ZoneId.getAvailableZoneIds().contains(value) } ?: zone.id
                    val recurring = !it.getString(8).isNullOrBlank() || !it.getString(9).isNullOrBlank()
                    val originalId = if (it.isNull(10)) null else it.getLong(10)
                    val originalTime = if (it.isNull(11)) null else it.getLong(11)
                    val id = calendarStableId(source, it.getLong(0), originalBegin, recurring, originalId, originalTime)
                    result.add(CalendarItem(id, title, location, begin, end, it.getString(5).orEmpty(), allDay, timeZone))
                }
            }
            CalendarReadResult(window, true, skipped == 0, result.distinctBy { it.id }, if (skipped == 0) "" else "$skipped 条日程标题或地点过长，已跳过；未删除旧记录")
        } catch (_: SecurityException) {
            CalendarReadResult(window, false, false, emptyList(), "日历权限已撤销")
        } catch (_: Exception) {
            CalendarReadResult(window, true, false, result.distinctBy { it.id }, "日历读取失败，未删除旧记录")
        }
    }
}
