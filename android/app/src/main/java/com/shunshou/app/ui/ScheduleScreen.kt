package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.data.PlannerEvent
import com.shunshou.app.domain.LedgerMath
import com.shunshou.app.ui.components.EmptyHint
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.RuleLine
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val hm = DateTimeFormatter.ofPattern("HH:mm")
private val weekLabel = DateTimeFormatter.ofPattern("M月d日")

@Composable
fun ScheduleScreen(state: AppUiState) {
    val zone = ZoneId.systemDefault()
    val monday = remember { LedgerMath.mondayOf(LocalDate.now().toString()) }
    val days = remember(monday) { (0..6).map { LedgerMath.shiftDays(monday, it) } }
    val today = remember { LocalDate.now().toString() }
    val byDate = remember(state.planner, monday) {
        state.planner.events.groupBy { dateOf(it.start, zone) }
    }

    Column(Modifier.fillMaxSize().background(Paper.page).verticalScroll(rememberScrollState())) {
        PageHeader(title = "日程", subtitle = "本周")
        days.forEach { date ->
            val events = byDate[date].orEmpty().sortedBy { it.start }
            val isToday = date == today
            Column(
                Modifier.fillMaxWidth()
                    .background(if (isToday) Paper.brandWash else Paper.page)
                    .padding(horizontal = Dimens.gutter, vertical = 12.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        LocalDate.parse(date).format(weekLabel),
                        style = Type.sectionTitle.copy(color = if (isToday) Paper.ink else Paper.inkSoft),
                    )
                    if (isToday) {
                        Spacer(Modifier.height(0.dp))
                        Text("今天", style = Type.caption.copy(color = Paper.red))
                    }
                }
                Spacer(Modifier.height(6.dp))
                if (events.isEmpty()) {
                    Text("空闲", style = Type.caption)
                } else {
                    events.forEach { event -> EventRow(event, zone) }
                }
            }
            RuleLine()
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun EventRow(event: PlannerEvent, zone: ZoneId) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.Top) {
        Text(
            LocalDateTime.ofInstant(Instant.ofEpochMilli(event.start), zone).format(hm),
            style = Type.caption.copy(color = Paper.inkSoft),
            modifier = Modifier.padding(end = 12.dp),
        )
        Column {
            Text(event.title, style = Type.body)
            if (event.location.isNotBlank()) Text(event.location, style = Type.caption)
        }
    }
}

private fun dateOf(epochMillis: Long, zone: ZoneId): String =
    Instant.ofEpochMilli(epochMillis).atZone(zone).toLocalDate().toString()
