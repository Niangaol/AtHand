package com.shunshou.collector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingPayloadTest {
    private val now = 1_800_000_000_000L

    @Test
    fun `parses a valid pairing qr`() {
        val payload = PairingPayload.parse(
            """{"v":1,"u":"https://example.trycloudflare.com/","c":"0123456789","e":${now + 60_000}}""",
            now,
        )
        assertEquals("https://example.trycloudflare.com", payload?.url)
        assertEquals("0123456789", payload?.code)
        assertEquals(now + 60_000, payload?.expiresAt)
    }

    @Test
    fun `rejects wrong version, bad url, bad code and expired codes`() {
        assertNull(PairingPayload.parse("""{"v":2,"u":"https://a.example","c":"0123456789","e":${now + 1000}}""", now))
        assertNull(PairingPayload.parse("""{"v":1,"u":"ftp://a.example","c":"0123456789","e":${now + 1000}}""", now))
        assertNull(PairingPayload.parse("""{"v":1,"u":"http://","c":"0123456789","e":${now + 1000}}""", now))
        assertNull(PairingPayload.parse("""{"v":1,"u":"https://a.example","c":"short","e":${now + 1000}}""", now))
        assertNull(PairingPayload.parse("""{"v":1,"u":"https://a.example","c":"0123456789","e":${now - 1}}""", now))
        assertNull(PairingPayload.parse("not json", now))
    }
}
