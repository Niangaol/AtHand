package com.shunshou.app.data

import com.shunshou.collector.CalendarReadResult
import com.shunshou.collector.CalendarWindow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class CalendarSyncPolicyTest {
    @Test
    fun skipsOnlyWhenLocalAndRemoteSucceededToday() {
        val remote = Instant.parse("2026-11-24T08:00:00Z").toEpochMilli()
        assertTrue(CalendarSyncPolicy.shouldSkip(false, "2026-11-24", "2026-11-24", remote))
        assertFalse(CalendarSyncPolicy.shouldSkip(true, "2026-11-24", "2026-11-24", remote))
        assertFalse(CalendarSyncPolicy.shouldSkip(false, "2026-11-23", "2026-11-24", remote))
    }

    @Test
    fun reportsCompletePermissionRevokedAndPartialReads() {
        val window = CalendarWindow(0L, 1_000L)
        assertEquals("已同步未来14天，共2条", CalendarSyncPolicy.message(CalendarReadResult(window, true, true, listOf(
            com.shunshou.collector.CalendarItem("1", "课程", "", 0L, 1L, "日历", false, "Asia/Shanghai"),
            com.shunshou.collector.CalendarItem("2", "会议", "", 0L, 1L, "日历", false, "Asia/Shanghai"),
        ))))
        assertEquals("已同步权限撤销，网页不再展示此来源", CalendarSyncPolicy.message(CalendarReadResult(window, false, false, emptyList())))
        assertEquals("已同步部分结果；读取失败，未删除旧日程", CalendarSyncPolicy.message(CalendarReadResult(window, true, false, emptyList(), "读取失败")))
    }
}
