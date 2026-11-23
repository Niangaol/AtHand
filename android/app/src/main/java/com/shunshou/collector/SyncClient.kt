package com.shunshou.collector

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class GatewaySession(val token: String, val expiresAt: Long)
class SyncHttpException(val status: Int) : IllegalStateException("同步失败 HTTP $status")
fun syncIdentity(baseUrl: String, password: String): String = java.security.MessageDigest.getInstance("SHA-256")
    .digest("${baseUrl.trim().trimEnd('/')}\n$password".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

object SyncClient {
    private const val DEFAULT_URL = "http://127.0.0.1:18787"

    fun urlOrDefault(value: String?): String =
        value?.trim()?.takeIf { it.startsWith("http://") || it.startsWith("https://") } ?: DEFAULT_URL

    fun health(baseUrl: String): String = request(baseUrl, "GET", null, null)

    fun login(baseUrl: String, password: String): GatewaySession {
        val base = urlOrDefault(baseUrl).trimEnd('/')
        val connection = URL("$base/api/login").openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 5_000
            connection.readTimeout = 10_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.outputStream.use { it.write(JSONObject().put("password", password).toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code == 401) throw IllegalStateException("访问口令不对")
            if (code == 429) throw IllegalStateException("尝试次数过多，请稍后再试")
            if (code !in 200..299) throw IllegalStateException("登录失败 HTTP $code")
            val body = JSONObject(text)
            val token = body.optString("token")
            val expiresAt = body.optLong("expiresAt")
            if (token.isBlank() || expiresAt <= 0L) throw IllegalStateException("登录响应异常")
            GatewaySession(token, expiresAt)
        } finally {
            connection.disconnect()
        }
    }

    fun pair(baseUrl: String, code: String): GatewaySession {
        val base = urlOrDefault(baseUrl).trimEnd('/')
        val connection = URL("$base/api/pair").openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 5_000
            connection.readTimeout = 10_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.outputStream.use { it.write(JSONObject().put("code", code).toString().toByteArray(Charsets.UTF_8)) }
            val httpCode = connection.responseCode
            val stream = if (httpCode in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (httpCode == 401) throw IllegalStateException("二维码已过期，请在电脑上刷新")
            if (httpCode == 429) throw IllegalStateException("尝试次数过多，请稍后再试")
            if (httpCode !in 200..299) throw IllegalStateException("配对失败 HTTP $httpCode")
            val body = JSONObject(text)
            val token = body.optString("token")
            val expiresAt = body.optLong("expiresAt")
            if (token.isBlank() || expiresAt <= 0L) throw IllegalStateException("配对响应异常")
            GatewaySession(token, expiresAt)
        } finally {
            connection.disconnect()
        }
    }

    fun samples(baseUrl: String, token: String): JSONObject = JSONObject(request(baseUrl, "GET", null, token, "/api/samples"))

    fun upload(baseUrl: String, samples: List<PaymentSample>, token: String?): String {
        val array = JSONArray()
        for (sample in samples) {
            array.put(JSONObject().apply {
                put("id", sample.id)
                put("packageName", sample.packageName)
                put("title", sample.title)
                put("text", sample.text)
                put("at", sample.at)
                put("amountCents", sample.amountCents ?: JSONObject.NULL)
                put("direction", sample.direction.name)
                put("merchant", sample.merchant)
                put("source", sample.source.name)
                put("note", sample.note)
            })
        }
        return request(baseUrl, "POST", array.toString(), token)
    }

    fun calendars(baseUrl: String, token: String): JSONObject = JSONObject(request(baseUrl, "GET", null, token, "/api/calendar"))

    fun uploadCalendar(baseUrl: String, token: String, body: String): JSONObject = JSONObject(request(baseUrl, "PUT", body, token, "/api/calendar/snapshot"))

    private fun request(baseUrl: String, method: String, body: String?, token: String?, path: String = if (method == "GET") "/api/health" else "/api/samples"): String {
        val base = urlOrDefault(baseUrl).trimEnd('/')
        val endpoint = URL("$base$path")
        val connection = endpoint.openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 5_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Accept", "application/json")
            if (!token.isNullOrBlank()) connection.setRequestProperty("Authorization", "Bearer ${token.trim()}")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw SyncHttpException(code)
            text
        } finally {
            connection.disconnect()
        }
    }
}

object SyncSession {
    private const val PREFS = "shunshou_probe"
    private const val PAIR_BASE = "syncTokenPairBase"

    fun savePaired(context: Context, baseUrl: String, session: GatewaySession) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("syncToken", session.token)
            .putLong("syncTokenExpires", session.expiresAt)
            .putString(PAIR_BASE, SyncClient.urlOrDefault(baseUrl).trimEnd('/'))
            .remove("syncTokenIdentity")
            .apply()
    }

    fun token(context: Context, baseUrl: String, password: String): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val base = SyncClient.urlOrDefault(baseUrl).trimEnd('/')
        val cached = prefs.getString("syncToken", null)
        val expiresAt = prefs.getLong("syncTokenExpires", 0L)
        val cachedValid = !cached.isNullOrBlank() && expiresAt > System.currentTimeMillis() + 60_000
        if (cachedValid && prefs.getString(PAIR_BASE, null) == base) return cached
        val identity = syncIdentity(base, password)
        if (cachedValid && prefs.getString("syncTokenIdentity", null) == identity) return cached
        if (password.isBlank()) {
            throw IllegalStateException(if (cached != null) "配对已过期，请重新扫码" else "请先填访问口令或扫码配对")
        }
        val session = SyncClient.login(base, password)
        prefs.edit()
            .putString("syncToken", session.token)
            .putLong("syncTokenExpires", session.expiresAt)
            .putString("syncTokenIdentity", identity)
            .remove(PAIR_BASE)
            .apply()
        return session.token
    }

    /** 网关换口令或重启后旧令牌会失效；清掉缓存，下次调用会重新登录或重新扫码。 */
    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove("syncToken").remove("syncTokenExpires").remove(PAIR_BASE).apply()
    }
}
