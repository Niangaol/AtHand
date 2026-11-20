package com.shunshou.collector

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

class PaymentNotificationListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in PaymentParser.supportedPackages || sbn.isOngoing) return
        val extras = sbn.notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = listOf(
            extras.getCharSequence(Notification.EXTRA_TEXT),
            extras.getCharSequence(Notification.EXTRA_BIG_TEXT),
            extras.getCharSequence(Notification.EXTRA_SUB_TEXT),
        ).filterNotNull().joinToString(" ").trim()
        if (!PaymentParser.isPaymentLike(title, text)) return

        val parsed = PaymentParser.parse(title, text, sbn.packageName)
        SampleStore.add(
            this,
            PaymentSample(
                id = "$packageName:${sbn.postTime}:${title.hashCode()}",
                packageName = sbn.packageName,
                title = title,
                text = text,
                at = sbn.postTime,
                amountCents = parsed.amountCents,
                direction = parsed.direction,
                merchant = parsed.merchant,
                source = Source.NOTIFICATION,
                note = parsed.note,
            )
        )
        // 日志只写结构化字段，不写通知正文。
        Log.i("ShunshouProbe", "notification amount=${parsed.amountCents} direction=${parsed.direction} app=${PaymentParser.appName(sbn.packageName)}")
    }
}
