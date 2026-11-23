package com.shunshou.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
        // 缺失回落正数默认值而不是 0：网页端 positiveInteger 要求 settings.hourlyRateCents > 0。
        assertEquals(2000L, state.hourlyRateCents)
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
        assertEquals(1795000000000L, snapshot.focusSessions[0].segments[0].start)
        assertNull(snapshot.focusSessions[0].segments[0].end)
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

    @Test
    fun keepsSegmentStartSoPauseGapIsNotCounted() {
        val body = JSONObject(
            """{"state":{"version":1,"events":[],"courseRules":[],
                "focusSessions":[{"id":"f1","task":"看书","minutes":25,"startedAt":1000,
                  "status":"paused","segments":[{"start":1000,"end":2000},{"start":5000,"end":6000}],
                  "owner":"dev1","epoch":1}],
                "countdowns":[],"trips":[],"serviceEntries":[],
                "preferences":{"focusMinutes":25},"reminderReceipts":[]},"revision":1}"""
        )
        val session = Models.parsePlanner(body).focusSessions[0]
        assertEquals(2, session.segments.size)
        assertEquals(1000L, session.segments[0].start)
        assertEquals(2000L, session.segments[0].end)
        assertEquals(5000L, session.segments[1].start)
        assertEquals(6000L, session.segments[1].end)
    }

    @Test
    fun normalizesZeroHourlyRateToPositiveDefault() {
        val body = JSONObject(
            """{"ok":true,"ledger":{"version":1,"records":[],"workplaces":[],"settings":{"hourlyRateCents":0}}}"""
        )
        assertEquals(2000L, Models.parseLedger(body).hourlyRateCents)
    }

    @Test
    fun normalizesUnknownSourceToManual() {
        val body = JSONObject(
            """{"ok":true,"ledger":{"version":1,"records":[
                 {"id":"r1","type":"expense","date":"2026-11-23","title":"x","amountCents":100,
                  "category":"吃饭","source":""}],
               "workplaces":[],"settings":{"hourlyRateCents":2000}}}"""
        )
        assertEquals("manual", Models.parseLedger(body).records[0].source)
    }

    @Test
    fun ledgerProblemsAcceptsValidWorkRecord() {
        val state = LedgerState(
            version = 1,
            records = listOf(
                RecordEntry(
                    id = "w1", type = "work", date = "2026-11-23", title = "家教",
                    amountCents = 9000, category = null, workplaceId = "u1",
                    startTime = "14:00", endTime = "16:00", durationMinutes = 120,
                    hourlyRateCents = 4500, source = "manual",
                )
            ),
            workplaces = listOf(Workplace("u1", "家教", 4500, "", "manual")),
            hourlyRateCents = 4500,
        )
        assertEquals(emptyList<String>(), Models.ledgerProblems(state))
    }

    @Test
    fun ledgerProblemsRejectsAmountMismatch() {
        val state = LedgerState(
            version = 1,
            records = listOf(
                RecordEntry(
                    id = "w1", type = "work", date = "2026-11-23", title = "家教",
                    amountCents = 9999, category = null, workplaceId = "u1",
                    startTime = "14:00", endTime = "16:00", durationMinutes = 120,
                    hourlyRateCents = 4500, source = "manual",
                )
            ),
            workplaces = listOf(Workplace("u1", "家教", 4500, "", "manual")),
            hourlyRateCents = 4500,
        )
        assertTrue(Models.ledgerProblems(state).any { it.contains("金额与时长×时薪不一致") })
    }

    @Test
    fun ledgerProblemsRejectsMissingWorkplace() {
        val state = LedgerState(
            version = 1,
            records = listOf(
                RecordEntry(
                    id = "w1", type = "work", date = "2026-11-23", title = "家教",
                    amountCents = 9000, category = null, workplaceId = "ghost",
                    startTime = "14:00", endTime = "16:00", durationMinutes = 120,
                    hourlyRateCents = 4500, source = "manual",
                )
            ),
            workplaces = emptyList(),
            hourlyRateCents = 2000,
        )
        assertTrue(Models.ledgerProblems(state).any { it.contains("单位不存在") })
    }

    @Test
    fun normalizesWorkplaceSourceToManual() {
        val body = JSONObject(
            """{"ok":true,"ledger":{"version":1,"records":[],
               "workplaces":[{"id":"u1","name":"家教","hourlyRateCents":4500,
                              "description":"","source":"school"}],
               "settings":{"hourlyRateCents":4500}}}"""
        )
        assertEquals("manual", Models.parseLedger(body).workplaces[0].source)
    }
}
