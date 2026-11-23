package com.shunshou.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelsTest {
    @Test
    fun parsesLedgerResponse() {
        val body = JSONObject(
            """{"ok":true,"ledger":{"version":1,"records":[
                 {"id":"r1","type":"expense","date":"2026-11-23","title":"午饭",
                  "amountCents":1850,"category":"吃饭","source":"manual"},
                 {"id":"r2","type":"work","date":"2026-11-22","title":"家教",
                  "amountCents":9000,"workplaceId":"w1","startTime":"14:00","endTime":"16:00",
                  "durationMinutes":120,"hourlyRateCents":4500,"source":"manual"}],
               "workplaces":[{"id":"w1","name":"家教","hourlyRateCents":4500,"description":"","source":"manual"}],
               "settings":{"hourlyRateCents":4500}},"updatedAt":"2026-11-23T02:00:00.000Z"}"""
        )
        val state = Models.parseLedger(body)
        assertEquals(2, state.records.size)
        assertEquals(1850L, state.records[0].amountCents)
        assertEquals("吃饭", state.records[0].category)
        assertEquals(120, state.records[1].durationMinutes)
        assertEquals(4500L, state.workplaces[0].hourlyRateCents)
        assertEquals(4500L, state.hourlyRateCents)
    }

    @Test
    fun toleratesNullLedger() {
        val state = Models.parseLedger(JSONObject("""{"ok":true,"ledger":null}"""))
        assertEquals(0, state.records.size)
        assertEquals(0L, state.hourlyRateCents)
    }

    @Test
    fun parsesPlannerResponse() {
        val body = JSONObject(
            """{"state":{"version":1,"events":[{"id":"e1","title":"课","kind":"course",
                 "location":"A101","start":1795000000000,"end":1795003600000,"allDay":false,
                 "timeZone":"Asia/Shanghai","source":"manual","sourceId":""}],
                "courseRules":[],"focusSessions":[{"id":"f1","task":"看书","minutes":25,
                 "startedAt":1795000000000,"status":"running","segments":[{"start":1795000000000,"end":null}],
                 "owner":"dev1","epoch":1}],
                "countdowns":[],"trips":[],"serviceEntries":[],
                "preferences":{"focusMinutes":30},"reminderReceipts":[]},
               "revision":7}"""
        )
        val snapshot = Models.parsePlanner(body)
        assertEquals(7, snapshot.revision)
        assertEquals("课", snapshot.events[0].title)
        assertEquals(1, snapshot.focusSessions[0].epoch)
        assertNull(snapshot.focusSessions[0].segments[0])
        assertEquals(30, snapshot.focusMinutes)
    }

    @Test
    fun serializesLedgerRoundTrip() {
        val record = RecordEntry(
            id = "r1", type = "expense", date = "2026-11-23", title = "午饭",
            amountCents = 1850, category = "吃饭", workplaceId = null, startTime = null,
            endTime = null, durationMinutes = null, hourlyRateCents = null, source = "manual"
        )
        val json = Models.recordJson(record)
        assertEquals("r1", json.getString("id"))
        assertEquals(1850L, json.getLong("amountCents"))
        assertEquals("吃饭", json.getString("category"))
    }
}
