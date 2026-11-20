package com.shunshou.collector

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import rikka.shizuku.Shizuku

class MainActivity : Activity() {
    private val shizukuRequestCode = 1001
    private val shizukuPermissionListener = Shizuku.OnRequestPermissionResultListener { requestCode, _ ->
        if (requestCode == shizukuRequestCode) runOnUiThread { renderShizuku() }
    }
    private val shizukuBinderReceived = Shizuku.OnBinderReceivedListener { runOnUiThread { renderShizuku() } }
    private val shizukuBinderDead = Shizuku.OnBinderDeadListener { runOnUiThread { renderShizuku() } }

    private lateinit var statusView: TextView
    private lateinit var samplesView: LinearLayout
    private lateinit var calendarView: LinearLayout
    private lateinit var shizukuView: TextView
    private val timeFormat = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)
    private val green = Color.parseColor("#295C48")
    private val ink = Color.parseColor("#24382D")
    private val muted = Color.parseColor("#65746A")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SampleStore.load(this)
        setContentView(buildUi())
        SampleStore.listener = { runOnUiThread { renderSamples(); renderStatus() } }
        Shizuku.addRequestPermissionResultListener(shizukuPermissionListener)
        Shizuku.addBinderReceivedListener(shizukuBinderReceived)
        Shizuku.addBinderDeadListener(shizukuBinderDead)
    }

    override fun onResume() {
        super.onResume()
        renderAll()
    }

    override fun onPause() {
        SampleStore.listener = null
        super.onPause()
    }

    override fun onDestroy() {
        Shizuku.removeRequestPermissionResultListener(shizukuPermissionListener)
        Shizuku.removeBinderReceivedListener(shizukuBinderReceived)
        Shizuku.removeBinderDeadListener(shizukuBinderDead)
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        renderAll()
    }

    private fun buildUi(): View = ScrollView(this).apply {
        fitsSystemWindows = true
        setBackgroundColor(Color.parseColor("#F5F7F4"))
        addView(LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(32))
            addView(label("顺手采集探针", 24f, green, true))
            addView(label("只在本机读取支付宝/微信支付通知和日历；样本不上传。", 12f, muted))

            addView(section("权限状态"))
            statusView = label("", 13f, ink).apply { setPadding(0, dp(8), 0, dp(4)) }
            addView(statusView)
            addView(row(
                action("通知使用权") { openSettings(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS) },
                action("无障碍") { openSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS) },
                action("授权日历") { requestPermissions(arrayOf(Manifest.permission.READ_CALENDAR), 1) },
            ))

            addView(section("Shizuku 读屏"))
            shizukuView = label("", 13f, ink)
            addView(shizukuView)
            addView(row(
                action("请求 Shizuku 权限") { requestShizuku() },
                action("5 秒后读屏") { readScreenDelayed() },
            ))
            addView(row(
                action("Shizuku 读屏") { readScreenViaShizuku() },
                action("开启无障碍（兜底）") { enableAccessibilityViaShizuku() },
            ))
            addView(row(
                action("5 秒后截图识别（OCR）") { readScreenByScreenshotDelayed() },
                action("截图识别（当前屏）") { readScreenByScreenshot() },
            ))
            addView(label("Shizuku 用 uiautomator 或截图 OCR 读取当前屏幕；OCR 在本机运行，不保存图片、不上传。微信红包没有转账成功页，请打开红包详情或账单页再读屏。", 11f, muted))

            addView(section("最近捕获"))
            addView(label("先开启通知使用权，再做一笔小额支付。每位助手会记录原文和解析结果，便于判断金额是否可见。", 11f, muted))
            samplesView = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }
            addView(samplesView)
            addView(row(
                action("刷新") { renderAll() },
                action("复制样本") { copySamples() },
                action("清空") { SampleStore.clear(this@MainActivity); renderAll() },
            ))

            addView(section("未来 7 天日程"))
            calendarView = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }
            addView(calendarView)
            addView(label(
                "无障碍是兜底通道：仅在通知里看不到金额时启用。它只读支付宝/微信的支付结果文字，跳过密码框和输入框，不截屏、不记录按键。",
                11f, muted,
            ).apply { setPadding(0, dp(18), 0, 0) })
        })
    }

    private fun renderAll() {
        renderStatus()
        renderShizuku()
        renderSamples()
        renderCalendar()
    }

    private fun renderStatus() {
        val notifications = notificationAccessEnabled()
        val accessibility = accessibilityEnabled()
        val calendar = checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
        statusView.text = buildString {
            append(if (accessibility) "✓ 无障碍已开启（主通道）" else "○ 无障碍未开启（主通道）")
            append("\n")
            append(if (notifications) "✓ 通知使用权已开启（可选）" else "○ 通知使用权未开启（可选）")
            append("\n")
            append(if (calendar) "✓ 日历已授权" else "○ 日历未授权")
        }
    }

    private fun renderSamples() {
        samplesView.removeAllViews()
        val items = SampleStore.all()
        if (items.isEmpty()) {
            samplesView.addView(hint("还没有捕获到支付通知。"))
            return
        }
        for (sample in items.take(10)) {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(12), dp(14), dp(12))
                setBackgroundColor(Color.WHITE)
            }
            val source = when (sample.source) {
                Source.NOTIFICATION -> "通知"
                Source.ACCESSIBILITY -> "屏幕"
                Source.SHIZUKU -> "Shizuku"
            }
            card.addView(label("$source · ${PaymentParser.appName(sample.packageName)} · ${timeFormat.format(Date(sample.at))}", 11f, muted))
            card.addView(label(
                "${PaymentParser.amountLabel(sample.amountCents)} · ${PaymentParser.directionLabel(sample.direction)}",
                17f, if (sample.amountCents == null) Color.parseColor("#A05A2C") else ink, true,
            ).apply { setPadding(0, dp(4), 0, dp(4)) })
            card.addView(label("商户：${sample.merchant}", 12f, ink))
            card.addView(label("原文：${sample.title.ifEmpty { "(无标题)" }} / ${sample.text}", 11f, muted).apply {
                setPadding(0, dp(5), 0, 0)
            })
            if (sample.note == "no_amount") card.addView(label("⚠ 未能从这段文字提取金额", 11f, Color.parseColor("#A05A2C")))
            samplesView.addView(card, cardParams())
        }
    }

    private fun renderCalendar() {
        calendarView.removeAllViews()
        val granted = checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            calendarView.addView(hint("未授权日历。点上方“授权日历”后刷新。"))
            return
        }
        val items = runCatching { CalendarReader.upcoming(this) }.getOrElse { emptyList() }
        if (items.isEmpty()) {
            calendarView.addView(hint("未来 7 天没有读到日程。确认课表已经同步到系统日历。"))
            return
        }
        val dayFormat = SimpleDateFormat("MM-dd EEE", Locale.CHINA)
        for (item in items) {
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(10), dp(14), dp(10))
                setBackgroundColor(Color.WHITE)
            }
            card.addView(label("${dayFormat.format(Date(item.begin))}  ${timeFormat.format(Date(item.begin))}–${timeFormat.format(Date(item.end))}", 11f, green, true))
            card.addView(label(item.title, 15f, ink, true).apply { setPadding(0, dp(3), 0, 0) })
            if (item.location.isNotEmpty()) card.addView(label(item.location, 12f, muted))
            calendarView.addView(card, cardParams())
        }
    }

    private fun copySamples() {
        val text = SampleStore.all().joinToString("\n\n") { sample ->
            val source = when (sample.source) {
                Source.NOTIFICATION -> "通知"
                Source.ACCESSIBILITY -> "屏幕"
                Source.SHIZUKU -> "Shizuku"
            }
            "[$source/${PaymentParser.appName(sample.packageName)}] ${PaymentParser.amountLabel(sample.amountCents)} " +
                "${PaymentParser.directionLabel(sample.direction)} 商户=${sample.merchant}\n原文=${sample.title} / ${sample.text}"
        }
        if (text.isBlank()) {
            toast("还没有样本")
            return
        }
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
            .setPrimaryClip(ClipData.newPlainText("顺手采集样本", text))
        toast("已复制 ${SampleStore.all().size} 条样本")
    }

    private fun renderShizuku() {
        if (!::shizukuView.isInitialized) return
        val ping = runCatching { Shizuku.pingBinder() }.getOrDefault(false)
        val granted = runCatching { Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED }.getOrDefault(false)
        shizukuView.text = when {
            !ping -> "Shizuku 未运行：先安装并启动 Shizuku。"
            !granted -> "Shizuku 已运行，尚未授权给顺手采集。"
            else -> "Shizuku 已授权，可一键开启无障碍或授权日历。"
        }
    }

    private fun requestShizuku() {
        if (runCatching { Shizuku.pingBinder() }.getOrDefault(false).not()) {
            toast("Shizuku 未运行")
            return
        }
        if (runCatching { Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED }.getOrDefault(false)) {
            toast("Shizuku 已授权")
            return
        }
        runCatching { Shizuku.requestPermission(shizukuRequestCode) }
            .onFailure { toast("请求失败：${it.message}") }
    }

    private fun enableAccessibilityViaShizuku() {
        if (!shizukuReady()) return
        runCatching { ShizukuBridge.enableAccessibility(packageName) }
            .onSuccess { toast(it); renderAll() }
            .onFailure { toast("开启失败：${it.message}") }
    }

    private fun readScreenViaShizuku() {
        if (!shizukuReady()) return
        toast("正在读取当前屏幕…")
        readScreenAfter(0)
    }

    private fun readScreenDelayed() {
        if (!shizukuReady()) return
        toast("5 秒后读取，请现在切到支付结果页")
        readScreenAfter(5_000)
    }

    private fun readScreenByScreenshot() {
        if (!shizukuReady()) return
        toast("正在截图识别…")
        captureAndRecognize(0)
    }

    private fun readScreenByScreenshotDelayed() {
        if (!shizukuReady()) return
        toast("5 秒后截图识别，请现在切到支付成功页")
        captureAndRecognize(5_000)
    }

    private fun captureAndRecognize(delayMs: Long) {
        Thread {
            if (delayMs > 0) Thread.sleep(delayMs)
            val shot = runCatching { ShizukuBridge.screenshot() }
            if (shot.isFailure) {
                runOnUiThread { toast("截图失败：${shot.exceptionOrNull()?.message}") }
                return@Thread
            }
            val packageName = runCatching { ShizukuBridge.currentPackage() }.getOrDefault("")
            ScreenshotOcr.recognize(
                shot.getOrThrow(),
                onResult = { lines -> runOnUiThread { handleSnapshot(ScreenSnapshot(packageName, lines)) } },
                onError = { error -> runOnUiThread { toast("OCR 失败：${error.message}") } },
            )
        }.start()
    }

    private fun readScreenAfter(delayMs: Long) {
        Thread {
            if (delayMs > 0) Thread.sleep(delayMs)
            val result = runCatching { ScreenDump.read() }
            runOnUiThread {
                result.onSuccess(::handleSnapshot).onFailure { toast("读屏失败：${it.message}") }
            }
        }.start()
    }

    private fun handleSnapshot(snapshot: ScreenSnapshot) {
        if (snapshot.packageName !in PaymentParser.supportedPackages) {
            toast("当前不是支付宝/微信：${snapshot.packageName}")
            return
        }
        if (snapshot.texts.isEmpty()) {
            toast("没读到文字，可能是安全页面")
            return
        }
        val joined = snapshot.texts.joinToString(" ")
        val anchored = PaymentParser.hasAnchor(joined)
        if (!anchored && !PaymentParser.isPaymentLike("", joined)) {
            toast("当前页面没有支付文字")
            return
        }
        val parsed = PaymentParser.parse("", joined, snapshot.packageName)
        val note = when {
            !anchored -> "not_payment"
            parsed.amountCents == null -> "no_amount"
            else -> ""
        }
        // 探针阶段连未匹配的屏幕也保存，方便按真实文案改规则。
        SampleStore.add(this, PaymentSample(
            id = "shizuku:${snapshot.packageName}:${System.currentTimeMillis()}",
            packageName = snapshot.packageName,
            title = if (anchored) "Shizuku 读屏" else "未识别屏幕",
            text = joined.take(500),
            at = System.currentTimeMillis(),
            amountCents = parsed.amountCents,
            direction = parsed.direction,
            merchant = parsed.merchant,
            source = Source.SHIZUKU,
            note = note,
        ))
        toast(
            when {
                !anchored -> "已保存原始屏幕，但没匹配到交易结果"
                parsed.amountCents == null -> "已记录，但未识别金额"
                else -> "已记录"
            }
        )
    }

    private fun grantCalendarViaShizuku() {
        if (!shizukuReady()) return
        runCatching { ShizukuBridge.grantCalendar(packageName) }
            .onSuccess { toast(it); renderAll() }
            .onFailure { toast("授权失败：${it.message}") }
    }

    private fun shizukuReady(): Boolean {
        if (runCatching { Shizuku.pingBinder() }.getOrDefault(false).not()) {
            toast("Shizuku 未运行")
            return false
        }
        if (runCatching { Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED }.getOrDefault(false).not()) {
            toast("请先请求 Shizuku 权限")
            return false
        }
        return true
    }

    private fun notificationAccessEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        return enabled?.contains(packageName) == true
    }

    private fun accessibilityEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_accessibility_services")
        return enabled?.contains("PaymentAccessibilityService") == true
    }

    private fun openSettings(action: String) {
        runCatching { startActivity(Intent(action)) }
            .onFailure { toast("无法打开系统设置，请手动进入设置页") }
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    private fun section(title: String): TextView = label(title, 16f, ink, true).apply {
        setPadding(0, dp(28), 0, dp(6))
    }

    private fun hint(message: String): TextView = label(message, 12f, muted).apply {
        setPadding(dp(14), dp(12), dp(14), dp(12))
        setBackgroundColor(Color.WHITE)
    }

    private fun label(text: String, size: Float, color: Int, bold: Boolean = false): TextView = TextView(this).apply {
        this.text = text
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setLineSpacing(dp(3).toFloat(), 1f)
    }

    private fun action(title: String, onClick: () -> Unit): Button = Button(this).apply {
        text = title
        textSize = 12f
        setOnClickListener { onClick() }
    }

    private fun row(vararg views: View): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, dp(8), 0, dp(4))
        for (view in views) {
            addView(view, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dp(6)
            })
        }
    }

    private fun cardParams(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply { bottomMargin = dp(8) }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
