package com.shunshou.collector

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class CalendarModelTest {
    @Test fun windowUsesFourteenLocalDaysAcrossDst() {
        val zone = ZoneId.of("America/New_York")
        val window = CalendarWindow.around(Instant.parse("2026-03-01T18:00:00Z").toEpochMilli(), zone)
        assertEquals(Instant.parse("2026-03-01T05:00:00Z").toEpochMilli(), window.begin)
        assertEquals(Instant.parse("2026-03-15T04:00:00Z").toEpochMilli(), window.end)
    }
    @Test fun instanceIdentityIncludesDeviceEventAndOccurrence() {
        val id = calendarInstanceId("phone-a", 42, 1000)
        assertEquals(id, calendarInstanceId("phone-a", 42, 1000))
        assertNotEquals(id, calendarInstanceId("phone-b", 42, 1000))
        assertNotEquals(id, calendarInstanceId("phone-a", 42, 2000))
    }
    @Test fun oneOffReschedulingKeepsIdentityAndRejectedRequestsDoNotBlockNewSnapshots() {
        assertEquals(calendarStableId("phone", 42, 1000, false), calendarStableId("phone", 42, 2000, false))
        assertNotEquals(calendarStableId("phone", 42, 1000, true), calendarStableId("phone", 42, 2000, true))
        assertEquals(calendarStableId("phone", 42, 1000, true), calendarStableId("phone", 99, 2000, false, 42, 1000))
        assertTrue(calendarRejectIsFinal(400))
        assertFalse(calendarRejectIsFinal(500))
        assertFalse(calendarRejectIsFinal(401))
    }
    @Test fun allDayUtcProviderDatesBecomeLocalMidnights() {
        val utc = Instant.parse("2026-11-21T00:00:00Z").toEpochMilli()
        assertEquals(Instant.parse("2026-11-20T16:00:00Z").toEpochMilli(), calendarAllDayLocal(utc, ZoneId.of("Asia/Shanghai")))
    }
}
