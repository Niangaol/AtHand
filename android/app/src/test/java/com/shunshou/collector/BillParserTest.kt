package com.shunshou.collector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BillParserTest {
    @Test
    fun `parses a campus card bill detail as expense`() {
        val lines = listOf(
            "-15.00", "当前状态", "支付成功", "支付时间", "2026年11月20日 17:40:55",
            "商品", "一卡通", "商户全称", "示例大学", "收单机构", "财付通支付科技有限公司",
            "支付方式", "零钱", "交易单号", "4200003142202611201843903136",
        )
        val bill = BillParser.parse(lines)!!
        assertEquals("示例大学", bill.merchant)
        assertEquals(1500L, bill.amountCents)
        assertEquals(Direction.EXPENSE, bill.direction)
        assertEquals("一卡通", bill.product)
    }

    @Test
    fun `parses a sent red packet bill as expense`() {
        val lines = listOf("当前状态", "支付成功", "商品", "微信红包", "商户全称", "微信红包", "-5.00")
        val bill = BillParser.parse(lines)!!
        assertEquals(500L, bill.amountCents)
        assertEquals(Direction.EXPENSE, bill.direction)
    }

    @Test
    fun `parses a received red packet bill as income`() {
        val lines = listOf("当前状态", "已到账", "商品", "微信红包", "商户全称", "张三", "+5.00")
        val bill = BillParser.parse(lines)!!
        assertEquals(500L, bill.amountCents)
        assertEquals(Direction.INCOME, bill.direction)
        assertEquals("张三", bill.merchant)
    }

    @Test
    fun `ignores screens that are not bills`() {
        assertNull(BillParser.parse(listOf("支付成功", "¥ 5.00", "完成")))
    }
}
