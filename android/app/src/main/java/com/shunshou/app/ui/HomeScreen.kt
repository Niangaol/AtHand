package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
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
import com.shunshou.app.domain.LedgerMath
import com.shunshou.app.ui.components.EmptyHint
import com.shunshou.app.ui.components.FigureText
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.RuleLine
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val iso = DateTimeFormatter.ISO_LOCAL_DATE

@Composable
fun HomeScreen(state: AppUiState, onGoEntry: () -> Unit, onGoFocus: () -> Unit) {
    val today = remember { LocalDate.now().format(iso) }
    val dayTotals = remember(state.ledger, today) {
        LedgerMath.summarize(state.ledger.records, today, today)
    }
    val weekTotals = remember(state.ledger, today) {
        val (from, to) = LedgerMath.weekRange(null)
        LedgerMath.summarize(state.ledger.records, from, to)
    }
    val todayEvents = remember(state.planner, today) {
        val startOfDay = LocalDate.parse(today).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val endOfDay = startOfDay + 86_400_000L
        state.planner.events.filter { it.start < endOfDay && it.end > startOfDay }
            .sortedBy { it.start }
            .take(5)
    }
    val activeFocus = remember(state.planner) {
        state.planner.focusSessions.firstOrNull { it.status == "running" || it.status == "paused" }
    }

    Column(Modifier.fillMaxSize().background(Paper.page).verticalScroll(rememberScrollState())) {
        PageHeader(title = "今天", subtitle = today)
        Column(Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp)) {
            Text("今日收支", style = Type.caption)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                Column {
                    Text("支出", style = Type.caption)
                    FigureText(LedgerMath.formatYuan(dayTotals.expenseCents), Type.figureLarge.copy(color = Paper.red))
                }
                Column {
                    Text("收入", style = Type.caption)
                    FigureText(LedgerMath.formatYuan(dayTotals.incomeCents), Type.figureLarge.copy(color = Paper.brand))
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "本周支出 ${LedgerMath.formatYuan(weekTotals.expenseCents)} · 收入 ${LedgerMath.formatYuan(weekTotals.incomeCents)}",
                style = Type.caption,
            )
        }

        RuleLine()
        Column(Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp)) {
            Text("今日安排", style = Type.sectionTitle)
            Spacer(Modifier.height(10.dp))
            if (todayEvents.isEmpty()) {
                EmptyHint("今天没有安排。要不要先把账记一记？")
            } else {
                val zone = ZoneId.systemDefault()
                todayEvents.forEach { event ->
                    val start = LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(event.start), zone)
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 7.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Text(
                            start.format(DateTimeFormatter.ofPattern("HH:mm")),
                            style = Type.caption.copy(color = Paper.inkSoft),
                            modifier = Modifier.padding(end = 12.dp),
                        )
                        Column {
                            Text(event.title, style = Type.body)
                            if (event.location.isNotBlank()) Text(event.location, style = Type.caption)
                        }
                    }
                }
            }
        }

        if (activeFocus != null) {
            RuleLine()
            Column(Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp)) {
                Text("正在专注", style = Type.sectionTitle)
                Spacer(Modifier.height(6.dp))
                Text("${activeFocus.task} · ${activeFocus.minutes} 分钟", style = Type.body)
                Text(if (activeFocus.status == "paused") "已暂停" else "进行中", style = Type.caption)
            }
        }

        RuleLine()
        Row(Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            QuickAction("记一笔", "支出、收入或工时", Modifier.weight(1f), onGoEntry)
            QuickAction("专注", "25 分钟起步", Modifier.weight(1f), onGoFocus)
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun QuickAction(
    title: String,
    hint: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier.fillMaxWidth().heightIn(min = 84.dp)
            .background(Paper.sheet, androidx.compose.foundation.shape.RoundedCornerShape(Dimens.rMd))
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, style = Type.sectionTitle)
        Spacer(Modifier.height(2.dp))
        Text(hint, style = Type.caption)
    }
}
