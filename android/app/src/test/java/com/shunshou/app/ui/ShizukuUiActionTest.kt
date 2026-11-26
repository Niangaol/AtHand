package com.shunshou.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class ShizukuUiActionTest {
    @Test
    fun opensShizukuAppWhenBinderIsNotRunning() {
        assertEquals(ShizukuUiAction.OPEN_APP, shizukuUiAction(running = false, granted = false))
    }

    @Test
    fun requestsPermissionWhenBinderIsRunningButNotGranted() {
        assertEquals(ShizukuUiAction.REQUEST_PERMISSION, shizukuUiAction(running = true, granted = false))
    }

    @Test
    fun doesNothingWhenPermissionIsAlreadyGranted() {
        assertEquals(ShizukuUiAction.NONE, shizukuUiAction(running = true, granted = true))
    }

    @Test
    fun grantedStateWinsWhenRunningFlagIsStale() {
        assertEquals(ShizukuUiAction.NONE, shizukuUiAction(running = false, granted = true))
    }
}
