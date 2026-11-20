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
    fun `parses wechat success screenshot OCR lines`() {
        val ocr = "支付 成功 待张三确认收款 ¥ 5.00 完成"
        assertTrue(PaymentParser.hasAnchor(ocr))
        val parsed = PaymentParser.parse("", ocr, PaymentParser.WECHAT)
        assertEquals(500L, parsed.amountCents)
        assertEquals(Direction.EXPENSE, parsed.direction)
        assertEquals("张三", parsed.merchant)
    }

    @Test
    fun `alipay receipt success is income and takes the payer name`() {
        val text = "收款成功 ¥5.00 付款方：张三 已到账"
        assertTrue(PaymentParser.hasAnchor(text))
        val parsed = PaymentParser.parse("", text, PaymentParser.ALIPAY)
        assertEquals(500L, parsed.amountCents)
        assertEquals(Direction.INCOME, parsed.direction)
        assertEquals("张三", parsed.merchant)
    }

    @Test
    fun `only transaction result screens are anchored`() {
        assertTrue(PaymentParser.hasAnchor("转账成功￥5.00 收款方 张三"))
        assertTrue(PaymentParser.hasAnchor("你领取了张三的红包 0.01元"))
        assertTrue(PaymentParser.hasAnchor("红包已发出 0.01元"))
        assertFalse(PaymentParser.hasAnchor("恭喜获得小荷包支付红包 0.68 元 有效期3天"))
        assertFalse(PaymentParser.hasAnchor("转账 红包 收款 扫一扫 收付款"))
    }

    @Test
    fun `alipay transfer success is an expense for the payer`() {
        val parsed = PaymentParser.parse("", "转账成功￥5.00 收款方： 张三 查看凭证", PaymentParser.ALIPAY)
        assertEquals(500L, parsed.amountCents)
        assertEquals(Direction.EXPENSE, parsed.direction)
        assertEquals("张三", parsed.merchant)
    }

    @Test
    fun `recognizes a red packet without a currency sign`() {
        val parsed = PaymentParser.parse("", "微信红包 0.01", PaymentParser.WECHAT)
        assertEquals(1L, parsed.amountCents)
        assertTrue(PaymentParser.isPaymentLike("", "微信红包"))
    }

    @Test
    fun `recognizes a received red packet as income`() {
        val parsed = PaymentParser.parse("", "你领取了张三的红包 0.01元", PaymentParser.WECHAT)
        assertEquals(1L, parsed.amountCents)
        assertEquals(Direction.INCOME, parsed.direction)
        assertEquals("张三", parsed.merchant)
    }

    @Test
    fun `recognizes a transfer to a person as expense`() {
        val parsed = PaymentParser.parse("", "转账给李四 ¥0.01", PaymentParser.WECHAT)
        assertEquals(1L, parsed.amountCents)
        assertEquals(Direction.EXPENSE, parsed.direction)
        assertEquals("李四", parsed.merchant)
    }

    @Test
    fun `does not treat a year as money`() {
        val parsed = PaymentParser.parse("账单", "2026 年度账单已生成", PaymentParser.ALIPAY)
        assertNull(parsed.amountCents)
    }
}
