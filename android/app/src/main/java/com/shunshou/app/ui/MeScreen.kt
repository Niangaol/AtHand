package com.shunshou.app.ui

import android.content.Intent
import android.provider.Settings
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.shunshou.app.data.AppUiState
import com.shunshou.app.ui.components.PageHeader
import com.shunshou.app.ui.components.RuleLine
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type

@Composable
fun MeScreen(state: AppUiState, onSignOut: () -> Unit, onRefresh: () -> Unit) {
    val context = LocalContext.current
    var confirmSignOut by remember { mutableStateOf(false) }
    var captureOn by remember { mutableStateOf(readCaptureEnabled(context)) }
    // 从系统设置返回时重新读一次，否则会一直显示离开前的旧状态。
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) captureOn = readCaptureEnabled(context)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Column(Modifier.fillMaxSize().background(Paper.page).verticalScroll(rememberScrollState())) {
        PageHeader(title = "我的")
        SettingRow(
            title = if (state.username.isBlank()) "未登录" else state.username,
            subtitle = "账号数据在云端，按账号隔离",
        )
        RuleLine()
        SettingRow(
            title = "采集支付",
            subtitle = if (captureOn) "已开启：只读支付结果页" else "未开启：点此去系统设置开启",
            onClick = {
                context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            },
        )
        RuleLine()
        SettingRow(title = "刷新数据", subtitle = if (state.loading) "正在刷新…" else "从云端拉取最新账本与日程", onClick = onRefresh)
        RuleLine()
        SettingRow(title = "退出登录", subtitle = "退出后本机不再保留会话", danger = true, onClick = { confirmSignOut = true })
        RuleLine()
        Spacer(Modifier.height(20.dp))
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

@Composable
private fun SettingRow(
    title: String,
    subtitle: String,
    danger: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = Dimens.gutter, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text(title, style = Type.body.copy(color = if (danger) Paper.red else Paper.ink))
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = Type.caption)
        }
    }
}

/**
 * 无障碍服务是否已开启。系统写回的是 flattenToString 的全名形式
 * （pkg/pkg.PaymentAccessibilityService），但有些 ROM 用短名（pkg/.X），两种都要认。
 */
private fun readCaptureEnabled(context: android.content.Context): Boolean {
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
