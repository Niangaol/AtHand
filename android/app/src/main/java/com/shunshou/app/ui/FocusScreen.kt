package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.shunshou.app.ui.components.PageHeader
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

    Column(Modifier.fillMaxSize().background(Paper.page)) {
        PageHeader(title = "专注", action = { TextButton(onClick = onBack) { Text("返回", style = Type.caption) } })
        Column(
            Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (active == null) {
                Text("开始一段专注", style = Type.sectionTitle)
                Spacer(Modifier.height(20.dp))
                OutlinedTextField(
                    value = task,
                    onValueChange = { task = it },
                    label = { Text("要做什么") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = minutes,
                    onValueChange = { minutes = it },
                    label = { Text("分钟（1–180）") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
                Spacer(Modifier.height(20.dp))
                Button(
                    onClick = { onStart(task.ifBlank { "专注" }, minutes.toIntOrNull() ?: 25) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Paper.brand),
                ) { Text("开始", style = Type.body) }
            } else {
                Text(active.task, style = Type.sectionTitle, textAlign = TextAlign.Center)
                Spacer(Modifier.height(20.dp))
                Countdown(active)
                Spacer(Modifier.height(12.dp))
                Text(
                    if (active.status == "paused") "已暂停" else "进行中",
                    style = Type.caption,
                )
                Spacer(Modifier.height(24.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (active.status == "running") {
                        OutlinedButton(
                            onClick = { onControl("pause") },
                            modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                        ) { Text("暂停", style = Type.body) }
                    } else {
                        Button(
                            onClick = { onControl("resume") },
                            modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Paper.brand),
                        ) { Text("继续", style = Type.body) }
                    }
                    OutlinedButton(
                        onClick = { onControl("cancel") },
                        modifier = Modifier.weight(1f).heightIn(min = 52.dp),
                    ) { Text("结束", style = Type.body.copy(color = Paper.red)) }
                }
            }
        }
    }
}

@Composable
private fun Countdown(session: FocusSession) {
    // 用 segments 与当前时间算剩余，不依赖定时器精度；tick 只为驱动重绘。
    var tick by remember(session.id) { mutableIntStateOf(0) }
    LaunchedEffect(session.id, session.status) {
        while (session.status == "running") {
            delay(1_000)
            tick += 1
        }
    }
    val now = System.currentTimeMillis()
    // 每段用自己真实的 start：暂停→继续之间的间隙不算专注时长。
    val elapsedMillis = session.segments.sumOf { segment ->
        maxOf(0L, (segment.end ?: now) - segment.start)
    }.coerceAtMost(session.minutes * 60_000L)
    val remaining = session.minutes * 60_000L - elapsedMillis
    val text = "%02d:%02d".format(remaining / 60_000, (remaining / 1_000) % 60)
    Text(
        text,
        style = Type.figureLarge.copy(fontSize = Type.figureLarge.fontSize * 2.2f),
        color = Paper.brand,
    )
}
