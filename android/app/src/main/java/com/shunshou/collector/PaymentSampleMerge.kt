package com.shunshou.collector

import kotlin.math.abs

object PaymentSampleMerge {
    private const val WINDOW_MS = 5 * 60_000L

    /** 同一笔支付在支付前页面、动画和成功页会被多次读到，这里合并成一条。 */
    fun merge(existing: PaymentSample, incoming: PaymentSample): PaymentSample? {
        if (existing.note == "not_payment" || incoming.note == "not_payment") return null
        val sameAmount = existing.amountCents != null && incoming.amountCents != null &&
            existing.amountCents == incoming.amountCents &&
            existing.packageName == incoming.packageName &&
            abs(existing.at - incoming.at) <= WINDOW_MS
        val sameText = existing.title == incoming.title && existing.text == incoming.text &&
            existing.amountCents == incoming.amountCents &&
            abs(existing.at - incoming.at) <= 60_000
        if (!sameAmount && !sameText) return null

        val existingIsResult = PaymentParser.isResultText(existing.text)
        val incomingIsResult = PaymentParser.isResultText(incoming.text)
        return when {
            incomingIsResult && !existingIsResult ->
                incoming.copy(id = existing.id, at = minOf(existing.at, incoming.at))
            existingIsResult && !incomingIsResult -> existing
            incoming.direction != Direction.UNKNOWN && existing.direction == Direction.UNKNOWN ->
                incoming.copy(id = existing.id, at = minOf(existing.at, incoming.at))
            else -> existing
        }
    }
}
