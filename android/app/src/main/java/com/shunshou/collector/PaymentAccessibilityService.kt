package com.shunshou.collector

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.util.Log

class PaymentAccessibilityService : AccessibilityService() {
    private var lastProcessedAt = 0L
    private var lastTextHash = 0

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkg = event?.packageName?.toString() ?: return
        if (pkg !in PaymentParser.supportedPackages) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        ) return

        val root = rootInActiveWindow ?: return
        val texts = mutableListOf<String>()
        collectText(root, texts, 0)
        if (texts.isEmpty()) return
        val joined = texts.joinToString(" ")
        if (!PaymentParser.hasAnchor(joined)) return
        // 页面动画和局部刷新会连续触发事件，600ms 内且文本相同则跳过。
        val now = android.os.SystemClock.uptimeMillis()
        val hash = joined.hashCode()
        if (now - lastProcessedAt < 600 || hash == lastTextHash) return
        lastProcessedAt = now
        lastTextHash = hash

        val parsed = PaymentParser.parse("", joined, pkg)
        SampleStore.add(
            this,
            PaymentSample(
                id = "a11y:$pkg:${event.eventTime}:${joined.hashCode()}",
                packageName = pkg,
                title = "屏幕文字",
                text = joined.take(300),
                at = event.eventTime,
                amountCents = parsed.amountCents,
                direction = parsed.direction,
                merchant = parsed.merchant,
                source = Source.ACCESSIBILITY,
                note = parsed.note,
            )
        )
        Log.i("ShunshouProbe", "accessibility amount=${parsed.amountCents} direction=${parsed.direction} app=${PaymentParser.appName(pkg)}")
    }

    private fun collectText(node: AccessibilityNodeInfo?, out: MutableList<String>, depth: Int) {
        if (node == null || depth > 15 || out.size >= 200) return
        try {
            // 只读文本；跳过密码框与可编辑输入框，不读取用户输入。
            val editable = node.className?.toString()?.contains("EditText") == true
            if (!node.isPassword && !editable) {
                node.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let(out::add)
                node.contentDescription?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let(out::add)
            }
            for (index in 0 until node.childCount) collectText(node.getChild(index), out, depth + 1)
        } catch (_: Exception) {
            // 页面切换时节点可能失效，忽略即可。
        }
    }

    override fun onInterrupt() = Unit
}
