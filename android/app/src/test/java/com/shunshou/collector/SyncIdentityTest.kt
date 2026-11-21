package com.shunshou.collector

import org.junit.Assert.*
import org.junit.Test

class SyncIdentityTest {
    @Test fun tokensAreBoundToServerAndCredentials() {
        assertEquals(syncIdentity("http://localhost:18787/", "secret"), syncIdentity("http://localhost:18787", "secret"))
        assertNotEquals(syncIdentity("http://localhost:18787", "secret"), syncIdentity("http://other:18787", "secret"))
        assertNotEquals(syncIdentity("http://localhost:18787", "secret"), syncIdentity("http://localhost:18787", "changed"))
    }
}
