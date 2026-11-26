package com.shunshou.app.ui.components

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

object JournalDateLabel {
    private val date = DateTimeFormatter.ofPattern("EEE, MMM d", Locale.US)

    fun format(value: LocalDate): String = value.format(date).uppercase(Locale.US)
}
