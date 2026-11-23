package com.shunshou.app.domain

import com.shunshou.app.data.RecordEntry
import java.time.LocalDate
import java.time.format.DateTimeFormatter

data class Totals(val incomeCents: Long, val expenseCents: Long, val workMinutes: Int)

object LedgerMath {
    private val iso: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    fun summarize(records: List<RecordEntry>, from: String, to: String): Totals {
        var income = 0L
        var expense = 0L
        var minutes = 0
        for (record in records) {
            if (record.source == "demo") continue
            if (record.date < from || record.date > to) continue
            if (record.type == "expense") expense += record.amountCents
            if (record.type == "work") {
                income += record.amountCents
                minutes += record.durationMinutes ?: 0
            }
        }
        return Totals(income, expense, minutes)
    }

    fun mondayOf(date: String): String {
        val parsed = LocalDate.parse(date, iso)
        return parsed.minusDays((parsed.dayOfWeek.value - 1).toLong()).format(iso)
    }

    fun shiftDays(date: String, days: Int): String =
        LocalDate.parse(date, iso).plusDays(days.toLong()).format(iso)

    fun weekRange(mondayIso: String?): Pair<String, String> {
        val monday = mondayIso ?: mondayOf(LocalDate.now().format(iso))
        return monday to shiftDays(monday, 6)
    }

    fun groupByDate(records: List<RecordEntry>): List<Pair<String, List<RecordEntry>>> =
        records.filter { it.source != "demo" }
            .groupBy { it.date }
            .toList()
            .sortedByDescending { it.first }

    fun byCategory(records: List<RecordEntry>): List<Pair<String, Long>> =
        records.filter { it.type == "expense" && it.source != "demo" }
            .groupBy { it.category ?: "其他" }
            .map { (category, rows) -> category to rows.sumOf { it.amountCents } }
            .sortedByDescending { it.second }

    fun formatYuan(cents: Long): String {
        val sign = if (cents < 0) "-" else ""
        val abs = kotlin.math.abs(cents)
        return "$sign${abs / 100}.${(abs % 100).toString().padStart(2, '0')}"
    }
}
