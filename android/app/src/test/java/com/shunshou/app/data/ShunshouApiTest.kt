package com.shunshou.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ServerSocket

class ShunshouApiTest {
    @Test
    fun mapsErrorCodesToChineseMessages() {
        assertEquals("账号或密码不对。", ApiErrors.message(ApiException(401, "")))
        assertEquals("服务地址不被允许，请稍后再试。", ApiErrors.message(ApiException(403, "")))
        assertEquals("数据在别处更新了，已为你刷新。", ApiErrors.message(ApiException(409, "")))
        assertEquals("云端暂时不可用，请稍后再试。", ApiErrors.message(ApiException(503, "")))
    }

    @Test
    fun joinsBaseUrlAndPath() {
        assertEquals(
            "https://example.com/functions/v1/app/api/login",
            ShunshouApi.endpoint("https://example.com/functions/v1/app/", "/api/login"),
        )
    }

    @Test
    fun keepsOriginFromBaseUrl() {
        assertEquals(
            "https://athand-qnvq63y722x.qoder.zone",
            ShunshouApi.originOf(SessionStore.DEFAULT_BASE),
        )
    }

    @Test
    fun fetchesCalendarWithSessionHeaders() {
        var method = ""
        var session = ""
        val server = serve(
            """{"serverId":"server-1","sources":[{"sourceId":"phone:one","revision":1,"rangeStart":0,"rangeEnd":1000,"fetchedAt":10,"calendarAvailable":true,"complete":true,"events":[]}]}""",
        ) { requestMethod, headers, _ ->
            method = requestMethod
            session = headers["x-shunshou-session"].orEmpty()
        }
        try {
            val api = ShunshouApi("http://127.0.0.1:${server.localPort}")
            val sources = api.fetchCalendar("token-1")
            assertEquals("GET", method)
            assertEquals("token-1", session)
            assertEquals("phone:one", sources.single().sourceId)
        } finally {
            server.close()
        }
    }

    @Test
    fun uploadsCalendarSnapshotWithPutAndParsesResponse() {
        var method = ""
        var request = ""
        val server = serve(
            """{"sourceId":"phone:one","revision":2,"rangeStart":0,"rangeEnd":1000,"fetchedAt":10,"calendarAvailable":true,"complete":true,"events":[]}""",
        ) { requestMethod, _, body ->
            method = requestMethod
            request = body
        }
        try {
            val api = ShunshouApi("http://127.0.0.1:${server.localPort}")
            val payload = org.json.JSONObject().put("sourceId", "phone:one")
            val snapshot = api.uploadCalendarSnapshot("token-1", payload)
            assertEquals("PUT", method)
            assertTrue(request.contains("phone:one"))
            assertEquals(2, snapshot.revision)
        } finally {
            server.close()
        }
    }

    private fun serve(
        response: String,
        handle: (method: String, headers: Map<String, String>, body: String) -> Unit,
    ): ServerSocket {
        val server = ServerSocket(0)
        Thread {
            server.accept().use { socket ->
                val input = socket.getInputStream().bufferedReader()
                val requestLine = input.readLine().orEmpty()
                val headers = mutableMapOf<String, String>()
                while (true) {
                    val line = input.readLine() ?: break
                    if (line.isEmpty()) break
                    val parts = line.split(':', limit = 2)
                    if (parts.size == 2) headers[parts[0].trim().lowercase()] = parts[1].trim()
                }
                val length = headers["content-length"]?.toIntOrNull() ?: 0
                val body = CharArray(length)
                var read = 0
                while (read < length) {
                    val count = input.read(body, read, length - read)
                    if (count < 0) break
                    read += count
                }
                handle(requestLine.substringBefore(' '), headers, String(body, 0, read))
                val bytes = response.toByteArray()
                val output = socket.getOutputStream()
                output.write(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray(),
                )
                output.write(bytes)
                output.flush()
            }
        }.apply { isDaemon = true; start() }
        return server
    }
}
