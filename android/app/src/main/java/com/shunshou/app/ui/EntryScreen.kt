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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.shunshou.app.ui.components.PageHeader
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
        // 网页端 isLedgerState 要求 date 是合法的 yyyy-MM-dd 且在 2000–2100 之间，
        // 不合规会让整份账本被拒收。ISO_LOCAL_DATE 同时校验格式与日期真实性
        // （2026/11/23 与 2026-02-30 都会抛异常）。
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
            // 网页端 isLedgerState 要求 work 记录的 workplaceId 必须命中 workplaces[]，
            // 不存在 id 会让整份账本被拒收，所以没有兼职单位时宁可不保存。
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
            // 金额必须严格等于「时长 × 时薪 / 60」（网页端会逐条校验），用整数运算四舍五入，
            // 与 Math.round(x / 60.0) 对正数等价，但不受浮点精度影响。
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

    Column(Modifier.fillMaxSize().background(Paper.page).verticalScroll(rememberScrollState())) {
        PageHeader(title = "记一笔", action = { TextButton(onClick = onBack) { Text("取消", style = Type.caption) } })
        Column(Modifier.padding(horizontal = Dimens.gutter, vertical = 16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("expense" to "支出", "work" to "收入").forEach { (value, label) ->
                    FilterChip(
                        selected = type == value,
                        onClick = { type = value },
                        label = { Text(label, style = Type.caption) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = Paper.brandWash,
                            selectedLabelColor = Paper.brandDeep,
                        ),
                        modifier = Modifier.heightIn(min = 48.dp),
                    )
                }
            }
            Spacer(Modifier.height(16.dp))
            if (type == "expense") {
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it; error = null },
                    label = { Text("金额（元）") },
                    singleLine = true,
                    isError = error != null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
                Spacer(Modifier.height(12.dp))
            }
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text("备注（可空）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            )
            if (type == "expense") {
                Spacer(Modifier.height(16.dp))
                Text("分类", style = Type.caption)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    categories.take(3).forEach { name ->
                        FilterChip(
                            selected = category == name,
                            onClick = { category = name },
                            label = { Text(name, style = Type.caption) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    categories.drop(3).forEach { name ->
                        FilterChip(
                            selected = category == name,
                            onClick = { category = name },
                            label = { Text(name, style = Type.caption) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        )
                    }
                }
            } else {
                Spacer(Modifier.height(16.dp))
                Text("工时收入按「时长 × 时薪」自动算钱，不需要单独填金额。", style = Type.caption)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = hours,
                    onValueChange = { hours = it; error = null },
                    label = { Text("时长（小时）") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = rate,
                    onValueChange = { rate = it; error = null },
                    label = { Text("时薪（元）") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = date,
                onValueChange = { date = it; error = null },
                label = { Text("日期") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, style = Type.caption.copy(color = Paper.red))
            }
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { submit() },
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Paper.brand),
            ) { Text("保存", style = Type.body) }
        }
    }
}
