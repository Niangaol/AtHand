package com.shunshou.collector

import rikka.shizuku.Shizuku

object ShizukuBridge {
    fun shell(command: String): String {
        val process = newProcess(command)
        val output = process.inputStream.bufferedReader().use { it.readText() }
        val error = process.errorStream.bufferedReader().use { it.readText() }
        val code = process.waitFor()
        if (code != 0) throw IllegalStateException(error.trim().ifEmpty { "exit $code" })
        return output
    }

    @Suppress("UNCHECKED_CAST")
    private fun newProcess(command: String): Process {
        // 13.1.5 起 newProcess 为私有；它是库类而非框架类，反射不受隐藏 API 限制。
        val method = Shizuku::class.java.getDeclaredMethod(
            "newProcess",
            Array<String>::class.java,
            Array<String>::class.java,
            String::class.java,
        )
        method.isAccessible = true
        return try {
            method.invoke(null, arrayOf("sh", "-c", command), null, null) as Process
        } catch (error: java.lang.reflect.InvocationTargetException) {
            throw error.targetException
        }
    }

    fun screenshot(): ByteArray {
        val process = newProcess("screencap -p")
        val bytes = process.inputStream.use { it.readBytes() }
        val code = process.waitFor()
        if (code != 0 || bytes.isEmpty()) throw IllegalStateException("截图失败（exit $code）")
        return bytes
    }

    fun currentPackage(): String =
        FocusParser.packageFromDumpsys(shell("dumpsys window | grep -m1 mCurrentFocus"))

    fun enableAccessibility(packageName: String): String {
        val component = "$packageName/${PaymentAccessibilityService::class.java.name}"
        val current = shell("settings get secure enabled_accessibility_services").trim()
            .let { if (it == "null" || it.isEmpty()) "" else it }
        val parts = current.split(":").filter { it.isNotBlank() }
        if (component in parts) return "无障碍已开启"
        val next = (parts + component).distinct().joinToString(":")
        shell("settings put secure enabled_accessibility_services '$next'")
        shell("settings put secure accessibility_enabled 1")
        return "无障碍已开启"
    }

    fun disableAccessibility(packageName: String): String {
        val component = "$packageName/${PaymentAccessibilityService::class.java.name}"
        val current = shell("settings get secure enabled_accessibility_services").trim()
            .let { if (it == "null" || it.isEmpty()) "" else it }
        val next = current.split(":").filter { it.isNotBlank() && it != component }.joinToString(":")
        shell("settings put secure enabled_accessibility_services '$next'")
        if (next.isEmpty()) shell("settings put secure accessibility_enabled 0")
        return "无障碍已关闭"
    }

    fun grantCalendar(packageName: String): String {
        shell("pm grant $packageName android.permission.READ_CALENDAR")
        return "日历已授权"
    }
}
