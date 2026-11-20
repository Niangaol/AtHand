package com.shunshou.collector

import org.w3c.dom.Element
import org.xml.sax.InputSource
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory

data class ScreenSnapshot(val packageName: String, val texts: List<String>)

object ScreenDump {
    fun read(): ScreenSnapshot {
        val xml = ShizukuBridge.shell(
            "uiautomator dump /data/local/tmp/shunshou_ui.xml >/dev/null 2>&1; " +
                "cat /data/local/tmp/shunshou_ui.xml"
        )
        if (!xml.contains("<hierarchy")) {
            throw IllegalStateException("读取不到界面结构，可能是安全页面或系统限制。")
        }
        return extract(xml)
    }

    fun extract(xml: String): ScreenSnapshot {
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(InputSource(StringReader(xml)))
        val nodes = document.getElementsByTagName("node")
        var packageName = ""
        val texts = LinkedHashSet<String>()
        for (index in 0 until nodes.length) {
            val node = nodes.item(index) as? Element ?: continue
            if (packageName.isEmpty()) packageName = node.getAttribute("package").orEmpty()
            // 与无障碍通道同一约束：跳过密码框和可编辑输入框。
            if (node.getAttribute("password") == "true") continue
            if (node.getAttribute("class").contains("EditText")) continue
            for (attribute in listOf("text", "content-desc")) {
                val value = node.getAttribute(attribute).trim()
                if (value.isNotEmpty() && value != "null") texts.add(value)
            }
        }
        return ScreenSnapshot(packageName, texts.toList())
    }
}
