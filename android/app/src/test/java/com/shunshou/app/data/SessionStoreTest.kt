package com.shunshou.app.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionStoreTest {
    @Test
    fun validWhenExpiryIsFarEnough() {
        val now = 1_795_000_000_000L
        assertTrue(SessionStore.isValidAt(expiresAt = now + 3_600_000L, now = now))
    }

    @Test
    fun invalidWithinRefreshWindow() {
        val now = 1_795_000_000_000L
        assertFalse(SessionStore.isValidAt(expiresAt = now + 30_000L, now = now))
    }

    @Test
    fun invalidWhenExpired() {
        val now = 1_795_000_000_000L
        assertFalse(SessionStore.isValidAt(expiresAt = now - 1L, now = now))
    }
}
