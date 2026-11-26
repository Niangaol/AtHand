package com.shunshou.app.ui.motion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JournalMotionSpecTest {
    @Test
    fun keepsTactileMotionShortEnoughForImmediateFeedback() {
        val spec = JournalMotionSpec.resolve(reducedMotion = false)

        assertTrue(spec.pressDurationMillis in 80..140)
        assertTrue(spec.enterDurationMillis in 180..260)
        assertTrue(spec.pageDurationMillis in 240..340)
        assertEquals(0.97f, spec.pressedScale, 0.0001f)
        assertEquals(2f, spec.pressedOffset, 0.0001f)
        assertTrue(spec.enterOffset in 8f..16f)
        assertTrue(spec.enterRotation in 0.2f..0.6f)
    }

    @Test
    fun removesSpatialAndSpringMotionWhenReducedMotionIsEnabled() {
        val spec = JournalMotionSpec.resolve(reducedMotion = true)

        assertEquals(1f, spec.pressedScale, 0.0001f)
        assertEquals(0f, spec.pressedOffset, 0.0001f)
        assertEquals(0f, spec.enterOffset, 0.0001f)
        assertEquals(0f, spec.enterRotation, 0.0001f)
        assertEquals(0, spec.staggerDelayMillis)
        assertTrue(spec.enterDurationMillis <= 90)
        assertTrue(spec.pageDurationMillis <= 90)
    }

    @Test
    fun treatsDisabledAnimatorDurationScaleAsReducedMotion() {
        assertTrue(JournalMotionSpec.isReducedMotion(0f))
        assertFalse(JournalMotionSpec.isReducedMotion(0.5f))
        assertFalse(JournalMotionSpec.isReducedMotion(1f))
        assertFalse(JournalMotionSpec.isReducedMotion(2f))
    }

    @Test
    fun capsHomepageStaggerBudgetBelowTwoHundredMilliseconds() {
        val spec = JournalMotionSpec.resolve(reducedMotion = false)

        assertTrue(spec.staggerDelayMillis * 4 <= 200)
    }
}
