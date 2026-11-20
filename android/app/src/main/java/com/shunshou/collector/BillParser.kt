package com.shunshou.collector

import java.math.BigDecimal
import java.math.RoundingMode

data class BillFields(
    val merchant: String,
    val amountCents: Long?,
    val direction: Direction,
    val product: String,
    val status: String,
)

object BillParser {
    private val amountLine = Regex("""^[+-]?\d{1,9}(?:,\d{3})*\.\d{2}$""")

    fun looksLikeBill(text: String): Boolean =
        text.contains("交易单号") || text.contains("商户全称") || text.contains("当前状态")

    fun parse(lines: List<String>): BillFields? {
        val joined = lines.joinToString(" ")
        if (!looksLikeBill(joined)) return null

        fun valueAfter(label: String): String? {
            val index = lines.indexOfFirst { it.trim().startsWith(label) }
            if (index < 0) return null
            val same = lines[index].trim().removePrefix(label).trim().trim('：', ':').trim()
            return same.ifEmpty { lines.getOrNull(index + 1)?.trim() }
        }

        val rawAmount = lines
            .map { it.trim().replace('−', '-').replace('－', '-').replace(" ", "") }
            .firstOrNull { amountLine.matches(it) }
        val cents: Long? = rawAmount?.let { amount ->
            runCatching {
                val value: Long = BigDecimal(amount.removePrefix("+")).movePointRight(2)
                    .setScale(0, RoundingMode.HALF_UP).longValueExact()
                if (value < 0) -value else value
            }.getOrNull()
        }
        val negative = rawAmount?.startsWith("-") == true
        val positive = rawAmount?.startsWith("+") == true
        val status = valueAfter("当前状态") ?: ""
        val merchant = valueAfter("商户全称").orEmpty()
        val product = valueAfter("商品").orEmpty()

        val direction = when {
            status.contains("退款") -> Direction.REFUND
            negative -> Direction.EXPENSE
            status.contains("到账") || status.contains("已收款") || status.contains("存入零钱") || positive -> Direction.INCOME
            status.contains("支付成功") || status.contains("转账成功") -> Direction.EXPENSE
            else -> Direction.UNKNOWN
        }
        if (cents == null || direction == Direction.UNKNOWN) return null
        return BillFields(merchant, cents, direction, product, status)
    }
}
