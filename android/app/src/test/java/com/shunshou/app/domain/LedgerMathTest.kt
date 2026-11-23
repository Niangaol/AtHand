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
