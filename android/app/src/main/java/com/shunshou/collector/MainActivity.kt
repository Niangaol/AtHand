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

class MainActivity : Activity() {
    private lateinit var statusView: TextView
    private lateinit var samplesView: LinearLayout
    private lateinit var calendarView: LinearLayout
    private val timeFormat = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)
    private val green = Color.parseColor("#295C48")
    private val ink = Color.parseColor("#24382D")
    private val muted = Color.parseColor("#65746A")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SampleStore.load(this)
        setContentView(buildUi())
        SampleStore.listener = { runOnUiThread { renderSamples(); renderStatus() } }
    }

    override fun onResume() {
        super.onResume()
        renderAll()
    }

    override fun onPause() {
        SampleStore.listener = null
        super.onPause()
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
        renderSamples()
        renderCalendar()
    }

    private fun renderStatus() {
        val notifications = notificationAccessEnabled()
        val accessibility = accessibilityEnabled()
        val calendar = checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
        statusView.text = buildString {
            append(if (notifications) "✓ 通知使用权已开启" else "○ 通知使用权未开启")
            append("\n")
            append(if (accessibility) "✓ 无障碍已开启（兜底）" else "○ 无障碍未开启（可选）")
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
            val source = if (sample.source == Source.NOTIFICATION) "通知" else "屏幕"
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
            val source = if (sample.source == Source.NOTIFICATION) "通知" else "屏幕"
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
