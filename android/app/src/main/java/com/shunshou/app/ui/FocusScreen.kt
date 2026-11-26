package com.shunshou.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.data.FocusSession
import com.shunshou.app.ui.components.JournalPage
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.PaperNote
import com.shunshou.app.ui.components.PaperPrimaryButton
import com.shunshou.app.ui.components.PaperSecondaryButton
import com.shunshou.app.ui.components.PaperTag
import com.shunshou.app.ui.components.PaperTextField
import com.shunshou.app.ui.components.SectionHeading
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import kotlinx.coroutines.delay

@Composable
fun FocusScreen(
    state: AppUiState,
    onStart: (String, Int) -> Unit,
    onControl: (String) -> Unit,
    onBack: () -> Unit,
) {
    val active = state.planner.focusSessions
        .firstOrNull { it.status == "running" || it.status == "paused" }
    var task by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf(state.planner.focusMinutes.toString()) }

    JournalPage {
        PageHeader(
            title = "专注",
            action = { PaperSecondaryButton("返回", onBack) },
        )
        PaperNote(
            modifier = Modifier.padding(horizontal = Dimens.gutter, vertical = 22.dp),
            tapeColor = Paper.tapeGreen,
        ) {
            if (active == null) {
                SectionHeading("开始一段专注")
                Spacer(Modifier.height(18.dp))
                PaperTextField(
                    value = task,
                    onValueChange = { task = it },
                    label = "要做什么",
                )
                Spacer(Modifier.height(12.dp))
                PaperTextField(
                    value = minutes,
                    onValueChange = { minutes = it },
                    label = "分钟（1–180）",
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                Spacer(Modifier.height(22.dp))
                PaperPrimaryButton(
                    text = "开始",
                    onClick = { onStart(task.ifBlank { "专注" }, (minutes.toIntOrNull() ?: 25).coerceIn(1, 180)) },
                )
            } else {
                SectionHeading("正在专注")
                Spacer(Modifier.height(18.dp))
                Text(
                    active.task,
                    style = Type.sectionTitle,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(14.dp))
                Countdown(active)
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PaperTag(
                        if (active.status == "paused") "已暂停" else "进行中",
                        color = if (active.status == "paused") Paper.kraftWash else Paper.brandWash,
                        contentColor = if (active.status == "paused") Paper.inkSoft else Paper.brandDeep,
                    )
                    Text(" · ${active.minutes} 分钟", style = Type.caption)
                }
                Spacer(Modifier.height(24.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (active.status == "running") {
                        PaperSecondaryButton(
                            text = "暂停",
                            onClick = { onControl("pause") },
                            modifier = Modifier.weight(1f),
                        )
                    } else {
                        PaperPrimaryButton(
                            text = "继续",
                            onClick = { onControl("resume") },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    PaperSecondaryButton(
                        text = "结束",
                        onClick = { onControl("cancel") },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun Countdown(session: FocusSession) {
    var tick by remember(session.id) { mutableIntStateOf(0) }
    val now = remember(tick) { System.currentTimeMillis() }
    LaunchedEffect(session.id, session.status, tick) {
        if (session.status != "running") return@LaunchedEffect
        val total = session.minutes * 60_000L
        val done = session.segments.sumOf { maxOf(0L, (it.end ?: System.currentTimeMillis()) - it.start) }
        if (done >= total) return@LaunchedEffect
        delay(1_000)
        tick += 1
    }
    val elapsedMillis = session.segments.sumOf { segment ->
        maxOf(0L, (segment.end ?: now) - segment.start)
    }.coerceAtMost(session.minutes * 60_000L)
    val remaining = session.minutes * 60_000L - elapsedMillis
    val text = "%02d:%02d".format(remaining / 60_000, (remaining / 1_000) % 60)
    Text(
        text,
        style = Type.figureLarge.copy(fontSize = Type.figureLarge.fontSize * 2.2f),
        color = Paper.brand,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}
