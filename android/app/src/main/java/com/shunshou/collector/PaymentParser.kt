package com.shunshou.collector

import java.math.BigDecimal
import java.math.RoundingMode

enum class Direction { EXPENSE, INCOME, REFUND, UNKNOWN }
enum class Source { NOTIFICATION, ACCESSIBILITY }

data class ParsedPayment(
    val amountCents: Long?,
    val direction: Direction,
    val merchant: String,
    val note: String = "",
)

data class PaymentSample(
    val id: String,
    val packageName: String,
    val title: String,
    val text: String,
    val at: Long,
    val amountCents: Long?,
    val direction: Direction,
    val merchant: String,
    val source: Source,
    val note: String = "",
)

data class CalendarItem(
    val title: String,
    val location: String,
    val begin: Long,
    val end: Long,
    val calendarName: String,
)

object PaymentParser {
    const val ALIPAY = "com.eg.android.AlipayGphone"
    const val WECHAT = "com.tencent.mm"
    val supportedPackages = setOf(ALIPAY, WECHAT)

    private val moneySign = Regex("""[¥￥]\s*(\d{1,7}(?:\.\d{1,2})?)""")
    private val yuanSuffix = Regex("""(\d{1,7}(?:\.\d{1,2})?)\s*元""")
    private val paymentWords = listOf("支付", "付款", "收款", "转账", "退款", "消费", "到账", "入账", "扣款")
    private val merchantPatterns = listOf(
        Regex("""向([^，,。\s]{1,24}?)付款"""),
        Regex("""在([^，,。\s]{1,24}?)(?:消费|付款|支付)"""),
        Regex("""付款给([^，,。\s]{1,24})"""),
        Regex("""([^，,。\s]{1,24}?)的付款"""),
    )

    fun appName(pkg: String): String = when (pkg) {
        ALIPAY -> "支付宝"
        WECHAT -> "微信"
        else -> pkg
    }

    fun isPaymentLike(title: String, text: String): Boolean {
        val joined = title + " " + text
        return paymentWords.any { joined.contains(it) }
    }

    fun parse(title: String, text: String, packageName: String): ParsedPayment {
        val joined = (title + " " + text).trim()
        val cents = (moneySign.find(joined) ?: yuanSuffix.find(joined))?.let {
            runCatching {
                BigDecimal(it.groupValues[1]).movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact()
            }.getOrNull()
        }
        val direction = when {
            joined.contains("退款") -> Direction.REFUND
            listOf("收款", "到账", "入账", "收到").any { joined.contains(it) } -> Direction.INCOME
            listOf("支付成功", "已支付", "付款", "扣款", "消费", "支出").any { joined.contains(it) } -> Direction.EXPENSE
            else -> Direction.UNKNOWN
        }
        val merchant = merchantPatterns.firstNotNullOfOrNull { pattern ->
            pattern.find(joined)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }
        } ?: title.trim().ifEmpty { appName(packageName) }
        return ParsedPayment(cents, direction, merchant, if (cents == null) "no_amount" else "")
    }

    fun directionLabel(direction: Direction): String = when (direction) {
        Direction.EXPENSE -> "支出"
        Direction.INCOME -> "收入"
        Direction.REFUND -> "退款"
        Direction.UNKNOWN -> "方向未知"
    }

    fun amountLabel(cents: Long?): String = cents?.let { "¥ %.2f".format(it / 100.0) } ?: "未识别金额"
}
