package com.shunshou.collector

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import java.util.concurrent.TimeUnit

object CalendarReader {
    fun upcoming(context: Context, days: Int = 7): List<CalendarItem> {
        if (context.checkSelfPermission(Manifest.permission.READ_CALENDAR) != PackageManager.PERMISSION_GRANTED) {
            return emptyList()
        }
        val begin = System.currentTimeMillis()
        val end = begin + TimeUnit.DAYS.toMillis(days.toLong())
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon()
            .appendPath(begin.toString())
            .appendPath(end.toString())
            .build()
        val projection = arrayOf(
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
        )
        val result = mutableListOf<CalendarItem>()
        context.contentResolver.query(
            uri, projection, null, null, "${CalendarContract.Instances.BEGIN} ASC"
        )?.use { cursor ->
            val title = cursor.getColumnIndexOrThrow(CalendarContract.Instances.TITLE)
            val location = cursor.getColumnIndexOrThrow(CalendarContract.Instances.EVENT_LOCATION)
            val beginIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.BEGIN)
            val endIndex = cursor.getColumnIndexOrThrow(CalendarContract.Instances.END)
            val calendar = cursor.getColumnIndexOrThrow(CalendarContract.Instances.CALENDAR_DISPLAY_NAME)
            while (cursor.moveToNext() && result.size < 30) {
                result.add(
                    CalendarItem(
                        title = cursor.getString(title) ?: "(无标题)",
                        location = cursor.getString(location).orEmpty(),
                        begin = cursor.getLong(beginIndex),
                        end = cursor.getLong(endIndex),
                        calendarName = cursor.getString(calendar).orEmpty(),
                    )
                )
            }
        }
        return result
    }
}
