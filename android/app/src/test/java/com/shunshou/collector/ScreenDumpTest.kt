package com.shunshou.collector

import org.junit.Assert.assertEquals
import org.junit.Test

class ScreenDumpTest {
    @Test
    fun `extracts payment text and skips password and editable nodes`() {
        val xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
            <hierarchy rotation="0">
              <node package="com.tencent.mm" class="android.widget.TextView" text="支付成功" password="false" content-desc="" />
              <node package="com.tencent.mm" class="android.widget.EditText" text="123456" password="true" />
              <node package="com.tencent.mm" class="android.widget.TextView" text="¥18.00" />
            </hierarchy>""".trimIndent()
        val snapshot = ScreenDump.extract(xml)
        assertEquals("com.tencent.mm", snapshot.packageName)
        assertEquals(listOf("支付成功", "¥18.00"), snapshot.texts)
    }
}
