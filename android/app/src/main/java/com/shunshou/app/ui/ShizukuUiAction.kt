package com.shunshou.app.ui

enum class ShizukuUiAction {
    OPEN_APP,
    REQUEST_PERMISSION,
    NONE,
}

fun shizukuUiAction(running: Boolean, granted: Boolean): ShizukuUiAction = when {
    granted -> ShizukuUiAction.NONE
    running -> ShizukuUiAction.REQUEST_PERMISSION
    else -> ShizukuUiAction.OPEN_APP
}
