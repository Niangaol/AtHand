package com.shunshou.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.data.RecordEntry
import com.shunshou.app.domain.LedgerMath
import com.shunshou.app.ui.components.EmptyHint
import com.shunshou.app.ui.components.FigureText
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
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Composable
fun LedgerScreen(state: AppUiState, onDelete: (String) -> Unit) {
    var monday by remember {
        mutableStateOf(LedgerMath.mondayOf(LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE)))
    }
    val (from, to) = remember(monday) { LedgerMath.weekRange(monday) }
    val weekRecords = remember(state.ledger, from, to) {
        state.ledger.records.filter { it.source != "demo" && it.date in from..to }
    }
    val totals = remember(weekRecords, from, to) { LedgerMath.summarize(weekRecords, from, to) }
    val grouped = remember(weekRecords) { LedgerMath.groupByDate(weekRecords) }
    var pendingDelete by remember { mutableStateOf<String?>(null) }
    val motion = LocalJournalMotion.current

    JournalPage {
        PageHeader(title = "账本", subtitle = "按周查看收支")
        PaperNote(
            modifier = Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp).journalEntrance(0, motion),
            tapeColor = Paper.tape,
        ) {
            SectionHeading("本周账页")
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                IconButton(onClick = { monday = LedgerMath.shiftDays(monday, -7) }) {
                    Icon(Icons.Outlined.ChevronLeft, contentDescription = "上一周", tint = Paper.brand)
                }
                Text("$from — $to", style = Type.caption.copy(color = Paper.inkSoft))
                IconButton(onClick = { monday = LedgerMath.shiftDays(monday, 7) }) {
                    Icon(Icons.Outlined.ChevronRight, contentDescription = "下一周", tint = Paper.brand)
                }
            }
            Spacer(Modifier.height(8.dp))
            RuleLine()
            Spacer(Modifier.height(12.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text("支出", style = Type.caption)
                    FigureText(LedgerMath.formatYuan(totals.expenseCents), Type.figureLarge.copy(fontSize = 26.sp, color = Paper.red))
                }
                Column(Modifier.weight(1f)) {
                    Text("收入", style = Type.caption)
                    FigureText(LedgerMath.formatYuan(totals.incomeCents), Type.figureLarge.copy(fontSize = 26.sp, color = Paper.brand))
                }
            }
            Spacer(Modifier.height(12.dp))
            RuleLine()
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("本周工时", style = Type.caption)
                FigureText("${totals.workMinutes / 60}h${totals.workMinutes % 60}m", Type.figure.copy(color = Paper.inkSoft))
            }
        }

        if (grouped.isEmpty()) {
            EmptyHint(
                "这一周还没有记录。点首页的「记一笔」开始吧。",
                modifier = Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp).journalEntrance(1, motion),
            )
        } else {
            var entranceIndex = 1
            grouped.forEach { (date, rows) ->
                Column(Modifier.padding(horizontal = Dimens.gutter, vertical = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(date, style = Type.sectionTitle)
                        PaperTag("${rows.size} 笔", color = Paper.kraftWash, contentColor = Paper.inkSoft)
                    }
                    Spacer(Modifier.height(8.dp))
                    rows.forEach { record ->
                        RecordRow(
                            record,
                            modifier = Modifier.journalEntrance(entranceIndex, motion),
                            onDelete = { pendingDelete = record.id },
                        )
                        Spacer(Modifier.height(8.dp))
                        entranceIndex += 1
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    val deleting = pendingDelete
    if (deleting != null) {
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除这条记录？", style = Type.sectionTitle) },
            text = { Text("删除后网页上也会消失。", style = Type.caption) },
            confirmButton = {
                TextButton(onClick = { onDelete(deleting); pendingDelete = null }) {
                    Text("删除", style = Type.caption.copy(color = Paper.red))
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("保留", style = Type.caption) }
            },
        )
    }
}

@Composable
private fun RecordRow(record: RecordEntry, modifier: Modifier = Modifier, onDelete: () -> Unit) {
    PaperListRow(
        title = record.title,
        subtitle = if (record.type == "work") "工时 ${record.durationMinutes ?: 0} 分钟" else record.category ?: "其他",
        modifier = modifier,
        trailing = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                FigureText(
                    (if (record.type == "work") "+" else "−") + LedgerMath.formatYuan(record.amountCents),
                    Type.figure.copy(color = if (record.type == "work") Paper.brand else Paper.red),
                )
                TextButton(onClick = onDelete, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("删", style = Type.caption, textAlign = TextAlign.Center)
                }
            }
        },
    )
}
