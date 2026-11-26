package com.shunshou.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CalendarModelsTest {
    private val eventJson = JSONObject()
        .put("id", "calendar-1")
        .put("title", "高等数学")
        .put("kind", "event")
        .put("location", "教学楼 301")
        .put("start", 1_800_000_000_000L)
        .put("end", 1_800_000_003_600_000L)
        .put("allDay", false)
        .put("source", "calendar")

    @Test
    fun parsesCloudCalendarSourcesAndEvents() {
        val body = JSONObject()
            .put("serverId", "server-1")
            .put("sources", org.json.JSONArray().put(JSONObject()
                .put("sourceId", "phone:one")
                .put("revision", 3)
                .put("rangeStart", 1_799_000_000_000L)
                .put("rangeEnd", 1_810_000_000_000L)
                .put("fetchedAt", 1_800_000_000_000L)
                .put("calendarAvailable", true)
                .put("complete", true)
                .put("events", org.json.JSONArray().put(eventJson))))

        val sources = Models.parseCalendar(body)

        assertEquals(1, sources.size)
        assertEquals("phone:one", sources.single().sourceId)
        assertEquals(3, sources.single().revision)
        assertEquals("高等数学", sources.single().events.single().title)
        assertEquals("calendar", sources.single().events.single().source)
    }

    @Test
    fun mergesPlannerAndCalendarEventsWithoutDuplicates() {
        val planner = PlannerEvent("same", "课程表", "course", "线上", 100L, 200L, false, "school")
        val calendar = PlannerEvent("same", "手机日历", "event", "教室", 100L, 200L, false, "calendar")
        val later = PlannerEvent("later", "晚自习", "event", "教室", 300L, 400L, false, "calendar")
        val state = AppUiState(
            planner = PlannerSnapshot(1, listOf(planner), emptyList(), 25),
            calendar = CalendarState(listOf(CalendarSnapshot(
                sourceId = "phone:one", revision = 1, rangeStart = 0L, rangeEnd = 1_000L,
                fetchedAt = 0L, calendarAvailable = true, complete = true,
                events = listOf(calendar, later),
            ))),
        )

        val events = state.allEvents()

        assertEquals(listOf("same", "later"), events.map { it.id })
        assertEquals("课程表", events.first().title)
    }

    @Test
    fun hidesEventsFromUnavailableCalendarSources() {
        val hidden = PlannerEvent("hidden", "旧日程", "event", "", 100L, 200L, false, "calendar")
        val state = AppUiState(calendar = CalendarState(listOf(CalendarSnapshot(
            sourceId = "phone:one", revision = 1, rangeStart = 0L, rangeEnd = 1_000L,
            fetchedAt = 0L, calendarAvailable = false, complete = false,
            events = listOf(hidden),
        ))))

        assertTrue(state.allEvents().isEmpty())
    }

    @Test
    fun buildsCalendarUploadWithSourceAndRevision() {
        val event = PlannerEvent("calendar-1", "高等数学", "event", "教学楼 301", 100L, 200L, false, "calendar")
        val payload = Models.calendarUploadJson(
            sourceId = "phone:one",
            requestId = "request-1",
            baseRevision = 4,
            rangeStart = 0L,
            rangeEnd = 1_000L,
            fetchedAt = 50L,
            calendarAvailable = true,
            complete = true,
            events = listOf(event),
        )

        assertEquals("phone:one", payload.getString("sourceId"))
        assertEquals("request-1", payload.getString("requestId"))
        assertEquals(4, payload.getInt("baseRevision"))
        assertTrue(payload.getBoolean("calendarAvailable"))
        assertEquals("calendar", payload.getJSONArray("events").getJSONObject(0).getString("source"))
        assertFalse(payload.has("revision"))
    }

    @Test
    fun cachesCalendarSourcesAndStatus() {
        val state = CalendarState(
            sources = listOf(CalendarSnapshot(
                sourceId = "phone:one", revision = 1, rangeStart = 0L, rangeEnd = 1_000L,
                fetchedAt = 50L, calendarAvailable = true, complete = true,
                events = listOf(PlannerEvent("calendar-1", "课程", "event", "", 100L, 200L, false, "calendar")),
            )),
            status = "已同步未来14天，共1条",
            lastSuccess = 60L,
        )

        val restored = Models.parseCalendarState(Models.calendarStateJson(state))

        assertEquals(state, restored)
    }
}
