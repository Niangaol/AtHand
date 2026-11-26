package com.shunshou.app.data

import com.shunshou.collector.CalendarReadResult
import java.time.Instant
import java.time.ZoneId

object CalendarSyncPolicy {
    fun shouldSkip(force: Boolean, lastSuccessDay: String, today: String, remoteFetchedAt: Long): Boolean {
        if (force || lastSuccessDay != today || remoteFetchedAt <= 0L) return false
        val remoteDay = Instant.ofEpochMilli(remoteFetchedAt)
            .atZone(ZoneId.systemDefault()).toLocalDate().toString()
        return remoteDay == today
    }

    fun message(result: CalendarReadResult): String = when {
        !result.available -> "已同步权限撤销，网页不再展示此来源"
        result.complete -> "已同步未来14天，共${result.items.size}条"
        else -> "已同步部分结果；${result.error}，未删除旧日程"
    }
}
