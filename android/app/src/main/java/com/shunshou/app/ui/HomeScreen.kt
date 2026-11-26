package com.shunshou.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.shadow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.domain.LedgerMath
import com.shunshou.app.ui.components.EmptyPaperHint
import com.shunshou.app.ui.components.FigureText
import com.shunshou.app.ui.components.JournalDateLabel
import com.shunshou.app.ui.components.PaperNote
import com.shunshou.app.ui.components.journalPage
import com.shunshou.app.ui.motion.JournalMotionSpec
import com.shunshou.app.ui.motion.LocalJournalMotion
import com.shunshou.app.ui.motion.journalEntrance
import com.shunshou.app.ui.components.PaperQuickAction
import com.shunshou.app.ui.components.SectionHeading
import com.shunshou.app.ui.components.WashiTape
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val iso = DateTimeFormatter.ISO_LOCAL_DATE
private val HomeGutter = 34.dp

@Composable
fun HomeScreen(state: AppUiState, onGoEntry: () -> Unit, onGoFocus: () -> Unit) {
    val todayDate = remember { LocalDate.now() }
    val today = remember { todayDate.format(iso) }
    val dayTotals = remember(state.ledger, today) {
        LedgerMath.summarize(state.ledger.records, today, today)
    }
    val weekTotals = remember(state.ledger, today) {
        val (from, to) = LedgerMath.weekRange(null)
        LedgerMath.summarize(state.ledger.records, from, to)
    }
    val todayEvents = remember(state.planner, today) {
        val startOfDay = todayDate.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val endOfDay = startOfDay + 86_400_000L
        state.allEvents().filter { it.start < endOfDay && it.end > startOfDay }
            .sortedBy { it.start }
            .take(5)
    }
    val activeFocus = remember(state.planner) {
        state.planner.focusSessions.firstOrNull { it.status == "running" || it.status == "paused" }
    }

    val motion = LocalJournalMotion.current
    Column(
        Modifier.fillMaxSize()
            .journalPage()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 22.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = HomeGutter, vertical = 24.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Column(Modifier.weight(1f)) {
                Text("顺手", style = Type.journalNote.copy(color = Paper.brand))
                Spacer(Modifier.height(4.dp))
                Text(JournalDateLabel.format(todayDate), style = Type.pageTitle)
                Text("把今天，慢慢收进这一页。", style = Type.caption, modifier = Modifier.padding(top = 3.dp))
            }
            WashiTape(
                color = Paper.tape,
                modifier = Modifier.padding(top = 5.dp),
            )
        }

        PaperNote(
            modifier = Modifier.padding(horizontal = HomeGutter).journalEntrance(0, motion),
            tapeColor = Paper.tape,
        ) {
            SectionHeading("今日收支")
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(34.dp)) {
                Column {
                    Text("支出", style = Type.caption)
                    JournalAmount(LedgerMath.formatYuan(dayTotals.expenseCents), Paper.red, motion)
                }
                Column {
                    Text("收入", style = Type.caption)
                    JournalAmount(LedgerMath.formatYuan(dayTotals.incomeCents), Paper.brand, motion)
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "本周支出 ${LedgerMath.formatYuan(weekTotals.expenseCents)} · 收入 ${LedgerMath.formatYuan(weekTotals.incomeCents)}",
                style = Type.journalNote,
            )
        }

        Spacer(Modifier.height(Dimens.sectionGap))
        SectionHeading("今日安排", modifier = Modifier.padding(horizontal = HomeGutter))
        Spacer(Modifier.height(10.dp))
        if (todayEvents.isEmpty()) {
            EmptyPaperHint(
                "今天还没有安排。留一点空白，也很好。",
                modifier = Modifier.padding(horizontal = HomeGutter).journalEntrance(1, motion),
            )
        } else {
            val zone = ZoneId.systemDefault()
            todayEvents.forEachIndexed { index, event ->
                val start = LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(event.start), zone)
                JournalEventRow(
                    time = start.format(DateTimeFormatter.ofPattern("HH:mm")),
                    title = event.title,
                    location = event.location,
                    modifier = Modifier.padding(horizontal = HomeGutter).journalEntrance(index + 1, motion),
                )
            }
        }

        if (activeFocus != null) {
            Spacer(Modifier.height(Dimens.sectionGap))
            PaperNote(
                modifier = Modifier.padding(horizontal = HomeGutter).journalEntrance(2, motion),
                tapeColor = Paper.tapeGreen,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Timer, contentDescription = null, tint = Paper.brand, modifier = Modifier.size(25.dp))
                    Column(Modifier.padding(start = 12.dp)) {
                        Text("正在专注", style = Type.sectionTitle)
                        Text("${activeFocus.task} · ${activeFocus.minutes} 分钟", style = Type.body, modifier = Modifier.padding(top = 3.dp))
                        Text(
                            if (activeFocus.status == "paused") "已暂停" else "进行中",
                            style = Type.caption.copy(color = Paper.brand),
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(26.dp))
        Row(
            Modifier.fillMaxWidth().padding(horizontal = HomeGutter),
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(14.dp),
        ) {
            PaperQuickAction(
                title = "记一笔",
                hint = "支出、收入或工时",
                icon = Icons.Outlined.EditNote,
                tapeColor = Paper.tape,
                modifier = Modifier.weight(1f).journalEntrance(3, motion),
                onClick = onGoEntry,
            )
            PaperQuickAction(
                title = "专注",
                hint = "给今天留一段安静",
                icon = Icons.Outlined.Timer,
                tapeColor = Paper.tapeGreen,
                modifier = Modifier.weight(1f).journalEntrance(4, motion),
                onClick = onGoFocus,
            )
        }
        Spacer(Modifier.height(24.dp))
        Text(
            "— 今日页 —",
            style = Type.journalNote.copy(color = Paper.muted),
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun JournalAmount(text: String, color: Color, motion: JournalMotionSpec) {
    val style = Type.figureLarge.copy(color = color)
    if (motion.enterOffset == 0f) {
        FigureText(text, style)
        return
    }
    AnimatedContent(
        targetState = text,
        transitionSpec = {
            (fadeIn(tween(140)) + scaleIn(tween(140), initialScale = 0.98f))
                .togetherWith(fadeOut(tween(90)) + scaleOut(tween(90), targetScale = 0.99f))
        },
        label = "journal-amount",
    ) { value ->
        FigureText(value, style)
    }
}

@Composable
private fun JournalEventRow(
    time: String,
    title: String,
    location: String,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(3.dp)
    Box(
        modifier.fillMaxWidth()
            .shadow(2.dp, shape, ambientColor = Paper.shadow, spotColor = Paper.shadow)
            .background(Paper.sheet, shape)
            .border(1.dp, Paper.rule, shape)
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(48.dp)) {
                Text(time, style = Type.caption.copy(color = Paper.red))
                Spacer(Modifier.height(5.dp))
                Box(Modifier.size(7.dp).background(Paper.red, CircleShape))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = Type.body)
                if (location.isNotBlank()) Text(location, style = Type.caption, modifier = Modifier.padding(top = 2.dp))
            }
            Box(
                Modifier.size(7.dp)
                    .background(Paper.paperEdgeDark, CircleShape)
                    .border(1.dp, Paper.sheet, CircleShape),
            )
        }
    }
}
