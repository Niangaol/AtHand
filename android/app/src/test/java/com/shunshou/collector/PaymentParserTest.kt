package com.shunshou.collector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentParserTest {
    @Test
    fun `parses alipay expense with yuan suffix`() {
        val parsed = PaymentParser.parse("支付宝", "支付成功 12.50元", PaymentParser.ALIPAY)
        assertEquals(1250L, parsed.amountCents)
        assertEquals(Direction.EXPENSE, parsed.direction)
    }

    @Test
    fun `parses wechat expense with money sign`() {
        val parsed = PaymentParser.parse("微信支付凭证", "已支付¥18.00", PaymentParser.WECHAT)
        assertEquals(1800L, parsed.amountCents)
        assertEquals(Direction.EXPENSE, parsed.direction)
    }

    @Test
    fun `parses income`() {
        val parsed = PaymentParser.parse("微信收款", "收款20.00元", PaymentParser.WECHAT)
        assertEquals(2000L, parsed.amountCents)
        assertEquals(Direction.INCOME, parsed.direction)
    }

    @Test
    fun `labels refunds separately from expenses`() {
        val parsed = PaymentParser.parse("退款通知", "退款 5.00元", PaymentParser.WECHAT)
        assertEquals(500L, parsed.amountCents)
        assertEquals(Direction.REFUND, parsed.direction)
    }

    @Test
    fun `extracts merchant after xiang`() {
        val parsed = PaymentParser.parse("", "向校园奶茶店付款 15.00元", PaymentParser.ALIPAY)
        assertEquals("校园奶茶店", parsed.merchant)
    }

    @Test
    fun `keeps a sample when the notification has no amount`() {
        val parsed = PaymentParser.parse("支付宝", "你有一笔新的支付", PaymentParser.ALIPAY)
        assertNull(parsed.amountCents)
        assertEquals("no_amount", parsed.note)
    }

    @Test
    fun `ignores unrelated notifications from the same app`() {
        assertFalse(PaymentParser.isPaymentLike("腾讯新闻", "今日要闻"))
        assertTrue(PaymentParser.isPaymentLike("微信", "你有一笔支付"))
    }

    @Test
    fun `does not treat a year as money`() {
        val parsed = PaymentParser.parse("账单", "2026 年度账单已生成", PaymentParser.ALIPAY)
        assertNull(parsed.amountCents)
    }
}
