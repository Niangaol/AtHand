package com.shunshou.app.ui.motion

data class JournalMotionSpec(
    val pressDurationMillis: Int,
    val enterDurationMillis: Int,
    val pageDurationMillis: Int,
    val pressedScale: Float,
    val pressedOffset: Float,
    val enterOffset: Float,
    val enterRotation: Float,
    val staggerDelayMillis: Int,
) {
    companion object {
        private val tactile = JournalMotionSpec(
            pressDurationMillis = 110,
            enterDurationMillis = 220,
            pageDurationMillis = 280,
            pressedScale = 0.97f,
            pressedOffset = 2f,
            enterOffset = 12f,
            enterRotation = 0.4f,
            staggerDelayMillis = 35,
        )

        private val reduced = JournalMotionSpec(
            pressDurationMillis = 0,
            enterDurationMillis = 90,
            pageDurationMillis = 90,
            pressedScale = 1f,
            pressedOffset = 0f,
            enterOffset = 0f,
            enterRotation = 0f,
            staggerDelayMillis = 0,
        )

        fun resolve(reducedMotion: Boolean): JournalMotionSpec = if (reducedMotion) reduced else tactile

        fun isReducedMotion(durationScale: Float): Boolean = durationScale <= 0f
    }
}
