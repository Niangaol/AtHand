package com.shunshou.collector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentSampleMergeTest {
    private fun sample(text: String, amount: Long?, direction: Direction, at: Long, note: String = "") = PaymentSample(
        id = "same-id", packageName = PaymentParser.WECHAT, title = "屏幕文字", text = text,
        at = at, amountCents = amount, direction = direction, merchant = "张三",
        source = Source.ACCESSIBILITY, note = note,
    )

    @Test
    fun `merges prepay and success screens into one record`() {
        val prepay = sample("向张三转账 支付金额5.00元", 500, Direction.EXPENSE, 1_000)
        val success = sample("转账成功￥5.00 收款方 张三", 500, Direction.EXPENSE, 2_000)
        val merged = PaymentSampleMerge.merge(prepay, success)!!
        assertEquals("same-id", merged.id)
        assertEquals(Direction.EXPENSE, merged.direction)
        assertEquals(1_000L, merged.at)
    }

    @Test
    fun `result screen overrides an unknown direction`() {
        val prepay = sample("向张三转账 支付金额5.00元", 500, Direction.UNKNOWN, 1_000)
        val success = sample("转账成功￥5.00 收款方 张三", 500, Direction.EXPENSE, 2_000)
        assertEquals(Direction.EXPENSE, PaymentSampleMerge.merge(prepay, success)!!.direction)
    }

    @Test
    fun `does not merge different amounts or far apart`() {
        val first = sample("转账成功￥5.00", 500, Direction.EXPENSE, 1_000)
        assertNull(PaymentSampleMerge.merge(first, first.copy(amountCents = 600, at = 2_000)))
        assertNull(PaymentSampleMerge.merge(first, first.copy(at = 1_000 + 6 * 60_000)))
    }

    @Test
    fun `never folds an unmatched raw screen into a transaction`() {
        val raw = sample("转账 红包 收款 广告", null, Direction.UNKNOWN, 1_000, note = "not_payment")
        val real = sample("转账成功￥5.00", 500, Direction.EXPENSE, 2_000)
        assertNull(PaymentSampleMerge.merge(raw, real))
    }

    @Test
    fun `keeps one record when the same screen repeats`() {
        val first = sample("转账成功￥5.00", 500, Direction.EXPENSE, 1_000)
        val repeat = first.copy(at = 1_500)
        assertTrue(PaymentSampleMerge.merge(first, repeat) != null)
    }
}
