package com.shunshou.app.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.shunshou.app.data.AppUiState
import com.shunshou.app.data.CalendarSyncPreferences
import com.shunshou.app.data.CalendarSyncWorker
import com.shunshou.app.ui.components.JournalPage
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.PaperListRow
import com.shunshou.app.ui.components.PaperNote
import com.shunshou.app.ui.components.PaperPrimaryButton
import com.shunshou.app.ui.components.PaperSecondaryButton
import com.shunshou.app.ui.components.PaperTag
import com.shunshou.app.ui.components.RuleLine
import com.shunshou.app.ui.components.SectionHeading
import com.shunshou.app.ui.motion.LocalJournalMotion
import com.shunshou.app.ui.motion.journalEntrance
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import com.shunshou.collector.ShizukuBridge
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import rikka.shizuku.Shizuku
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val SHIZUKU_PERMISSION_REQUEST_CODE = 4101

@Composable
fun MeScreen(
    state: AppUiState,
    onSignOut: () -> Unit,
    onRefresh: () -> Unit,
    onSyncCalendar: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val motion = LocalJournalMotion.current
    var confirmSignOut by remember { mutableStateOf(false) }
    var captureOn by remember { mutableStateOf(readCaptureEnabled(context)) }
    var shizukuRunning by remember { mutableStateOf(readShizukuRunning()) }
    var shizukuGranted by remember { mutableStateOf(readShizukuGranted()) }
    var calendarGranted by remember { mutableStateOf(readCalendarGranted(context)) }
    var autoSyncOn by remember { mutableStateOf(CalendarSyncPreferences.isEnabled(context)) }
    var batteryIgnoring by remember { mutableStateOf(readBatteryIgnoring(context)) }

    fun refreshStatuses() {
        captureOn = readCaptureEnabled(context)
        shizukuRunning = readShizukuRunning()
        shizukuGranted = readShizukuGranted()
        calendarGranted = readCalendarGranted(context)
        autoSyncOn = CalendarSyncPreferences.isEnabled(context)
        batteryIgnoring = readBatteryIgnoring(context)
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshStatuses()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    DisposableEffect(Unit) {
        val listener = Shizuku.OnRequestPermissionResultListener { requestCode, grantResult ->
            if (requestCode == SHIZUKU_PERMISSION_REQUEST_CODE) {
                refreshStatuses()
                val message = if (grantResult == PackageManager.PERMISSION_GRANTED) "Shizuku 授权成功" else "Shizuku 授权未完成"
                Toast.makeText(context, message, Toast.LENGTH_LONG).show()
            }
        }
        Shizuku.addRequestPermissionResultListener(listener)
        onDispose { Shizuku.removeRequestPermissionResultListener(listener) }
    }

    val calendarPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        calendarGranted = granted
        if (granted) onSyncCalendar() else Toast.makeText(context, "未获得日历权限，无法读取系统日程。", Toast.LENGTH_LONG).show()
    }

    fun grantCalendar() {
        if (calendarGranted) return
        if (shizukuRunning && shizukuGranted) {
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching { ShizukuBridge.grantCalendar(context.packageName) }
                }
                result.onSuccess {
                    calendarGranted = true
                    onSyncCalendar()
                }.onFailure {
                    Toast.makeText(context, "Shizuku 授权失败，改用系统授权。", Toast.LENGTH_LONG).show()
                    calendarPermissionLauncher.launch(Manifest.permission.READ_CALENDAR)
                }
            }
        } else {
            calendarPermissionLauncher.launch(Manifest.permission.READ_CALENDAR)
        }
    }

    fun requestShizukuPermission() {
        when (shizukuUiAction(shizukuRunning, shizukuGranted)) {
            ShizukuUiAction.OPEN_APP -> openShizuku(context)
            ShizukuUiAction.REQUEST_PERMISSION -> runCatching {
                Shizuku.requestPermission(SHIZUKU_PERMISSION_REQUEST_CODE)
            }.onFailure {
                Toast.makeText(context, "无法发起 Shizuku 授权，请打开 Shizuku 重试。", Toast.LENGTH_LONG).show()
            }
            ShizukuUiAction.NONE -> Unit
        }
    }

    JournalPage {
        PageHeader(title = "我的", subtitle = "账号与系统能力")

        PaperNote(
            modifier = Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp).journalEntrance(0, motion),
            tapeColor = Paper.tape,
        ) {
            SectionHeading("账号")
            Spacer(Modifier.height(10.dp))
            Text(state.username.ifBlank { "未登录" }, style = Type.sectionTitle)
            Spacer(Modifier.height(6.dp))
            PaperTag("云端同步 · 按账号隔离", color = Paper.brandWash)
        }

        PaperNote(
            modifier = Modifier.padding(horizontal = Dimens.gutter, vertical = 18.dp).journalEntrance(1, motion),
            tapeColor = Paper.tapeGreen,
        ) {
            SectionHeading("Shizuku 与系统日历")
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    when {
                        !shizukuRunning -> "Shizuku 未运行"
                        !shizukuGranted -> "Shizuku 待授权"
                        else -> "Shizuku 已授权"
                    },
                    style = Type.journalNote,
                )
                PaperTag(
                    when {
                        shizukuGranted -> "已授权"
                        shizukuRunning -> "可申请"
                        else -> "未运行"
                    },
                    color = if (shizukuGranted) Paper.brandWash else Paper.kraftWash,
                    contentColor = if (shizukuGranted) Paper.brandDeep else Paper.inkSoft,
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PaperSecondaryButton(
                    text = "打开 Shizuku",
                    onClick = { openShizuku(context) },
                    modifier = Modifier.weight(1f),
                )
                PaperPrimaryButton(
                    text = when {
                        shizukuGranted -> "已授权"
                        shizukuRunning -> "申请授权"
                        else -> "打开并申请"
                    },
                    onClick = ::requestShizukuPermission,
                    modifier = Modifier.weight(1f),
                    enabled = !shizukuGranted,
                )
            }
            Spacer(Modifier.height(14.dp))
            RuleLine()
            Spacer(Modifier.height(12.dp))
            Text(if (calendarGranted) "日历权限：已授权" else "日历权限：未授权", style = Type.body)
            Text(
                state.calendar.status.ifBlank { "尚未同步系统日历" },
                style = Type.caption,
                modifier = Modifier.padding(top = 3.dp),
            )
            if (state.calendar.lastSuccess > 0L) {
                Text(
                    "最近成功：${SimpleDateFormat("MM-dd HH:mm", Locale.CHINA).format(Date(state.calendar.lastSuccess))}",
                    style = Type.caption,
                )
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PaperSecondaryButton(
                    text = if (calendarGranted) "日历已授权" else "授权日历",
                    onClick = ::grantCalendar,
                    modifier = Modifier.weight(1f),
                    enabled = !calendarGranted,
                )
                PaperSecondaryButton(
                    text = if (state.calendarLoading) "同步中…" else "立即同步",
                    onClick = onSyncCalendar,
                    modifier = Modifier.weight(1f),
                    enabled = !state.calendarLoading,
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("后台自动同步", style = Type.body)
                    Text("每 6 小时一次，打开 APP 时补同步", style = Type.caption)
                }
                Switch(
                    checked = autoSyncOn,
                    onCheckedChange = {
                        autoSyncOn = it
                        CalendarSyncWorker.setEnabled(context, it)
                    },
                    colors = SwitchDefaults.colors(checkedTrackColor = Paper.brand),
                )
            }
            PaperSecondaryButton(
                text = if (batteryIgnoring) "电池优化已关闭" else "优化后台稳定性",
                onClick = { openBatterySettings(context) },
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        PaperListRow(
            title = "采集支付",
            subtitle = if (captureOn) "已开启：只读支付结果页" else "未开启：点此去系统设置开启",
            modifier = Modifier.padding(horizontal = Dimens.gutter, vertical = 8.dp).journalEntrance(2, motion),
            onClick = {
                context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            },
        )
        PaperListRow(
            title = "刷新数据",
            subtitle = if (state.loading) "正在刷新…" else "从云端拉取最新账本与日程",
            modifier = Modifier.padding(horizontal = Dimens.gutter, vertical = 8.dp).journalEntrance(3, motion),
            onClick = onRefresh,
        )
        PaperListRow(
            title = "退出登录",
            subtitle = "退出后本机不再保留会话",
            danger = true,
            modifier = Modifier.padding(horizontal = Dimens.gutter, vertical = 8.dp).journalEntrance(4, motion),
            onClick = { confirmSignOut = true },
        )
        Spacer(Modifier.height(18.dp))
        Text("顺手 v1.0 · 纸与墨", style = Type.caption, modifier = Modifier.padding(horizontal = Dimens.gutter))
    }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text("退出登录？", style = Type.sectionTitle) },
            text = { Text("云端数据不会删除，下次登录还能看到。", style = Type.caption) },
            confirmButton = {
                TextButton(
                    onClick = { confirmSignOut = false; onSignOut() },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Text("退出", style = Type.caption.copy(color = Paper.red))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmSignOut = false }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("取消", style = Type.caption)
                }
            },
        )
    }
}

private fun readShizukuRunning(): Boolean = runCatching { Shizuku.pingBinder() }.getOrDefault(false)

private fun readShizukuGranted(): Boolean = runCatching {
    Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
}.getOrDefault(false)

private fun readCalendarGranted(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

private fun readBatteryIgnoring(context: Context): Boolean =
    (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(context.packageName)

private fun openShizuku(context: Context) {
    val intent = context.packageManager.getLaunchIntentForPackage("moe.shizuku.privileged.api")
    if (intent == null) {
        Toast.makeText(context, "未安装 Shizuku", Toast.LENGTH_LONG).show()
    } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

private fun openBatterySettings(context: Context) {
    val direct = Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:${context.packageName}"),
    )
    runCatching { context.startActivity(direct.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        .onFailure {
            runCatching {
                context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }.onFailure {
                context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
}

private fun readCaptureEnabled(context: Context): Boolean {
    val enabled = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
    ) ?: return false
    val pkg = context.packageName
    val names = listOf(
        "$pkg/$pkg.PaymentAccessibilityService",
        "$pkg/.PaymentAccessibilityService",
    )
    return enabled.split(':').any { entry -> names.any { it.equals(entry, ignoreCase = true) } }
}
