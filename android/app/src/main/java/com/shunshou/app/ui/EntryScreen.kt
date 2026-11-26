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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.data.RecordEntry
import com.shunshou.app.ui.components.JournalPage
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.PaperChoiceChip
import com.shunshou.app.ui.components.PaperNote
import com.shunshou.app.ui.components.PaperPrimaryButton
import com.shunshou.app.ui.components.PaperSecondaryButton
import com.shunshou.app.ui.components.PaperTextField
import com.shunshou.app.ui.components.SectionHeading
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID

private val categories = listOf("吃饭", "交通", "日用", "娱乐", "学习", "其他")
private val iso = DateTimeFormatter.ISO_LOCAL_DATE

@Composable
fun EntryScreen(state: AppUiState, onSave: (RecordEntry) -> Unit, onBack: () -> Unit) {
    var type by remember { mutableStateOf("expense") }
    var amount by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(categories[0]) }
    var date by remember { mutableStateOf(LocalDate.now().format(iso)) }
    var hours by remember { mutableStateOf("") }
    var rate by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        val parsedDate = runCatching {
            LocalDate.parse(date.trim(), DateTimeFormatter.ISO_LOCAL_DATE)
        }.getOrNull()
        if (parsedDate == null || parsedDate.year !in 2000..2100) {
            error = "日期格式需为 2026-11-23 这样。"; return
        }
        if (type == "expense") {
            val cents = amount.trim().toBigDecimalOrNull()
                ?.multiply(java.math.BigDecimal(100))?.setScale(0, java.math.RoundingMode.HALF_UP)?.toLong()
            if (cents == null || cents <= 0) { error = "金额需大于 0。"; return }
            onSave(
                RecordEntry(
                    id = "r-${UUID.randomUUID()}", type = "expense", date = parsedDate.format(iso),
                    title = title.trim().ifBlank { category }, amountCents = cents,
                    category = category, workplaceId = null, startTime = null, endTime = null,
                    durationMinutes = null, hourlyRateCents = null, source = "manual",
                )
            )
        } else {
            val workplace = state.ledger.workplaces.firstOrNull()
            if (workplace == null) { error = "还没有兼职单位，请先在网页上添加。"; return }
            val durationMinutes = hours.trim().toBigDecimalOrNull()
                ?.multiply(java.math.BigDecimal(60))?.setScale(0, java.math.RoundingMode.HALF_UP)?.toInt()
            val rateCents = rate.trim().toBigDecimalOrNull()
                ?.multiply(java.math.BigDecimal(100))?.setScale(0, java.math.RoundingMode.HALF_UP)?.toLong()
            if (durationMinutes == null || durationMinutes < 1 || durationMinutes > 1440) {
                error = "时长需在 1 分钟到 24 小时之间。"; return
            }
            if (rateCents == null || rateCents <= 0) { error = "时薪需大于 0。"; return }
            val amountCents = (durationMinutes.toLong() * rateCents + 30) / 60
            onSave(
                RecordEntry(
                    id = "r-${UUID.randomUUID()}", type = "work", date = parsedDate.format(iso),
                    title = title.trim().ifBlank { "兼职" }, amountCents = amountCents,
                    category = null, workplaceId = workplace.id,
                    startTime = "00:00", endTime = "00:00", durationMinutes = durationMinutes,
                    hourlyRateCents = rateCents, source = "manual",
                )
            )
        }
        onBack()
    }

    JournalPage {
        PageHeader(
            title = "记一笔",
            action = { PaperSecondaryButton("取消", onBack) },
        )
        PaperNote(
            modifier = Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp),
            tapeColor = Paper.tape,
        ) {
            SectionHeading("写一张账页")
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("expense" to "支出", "work" to "收入").forEach { (value, label) ->
                    PaperChoiceChip(
                        label = label,
                        selected = type == value,
                        onClick = { type = value },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            if (type == "expense") {
                PaperTextField(
                    value = amount,
                    onValueChange = { amount = it; error = null },
                    label = "金额（元）",
                    isError = error != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                Spacer(Modifier.height(12.dp))
            }
            PaperTextField(
                value = title,
                onValueChange = { title = it },
                label = "备注（可空）",
            )
            if (type == "expense") {
                Spacer(Modifier.height(16.dp))
                Text("分类", style = Type.caption)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    categories.take(3).forEach { name ->
                        PaperChoiceChip(
                            label = name,
                            selected = category == name,
                            onClick = { category = name },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    categories.drop(3).forEach { name ->
                        PaperChoiceChip(
                            label = name,
                            selected = category == name,
                            onClick = { category = name },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            } else {
                Spacer(Modifier.height(16.dp))
                Text("工时收入按「时长 × 时薪」自动算钱，不需要单独填金额。", style = Type.caption)
                Spacer(Modifier.height(12.dp))
                PaperTextField(
                    value = hours,
                    onValueChange = { hours = it; error = null },
                    label = "时长（小时）",
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                Spacer(Modifier.height(12.dp))
                PaperTextField(
                    value = rate,
                    onValueChange = { rate = it; error = null },
                    label = "时薪（元）",
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
            }
            Spacer(Modifier.height(12.dp))
            PaperTextField(
                value = date,
                onValueChange = { date = it; error = null },
                label = "日期",
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, style = Type.caption.copy(color = Paper.red))
            }
            Spacer(Modifier.height(24.dp))
            PaperPrimaryButton("保存", ::submit)
        }
    }
}
