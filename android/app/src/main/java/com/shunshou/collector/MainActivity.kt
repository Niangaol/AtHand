package com.shunshou.collector

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.view.WindowInsetsController
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import rikka.shizuku.Shizuku

class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val timeFormat = SimpleDateFormat("MM-dd HH:mm", Locale.CHINA)
    private val probePrefs get() = getSharedPreferences("shunshou_probe", MODE_PRIVATE)
    private val calendarPrefs get() = getSharedPreferences("shunshou_calendar", MODE_PRIVATE)

    private lateinit var switchCapture: Switch
    private lateinit var textCaptureStatus: TextView
    private lateinit var textSyncStatus: TextView
    private lateinit var textCalendarStatus: TextView
    private lateinit var textBackgroundStatus: TextView
    private lateinit var buttonBatteryOptimization: Button
    private lateinit var textSampleCount: TextView
    private lateinit var containerSamples: LinearLayout
    private lateinit var panelConnection: LinearLayout
    private lateinit var panelDebug: LinearLayout
    private lateinit var buttonConnection: Button
    private lateinit var buttonToggleDebug: Button
    private lateinit var syncUrlInput: EditText
    private lateinit var syncPasswordInput: EditText
    private lateinit var textDebugStatus: TextView

    private var updatingSwitch = false

    private val shizukuRequestCode = 1001
    private val cameraRequestCode = 1002
    private val scanRequestCode = 1003
    private val shizukuPermissionListener = Shizuku.OnRequestPermissionResultListener { requestCode, _ ->
        if (requestCode == shizukuRequestCode) runOnUiThread { renderDebugStatus() }
    }
    private val shizukuBinderReceived = Shizuku.OnBinderReceivedListener { runOnUiThread { renderDebugStatus() } }
    private val shizukuBinderDead = Shizuku.OnBinderDeadListener { runOnUiThread { renderDebugStatus() } }
    private val calendarListener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == "status") runOnUiThread { if (!isDestroyed) renderCalendar() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureWindow()
        SampleStore.load(this)
        setContentView(R.layout.activity_main)
        bindViews()
        syncUrlInput.setText(probePrefs.getString("syncUrl", "http://127.0.0.1:18787"))
        syncPasswordInput.setText(probePrefs.getString("syncPassword", ""))
        setupListeners()
        SampleStore.listener = { runOnUiThread { renderSamples(); renderCapture() } }
        Shizuku.addRequestPermissionResultListener(shizukuPermissionListener)
        Shizuku.addBinderReceivedListener(shizukuBinderReceived)
        Shizuku.addBinderDeadListener(shizukuBinderDead)
        CalendarWorker.schedule(this)
        calendarPrefs.registerOnSharedPreferenceChangeListener(calendarListener)
        renderAll()
    }

    override fun onResume() {
        super.onResume()
        SampleStore.listener = { runOnUiThread { renderSamples(); renderCapture() } }
        renderAll()
        CalendarWorker.refresh(this)
    }

    override fun onPause() {
        SampleStore.listener = null
        super.onPause()
    }

    override fun onDestroy() {
        calendarPrefs.unregisterOnSharedPreferenceChangeListener(calendarListener)
        Shizuku.removeRequestPermissionResultListener(shizukuPermissionListener)
        Shizuku.removeBinderReceivedListener(shizukuBinderReceived)
        Shizuku.removeBinderDeadListener(shizukuBinderDead)
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == cameraRequestCode) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) launchScanner()
            else toast("没有相机权限，无法扫码")
        }
        renderAll()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == scanRequestCode && resultCode == RESULT_OK) {
            data?.getStringExtra(ScanActivity.EXTRA_PAYLOAD)?.let(::handlePairing)
        }
    }

    private fun configureWindow() {
        val background = getColor(R.color.bg)
        window.statusBarColor = background
        window.navigationBarColor = background
        window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(light, light)
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
    }

    private fun bindViews() {
        switchCapture = findViewById(R.id.switchCapture)
        textCaptureStatus = findViewById(R.id.textCaptureStatus)
        textSyncStatus = findViewById(R.id.textSyncStatus)
        textCalendarStatus = findViewById(R.id.textCalendarStatus)
        textBackgroundStatus = findViewById(R.id.textBackgroundStatus)
        buttonBatteryOptimization = findViewById(R.id.buttonBatteryOptimization)
        textSampleCount = findViewById(R.id.textSampleCount)
        containerSamples = findViewById(R.id.containerSamples)
        panelConnection = findViewById(R.id.panelConnection)
        panelDebug = findViewById(R.id.panelDebug)
        buttonConnection = findViewById(R.id.buttonConnection)
        buttonToggleDebug = findViewById(R.id.buttonToggleDebug)
        syncUrlInput = findViewById(R.id.inputSyncUrl)
        syncPasswordInput = findViewById(R.id.inputSyncPassword)
        textDebugStatus = findViewById(R.id.textDebugStatus)
    }

    private fun setupListeners() {
        switchCapture.setOnCheckedChangeListener { _, checked ->
            if (!updatingSwitch) onCaptureToggled(checked)
        }
        buttonConnection.setOnClickListener {
            togglePanel(panelConnection, buttonConnection, "连接设置", "收起设置")
        }
        buttonToggleDebug.setOnClickListener {
            togglePanel(panelDebug, buttonToggleDebug, "调试工具  ›", "收起调试工具")
        }
        findViewById<Button>(R.id.buttonSyncSamples).setOnClickListener { syncSamples() }
        findViewById<Button>(R.id.buttonScanPair).setOnClickListener { requestScanPair() }
        findViewById<Button>(R.id.buttonTestConnection).setOnClickListener { testConnection() }
        findViewById<Button>(R.id.buttonSaveConnection).setOnClickListener { testConnection() }
        findViewById<Button>(R.id.buttonRefreshSamples).setOnClickListener { renderAll() }
        findViewById<Button>(R.id.buttonCopySamples).setOnClickListener { copySamples() }
        findViewById<Button>(R.id.buttonClearSamples).setOnClickListener { confirmClearSamples() }
        findViewById<Button>(R.id.buttonSyncCalendar).setOnClickListener {
            savedSyncUrl()
            savedSyncPassword()
            CalendarWorker.refresh(this, true)
            toast("已安排同步，联网后上传")
        }
        buttonBatteryOptimization.setOnClickListener { requestBatteryExemption() }
        findViewById<Button>(R.id.buttonAppSettings).setOnClickListener { openAppDetails() }
        findViewById<Button>(R.id.buttonShizukuRead).setOnClickListener { readScreenViaShizuku() }
        findViewById<Button>(R.id.buttonShizukuRead5).setOnClickListener { readScreenDelayed() }
        findViewById<Button>(R.id.buttonOcr).setOnClickListener { readScreenByScreenshot() }
        findViewById<Button>(R.id.buttonOcr5).setOnClickListener { readScreenByScreenshotDelayed() }
        findViewById<Button>(R.id.buttonRequestShizuku).setOnClickListener { requestShizuku() }
        findViewById<Button>(R.id.buttonGrantCalendar).setOnClickListener { grantCalendarViaShizuku() }
        findViewById<Button>(R.id.buttonNotificationSettings).setOnClickListener {
            openSettings(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        }
        findViewById<Button>(R.id.buttonAccessibilitySettings).setOnClickListener {
            openSettings(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        }
    }

    private fun togglePanel(panel: LinearLayout, button: Button, collapsed: String, expanded: String) {
        val show = panel.visibility != View.VISIBLE
        panel.visibility = if (show) View.VISIBLE else View.GONE
        button.text = if (show) expanded else collapsed
    }

    private fun renderAll() {
        renderCapture()
        renderSync()
        renderSamples()
        renderCalendar()
        renderBackground()
        renderDebugStatus()
    }

    private fun renderCapture() {
        val enabled = accessibilityEnabled()
        updatingSwitch = true
        switchCapture.isChecked = enabled
        updatingSwitch = false
        if (enabled) {
            textCaptureStatus.text = "● 已开启 · 只读支付结果页"
            textCaptureStatus.setTextColor(getColor(R.color.hero_ok))
        } else {
            textCaptureStatus.text = "○ 已关闭 · 打开后自动记一笔"
            textCaptureStatus.setTextColor(getColor(R.color.hero_muted))
        }
    }

    private fun renderSync() {
        val lastAt = probePrefs.getLong("lastSampleSync", 0L)
        val message = probePrefs.getString("lastSampleMessage", "").orEmpty()
        val host = SyncClient.urlOrDefault(probePrefs.getString("syncUrl", null))
            .removePrefix("https://").removePrefix("http://").trimEnd('/')
        textSyncStatus.text = if (lastAt > 0) {
            "上次同步 ${timeFormat.format(Date(lastAt))}\n$message"
        } else {
            "尚未同步 · 电脑 $host"
        }
        textSyncStatus.setTextColor(
            if (message.contains("失败")) getColor(R.color.warm) else getColor(R.color.ink)
        )
    }

    private fun renderSamples() {
        containerSamples.removeAllViews()
        val items = SampleStore.all()
        textSampleCount.text = "${items.size} 条"
        if (items.isEmpty()) {
            containerSamples.addView(hint("还没有捕获到支付。开启自动记账后做一笔小额支付试试。"))
            return
        }
        for (sample in items.take(3)) {
            val row = layoutInflater.inflate(R.layout.item_sample, containerSamples, false)
            row.findViewById<TextView>(R.id.textMerchant).text =
                sample.merchant.ifBlank { PaymentParser.appName(sample.packageName) }
            val source = when (sample.source) {
                Source.NOTIFICATION -> "通知"
                Source.ACCESSIBILITY -> "屏幕"
                Source.SHIZUKU -> "Shizuku"
            }
            row.findViewById<TextView>(R.id.textMeta).text =
                "$source · ${timeFormat.format(Date(sample.at))}"
            val amount = row.findViewById<TextView>(R.id.textAmount)
            amount.text = PaymentParser.amountLabel(sample.amountCents)
            amount.setTextColor(
                when {
                    sample.amountCents == null -> getColor(R.color.warm)
                    sample.direction == Direction.INCOME || sample.direction == Direction.REFUND ->
                        getColor(R.color.green)
                    else -> getColor(R.color.ink)
                }
            )
            row.findViewById<TextView>(R.id.textDirection).text = when {
                sample.note == "pending_confirm" -> "待确认"
                sample.note == "no_amount" -> "未识别金额"
                else -> PaymentParser.directionLabel(sample.direction)
            }
            containerSamples.addView(row)
        }
        if (items.size > 3) {
            containerSamples.addView(hint("另有 ${items.size - 3} 条；同步后可在电脑端查看。"))
        }
    }

    private fun renderCalendar() {
        val status = calendarPrefs.getString("status", "尚未同步手机日历").orEmpty()
        val last = calendarPrefs.getLong("lastSuccess", 0L)
        val granted = checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
        val text = buildString {
            append(status)
            if (last > 0) append("\n最近完整同步：${timeFormat.format(Date(last))}")
            if (!granted) append("\n日历未授权，同步会失败。")
        }
        textCalendarStatus.text = text
        textCalendarStatus.setTextColor(
            if (!granted) getColor(R.color.warm) else getColor(R.color.ink)
        )
    }

    private fun renderBackground() {
        val power = getSystemService(POWER_SERVICE) as PowerManager
        val ignoring = power.isIgnoringBatteryOptimizations(packageName)
        textBackgroundStatus.text =
            "电池优化：${if (ignoring) "已关闭" else "未关闭"}\n最近任务卡片：已隐藏"
        textBackgroundStatus.setTextColor(
            if (ignoring) getColor(R.color.ink) else getColor(R.color.warm)
        )
        buttonBatteryOptimization.isEnabled = !ignoring
        buttonBatteryOptimization.text = if (ignoring) "电池优化已关闭" else "关闭电池优化"
    }

    private fun requestBatteryExemption() {
        val power = getSystemService(POWER_SERVICE) as PowerManager
        if (power.isIgnoringBatteryOptimizations(packageName)) {
            toast("电池优化已关闭")
            renderBackground()
            return
        }
        val direct = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:$packageName"),
        )
        runCatching { startActivity(direct) }.onFailure {
            runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
                .onFailure { openAppDetails() }
        }
        handler.postDelayed({ renderBackground() }, 800)
    }

    private fun openAppDetails() {
        runCatching {
            startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:$packageName"),
                )
            )
        }.onFailure { toast("无法打开应用设置，请手动进入系统设置") }
    }

    private fun renderDebugStatus() {
        val ping = runCatching { Shizuku.pingBinder() }.getOrDefault(false)
        val granted = runCatching { Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED }
            .getOrDefault(false)
        val shizuku = when {
            !ping -> "Shizuku 未运行"
            !granted -> "Shizuku 未授权"
            else -> "Shizuku 已授权"
        }
        val notifications = if (notificationAccessEnabled()) "通知使用权已开" else "通知使用权未开"
        val calendar = if (checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED) {
            "日历已授权"
        } else {
            "日历未授权"
        }
        val accessibility = if (accessibilityEnabled()) "无障碍已开启" else "无障碍未开启"
        textDebugStatus.text = "$shizuku\n$notifications · $calendar\n$accessibility"
    }

    private fun onCaptureToggled(checked: Boolean) {
        if (checked) {
            if (accessibilityEnabled()) {
                renderCapture()
                return
            }
            if (shizukuReady()) {
                runCatching { ShizukuBridge.enableAccessibility(packageName) }
                    .onSuccess {
                        toast("自动记账已开启")
                        handler.postDelayed({ renderAll() }, 500)
                    }
                    .onFailure { openAccessibilitySettings("请在系统设置中开启「顺手采集」") }
            } else {
                openAccessibilitySettings("请在系统设置中开启「顺手采集」")
            }
        } else {
            if (!accessibilityEnabled()) {
                renderCapture()
                return
            }
            if (shizukuReady()) {
                runCatching { ShizukuBridge.disableAccessibility(packageName) }
                    .onSuccess {
                        toast("自动记账已关闭")
                        handler.postDelayed({ renderAll() }, 400)
                    }
                    .onFailure { openAccessibilitySettings("请在系统设置中关闭「顺手采集」") }
            } else {
                openAccessibilitySettings("请在系统设置中关闭「顺手采集」")
            }
        }
    }

    private fun openAccessibilitySettings(message: String) {
        toast(message)
        runCatching { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            .onFailure { toast("无法打开系统设置，请手动进入无障碍设置") }
        handler.postDelayed({ renderCapture() }, 800)
    }

    private fun syncSamples() {
        val url = savedSyncUrl()
        val password = savedSyncPassword()
        val samples = SampleStore.all()
        if (samples.isEmpty()) {
            toast("还没有样本")
            return
        }
        toast("正在同步…")
        Thread {
            val result = runCatching {
                var token = SyncSession.token(this@MainActivity, url, password)
                try {
                    SyncClient.upload(url, samples, token)
                } catch (error: SyncHttpException) {
                    if (error.status != 401) throw error
                    SyncSession.clear(this@MainActivity)
                    token = SyncSession.token(this@MainActivity, url, password)
                    SyncClient.upload(url, samples, token)
                }
            }
            runOnUiThread {
                result.onSuccess {
                    probePrefs.edit()
                        .putLong("lastSampleSync", System.currentTimeMillis())
                        .putString("lastSampleMessage", "已上传 ${samples.size} 条样本")
                        .apply()
                    renderSync()
                    toast("已同步 ${samples.size} 条到电脑")
                }.onFailure {
                    val reason = it.message ?: "请检查连接"
                    probePrefs.edit().putString("lastSampleMessage", "同步失败：$reason").apply()
                    renderSync()
                    toast("同步失败：$reason")
                }
            }
        }.start()
    }

    private fun requestScanPair() {
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchScanner()
        else requestPermissions(arrayOf(Manifest.permission.CAMERA), cameraRequestCode)
    }

    private fun launchScanner() {
        runCatching { startActivityForResult(Intent(this, ScanActivity::class.java), scanRequestCode) }
            .onFailure { toast("无法打开相机") }
    }

    private fun handlePairing(raw: String) {
        val payload = PairingPayload.parse(raw)
        if (payload == null) {
            toast("二维码无效或已过期，请在电脑上刷新")
            return
        }
        toast("正在配对…")
        Thread {
            val result = runCatching {
                SyncClient.pair(payload.url, payload.code).also { SyncSession.savePaired(this, payload.url, it) }
            }
            runOnUiThread {
                result.onSuccess {
                    probePrefs.edit().putString("syncUrl", payload.url).apply()
                    syncUrlInput.setText(payload.url)
                    toast("配对成功，正在上传样本")
                    syncSamples()
                }.onFailure { toast("配对失败：${it.message}") }
            }
        }.start()
    }

    private fun testConnection() {
        val url = savedSyncUrl()
        val password = savedSyncPassword()
        toast("正在测试…")
        Thread {
            val result = runCatching {
                val token = SyncSession.token(this@MainActivity, url, password)
                SyncClient.samples(url, token)
            }
            runOnUiThread {
                result.onSuccess { toast("连接成功，可以同步样本") }
                    .onFailure { toast("连接失败：${it.message ?: "请检查地址和口令"}") }
            }
        }.start()
    }

    private fun savedSyncUrl(): String {
        var value = syncUrlInput.text.toString().trim().ifEmpty { "http://127.0.0.1:18787" }
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://$value"
        probePrefs.edit().putString("syncUrl", value).apply()
        return value
    }

    private fun savedSyncPassword(): String {
        val value = syncPasswordInput.text.toString().trim()
        probePrefs.edit().putString("syncPassword", value).apply()
        return value
    }

    private fun confirmClearSamples() {
        AlertDialog.Builder(this)
            .setTitle("清空本机样本？")
            .setMessage("只删除手机上尚未清空的样本，不影响电脑账本。")
            .setNegativeButton("取消", null)
            .setPositiveButton("清空") { _, _ ->
                SampleStore.clear(this)
                renderSamples()
                renderCapture()
            }
            .show()
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

    private fun requestShizuku() {
        if (!runCatching { Shizuku.pingBinder() }.getOrDefault(false)) {
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
        val sample = SnapshotProcessor.process(
            snapshot.packageName, snapshot.texts, System.currentTimeMillis()
        )
        if (sample == null) {
            toast("当前页面没有交易结果文字")
            return
        }
        SampleStore.add(this, sample)
        toast(
            when (sample.note) {
                "no_amount" -> "已记录，但未识别金额"
                "pending_confirm" -> "已记录待确认：完成支付后保留账单"
                else -> "已记录"
            }
        )
    }

    private fun grantCalendarViaShizuku() {
        if (!shizukuReady()) return
        runCatching { ShizukuBridge.grantCalendar(packageName) }
            .onSuccess {
                toast(it)
                renderAll()
            }
            .onFailure { toast("授权失败：${it.message}") }
    }

    private fun shizukuReady(): Boolean {
        if (!runCatching { Shizuku.pingBinder() }.getOrDefault(false)) {
            toast("Shizuku 未运行")
            return false
        }
        if (!runCatching { Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED }.getOrDefault(false)) {
            toast("请先在调试工具里授权 Shizuku")
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

    private fun hint(message: String): TextView = TextView(this).apply {
        text = message
        textSize = 12f
        setTextColor(getColor(R.color.muted))
        setLineSpacing(dp(3).toFloat(), 1f)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        setBackgroundResource(R.drawable.bg_soft)
    }

    private fun toast(message: String?) = Toast.makeText(this, message ?: "", Toast.LENGTH_SHORT).show()

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
