package com.shunshou.collector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SnapshotProcessorTest {
    private val confirmSheet = listOf(
        "发红包", "金额", "¥5.", "恭喜发财，大吉大利", "微信红包", "¥ 5.00",
        "付款方式", "零钱", "支付", "使用密码",
    )

    private val campusBill = listOf(
        "-15.00", "当前状态", "支付成功", "支付时间", "2026年11月20日 17:40:55",
        "商品", "一卡通", "商户全称", "示例大学", "支付方式", "零钱",
        "交易单号", "4200003142202611201843903136",
    )

    private val redPacketBill = listOf(
        "-5.00", "当前状态", "支付成功", "商品", "微信红包", "商户全称", "微信红包",
        "支付方式", "零钱", "交易单号", "4200000000000000000000000000",
    )

    private val receivedBill = listOf(
        "+5.00", "当前状态", "已到账", "商品", "微信红包", "商户全称", "张三",
        "交易单号", "4200000000000000000000000001",
    )

    @Test
    fun `red packet confirm sheet becomes a pending expense`() {
        val sample = SnapshotProcessor.process(PaymentParser.WECHAT, confirmSheet, 1_000)!!
        assertEquals(500L, sample.amountCents)
        assertEquals(Direction.EXPENSE, sample.direction)
        assertEquals("微信红包", sample.merchant)
        assertEquals("pending_confirm", sample.note)
    }

    @Test
    fun `campus bill takes the merchant from the bill fields`() {
        val sample = SnapshotProcessor.process(PaymentParser.WECHAT, campusBill, 1_000)!!
        assertEquals("账单识别", sample.title)
        assertEquals(1500L, sample.amountCents)
        assertEquals(Direction.EXPENSE, sample.direction)
        assertEquals("示例大学", sample.merchant)
        assertEquals("", sample.note)
    }

    @Test
    fun `sent red packet bill and received bill keep their direction`() {
        assertEquals(Direction.EXPENSE, SnapshotProcessor.process(PaymentParser.WECHAT, redPacketBill, 1_000)!!.direction)
        val received = SnapshotProcessor.process(PaymentParser.WECHAT, receivedBill, 1_000)!!
        assertEquals(Direction.INCOME, received.direction)
        assertEquals("张三", received.merchant)
    }

    @Test
    fun `bill result merges with the earlier confirm sheet`() {
        val confirm = SnapshotProcessor.process(PaymentParser.WECHAT, confirmSheet, 1_000)!!
        val bill = SnapshotProcessor.process(PaymentParser.WECHAT, redPacketBill, 2_000)!!
        val merged = PaymentSampleMerge.merge(confirm, bill)!!
        assertEquals("账单识别", merged.title)
        assertEquals("", merged.note)
        assertEquals(500L, merged.amountCents)
        assertEquals(Direction.EXPENSE, merged.direction)
    }

    @Test
    fun `menu screens without a transaction are not recorded`() {
        assertNull(SnapshotProcessor.process(PaymentParser.WECHAT, listOf("转账", "红包", "收款", "扫一扫"), 1_000))
    }

    @Test
    fun `unrelated apps are ignored`() {
        assertNull(SnapshotProcessor.process("com.example.other", confirmSheet, 1_000))
    }
}
