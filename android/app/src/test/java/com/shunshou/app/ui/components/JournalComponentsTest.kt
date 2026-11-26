package com.shunshou.app.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class JournalComponentsTest {
    @Test
    fun formatsJournalDateWithEnglishWeekdayAndMonth() {
        assertEquals("TUE, NOV 24", JournalDateLabel.format(LocalDate.of(2026, 11, 24)))
    }

    @Test
    fun formatsSingleDigitDateWithoutZeroPadding() {
        assertEquals("SAT, MAR 7", JournalDateLabel.format(LocalDate.of(2026, 3, 7)))
    }
}
