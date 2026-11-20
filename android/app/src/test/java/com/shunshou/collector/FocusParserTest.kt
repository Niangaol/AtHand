package com.shunshou.collector

import org.junit.Assert.assertEquals
import org.junit.Test

class FocusParserTest {
    @Test
    fun `extracts the foreground package from dumpsys window`() {
        val line = "  mCurrentFocus=Window{62497e6 u0 com.tencent.mm/com.tencent.mm.framework.app.UIPageFragmentActivity}"
        assertEquals("com.tencent.mm", FocusParser.packageFromDumpsys(line))
    }
}
