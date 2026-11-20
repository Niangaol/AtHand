package com.shunshou.collector

object FocusParser {
    fun packageFromDumpsys(output: String): String =
        Regex("""mCurrentFocus=Window\{[^}]*?\s([a-zA-Z0-9_.]+)/""")
            .find(output)?.groupValues?.get(1).orEmpty()
}
