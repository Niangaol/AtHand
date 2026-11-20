package com.shunshou.collector

import java.math.BigDecimal
import java.math.RoundingMode

enum class Direction { EXPENSE, INCOME, REFUND, UNKNOWN }
enum class Source { NOTIFICATION, ACCESSIBILITY, SHIZUKU }

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
    private val bareAmount = Regex("""(?<![\d.])(\d{1,6}\.\d{2})(?![\d.])""")
    private val paymentWords = listOf(
        "支付", "付款", "收款", "转账", "退款", "消费", "到账", "入账", "扣款",
        "红包", "收钱", "已收钱", "零钱", "账单",
    )
    private val anchorPatterns = listOf(
        Regex("转账成功"), Regex("支付成功"), Regex("付款成功"), Regex("已支付"),
        Regex("支付金额"), Regex("收款成功"), Regex("已收款"), Regex("你已收款"),
        Regex("已存入零钱"), Regex("已收钱"), Regex("红包已领取"),
        Regex("已到账"), Regex("到账金额"), Regex("付款方"), Regex("收款到账"),
        Regex("红包已发出"), Regex("已发出红包"), Regex("已被接收"),
        Regex("领取了[^，,。\\s]{1,24}红包"), Regex("付款给"),
        Regex("向[^，,。\\s]{1,24}转账"),
    )
    private val resultPatterns = listOf(
        Regex("转账成功"), Regex("支付成功"), Regex("付款成功"), Regex("收款成功"),
        Regex("已收款"), Regex("领取了[^，,。\\s]{1,24}红包"), Regex("红包已领取"),
        Regex("红包已发出"), Regex("已发出红包"), Regex("已存入零钱"), Regex("已到账"), Regex("到账金额"),
    )

    /** 红包在指纹确认后会直接退出，没有成功页；支付前这张确认单是最后一个稳定界面。 */
    private fun isRedPacketConfirm(text: String): Boolean =
        text.contains("微信红包") && (text.contains("付款方式") || text.contains("使用密码"))

    /** 所有微信支付在指纹前都会经过这张确认单，可作为统一入口先记“待确认”。 */
    private fun isConfirmSheet(text: String): Boolean =
        (text.contains("付款方式") || text.contains("使用密码")) &&
            text.contains("支付") && !text.contains("支付成功")
    private val merchantPatterns = listOf(
        Regex("""收款方[：:]?\s*([^，,。\s]{1,24})"""),
        Regex("""付款方[：:]?\s*([^，,。\s]{1,24})"""),
        Regex("""待\s*([^，,。\s]{1,12}?)\s*确认收款"""),
        Regex("""向\s*([^，,。\s]{1,24}?)\s*转账"""),
        Regex("""向\s*([^，,。\s]{1,24}?)\s*付款"""),
        Regex("""在\s*([^，,。\s]{1,24}?)\s*(?:消费|付款|支付)"""),
        Regex("""付款给\s*([^，,。\s]{1,24})"""),
        Regex("""([^，,。\s]{1,24}?)的付款"""),
        Regex("""转账给\s*([^，,。\s¥￥]{1,24})"""),
        Regex("""([^，,。\s]{1,24}?)的转账"""),
        Regex("""领取了\s*([^，,。\s]{1,24}?)\s*的红包"""),
        Regex("""发给\s*([^，,。\s]{1,24}?)\s*的红包"""),
    )

    fun appName(pkg: String): String = when (pkg) {
        ALIPAY -> "支付宝"
        WECHAT -> "微信"
        else -> pkg
    }

    fun isPaymentLike(title: String, text: String): Boolean {
        val joined = normalize(title + " " + text)
        return paymentWords.any { joined.contains(it) }
    }

    /** 只有交易结果锚点才计入账本；菜单、广告里的“转账/红包”不算。 */
    fun hasAnchor(text: String): Boolean {
        val normalized = normalize(text)
        return isConfirmSheet(normalized) || anchorPatterns.any { it.containsMatchIn(normalized) }
    }

    /** 成功页的优先级高于支付前页面，用于同金额合并时保留更可信的方向。 */
    fun isResultText(text: String): Boolean {
        val normalized = normalize(text)
        return resultPatterns.any { it.containsMatchIn(normalized) }
    }

    /** OCR 会把“支付 成功”拆成两段；去掉汉字之间的空白再匹配。 */
    private fun normalize(text: String): String =
        text.replace(Regex("""(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])"""), "")

    fun parse(title: String, text: String, packageName: String): ParsedPayment {
        val raw = (title + " " + text).trim()
        val joined = normalize(raw)
        val redPacketConfirm = isRedPacketConfirm(joined)
        val confirmSheet = isConfirmSheet(joined)
        // 确认单上方可能还有未输完的金额，取最后一个（底部确认单的 ¥5.00）。
        val amountMatch = if (confirmSheet) {
            moneySign.findAll(joined).lastOrNull() ?: yuanSuffix.findAll(joined).lastOrNull() ?: bareAmount.find(joined)
        } else {
            moneySign.find(joined) ?: yuanSuffix.find(joined) ?: bareAmount.find(joined)
        }
        val cents = amountMatch?.let {
            runCatching {
                BigDecimal(it.groupValues[1]).movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact()
            }.getOrNull()
        }
        val direction = when {
            joined.contains("退款") -> Direction.REFUND
            // 收款凭据上的“付款方”是对方，说明钱是收进来的；“付款方式”不是。
            joined.contains("付款方") && !joined.contains("付款方式") -> Direction.INCOME
            confirmSheet -> Direction.EXPENSE
            joined.contains("转账成功") && (joined.contains("收款方") || joined.contains("付款方式")) -> Direction.EXPENSE
            Regex("""向[^，,。\s]{1,24}转账""").containsMatchIn(joined) -> Direction.EXPENSE
            listOf("转账给", "已转账", "发出红包", "红包已发出", "已发出红包", "发给", "已被接收").any { joined.contains(it) } -> Direction.EXPENSE
            listOf("支付成功", "已支付", "付款", "扣款", "消费", "支出", "支付金额").any { joined.contains(it) } -> Direction.EXPENSE
            (joined.contains("收款") && !joined.contains("收款方")) -> Direction.INCOME
            listOf("收款成功", "已收款", "你已收款", "到账", "入账", "收到", "已收钱", "领取了", "已存入零钱", "收钱", "付款方", "已到账", "到账金额", "收款到账").any { joined.contains(it) } -> Direction.INCOME
            else -> Direction.UNKNOWN
        }
        val merchant = if (redPacketConfirm) "微信红包" else {
            merchantPatterns.firstNotNullOfOrNull { pattern ->
                pattern.find(raw)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }
            } ?: title.trim().ifEmpty { appName(packageName) }
        }
        val note = when {
            confirmSheet -> "pending_confirm"
            cents == null -> "no_amount"
            else -> ""
        }
        return ParsedPayment(cents, direction, merchant, note)
    }

    fun directionLabel(direction: Direction): String = when (direction) {
        Direction.EXPENSE -> "支出"
        Direction.INCOME -> "收入"
        Direction.REFUND -> "退款"
        Direction.UNKNOWN -> "方向未知"
    }

    fun amountLabel(cents: Long?): String = cents?.let { "¥ %.2f".format(it / 100.0) } ?: "未识别金额"
}
