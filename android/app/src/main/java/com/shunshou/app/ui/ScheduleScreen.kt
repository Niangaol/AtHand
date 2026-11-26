package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.data.PlannerEvent
import com.shunshou.app.domain.LedgerMath
import com.shunshou.app.ui.components.JournalPage
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.PaperListRow
import com.shunshou.app.ui.components.PaperNote
import com.shunshou.app.ui.components.PaperTag
import com.shunshou.app.ui.components.RuleLine
import com.shunshou.app.ui.components.SectionHeading
import com.shunshou.app.ui.motion.LocalJournalMotion
import com.shunshou.app.ui.motion.journalEntrance
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
private val dayLabel = DateTimeFormatter.ofPattern("E")

@Composable
fun ScheduleScreen(state: AppUiState) {
    val zone = ZoneId.systemDefault()
    val monday = remember { LedgerMath.mondayOf(LocalDate.now().toString()) }
    val days = remember(monday) { (0..6).map { LedgerMath.shiftDays(monday, it) } }
    val today = remember { LocalDate.now().toString() }
    val byDate = remember(state.planner, state.calendar, monday) {
        state.allEvents().groupBy { dateOf(it.start, zone) }
    }
    val motion = LocalJournalMotion.current

    JournalPage {
        PageHeader(title = "日程", subtitle = "本周安排")
        PaperNote(
            modifier = Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp).journalEntrance(0, motion),
            tapeColor = Paper.tapeGreen,
        ) {
            SectionHeading("一周索引")
            Spacer(Modifier.height(12.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                days.forEach { date ->
                    val count = byDate[date].orEmpty().size
                    val isToday = date == today
                    Column(
                        Modifier.weight(1f)
                            .background(if (isToday) Paper.tape.copy(alpha = 0.35f) else Paper.kraftWash.copy(alpha = 0.35f), RoundedCornerShape(3.dp))
                            .border(1.dp, if (isToday) Paper.tape else Paper.rule, RoundedCornerShape(3.dp))
                            .padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(LocalDate.parse(date).format(dayLabel), style = Type.caption.copy(color = if (isToday) Paper.red else Paper.muted))
                        Text(LocalDate.parse(date).dayOfMonth.toString(), style = Type.figure)
                        Box(
                            Modifier.padding(top = 4.dp).size(5.dp)
                                .background(if (count > 0) Paper.brand else Paper.ruleStrong, CircleShape),
                        )
                    }
                }
            }
        }

        days.forEachIndexed { index, date ->
            val events = byDate[date].orEmpty().sortedBy { it.start }
            val isToday = date == today
            Column(
                Modifier.fillMaxWidth()
                    .padding(horizontal = Dimens.gutter, vertical = 12.dp)
                    .journalEntrance(index + 1, motion),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        LocalDate.parse(date).format(weekLabel),
                        style = Type.sectionTitle.copy(color = if (isToday) Paper.ink else Paper.inkSoft),
                    )
                    if (isToday) PaperTag("今天", color = Paper.redWash, contentColor = Paper.red)
                    if (events.isNotEmpty()) PaperTag("${events.size} 项", color = Paper.kraftWash, contentColor = Paper.inkSoft)
                }
                Spacer(Modifier.height(8.dp))
                if (events.isEmpty()) {
                    Text("留白", style = Type.journalNote.copy(color = Paper.muted), modifier = Modifier.padding(vertical = 10.dp))
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
    val time = if (event.allDay) "全天" else LocalDateTime.ofInstant(Instant.ofEpochMilli(event.start), zone).format(hm)
    PaperListRow(
        title = event.title,
        subtitle = event.location.ifBlank { "暂无地点" },
        modifier = Modifier.padding(vertical = 4.dp),
        trailing = {
            Column(horizontalAlignment = Alignment.End) {
                Text(time, style = Type.figure.copy(color = Paper.red))
                if (event.source == "calendar") PaperTag("手机日历", color = Paper.brandWash)
            }
        },
    )
}

private fun dateOf(epochMillis: Long, zone: ZoneId): String =
    Instant.ofEpochMilli(epochMillis).atZone(zone).toLocalDate().toString()
