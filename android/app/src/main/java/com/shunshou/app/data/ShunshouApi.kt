package com.shunshou.app.data

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val status: Int, message: String) : Exception(message)

data class AuthResult(val token: String, val expiresAt: Long, val user: UserSummary)

object ApiErrors {
    fun message(error: ApiException): String = when (error.status) {
        401 -> "账号或密码不对。"
        403 -> "服务地址不被允许，请稍后再试。"
        409 -> "数据在别处更新了，已为你刷新。"
        429 -> "尝试次数过多，请稍后再试。"
        in 500..599 -> "云端暂时不可用，请稍后再试。"
        else -> if (error.message.isNullOrBlank()) "请求失败，请重试。" else error.message!!
    }
}

class ShunshouApi(val baseUrl: String = SessionStore.DEFAULT_BASE) {
    private val origin = originOf(baseUrl)

    private fun request(
        method: String,
        path: String,
        token: String? = null,
        body: JSONObject? = null,
    ): JSONObject {
        val connection = URL(endpoint(baseUrl, path)).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("Accept", "application/json")
            // 云端网关按 Origin 校验，缺失或陌生直接 403。
            connection.setRequestProperty("Origin", origin)
            if (token != null) {
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("X-Shunshou-Session", token)
            }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                val message = runCatching { JSONObject(text).optString("message") }.getOrNull().orEmpty()
                throw ApiException(code, message)
            }
            if (text.isBlank()) JSONObject() else JSONObject(text)
        } catch (error: java.io.IOException) {
            throw ApiException(0, "网络不通，请检查网络后重试。")
        } finally {
            connection.disconnect()
        }
    }

    fun register(username: String, password: String): AuthResult {
        val body = request("POST", "/api/register", body = JSONObject()
            .put("username", username.trim()).put("password", password))
        return authOf(body, username.trim())
    }

    fun login(username: String, password: String): AuthResult {
        val body = request("POST", "/api/login", body = JSONObject()
            .put("username", username.trim()).put("password", password))
        return authOf(body, username.trim())
    }

    private fun authOf(body: JSONObject, fallbackName: String): AuthResult {
        val token = body.optString("token")
        val expiresAt = body.optLong("expiresAt")
        if (token.isBlank() || expiresAt <= 0L) throw ApiException(0, "登录响应异常，请重试。")
        val user = body.optJSONObject("user")
        return AuthResult(
            token = token,
            expiresAt = expiresAt,
            user = UserSummary(
                id = user?.optString("id").orEmpty(),
                username = user?.optString("username").orEmpty().ifBlank { fallbackName },
            ),
        )
    }

    fun me(token: String): UserSummary? {
        val body = request("GET", "/api/me", token)
        val user = body.optJSONObject("user") ?: return null
        return UserSummary(user.optString("id"), user.optString("username"))
    }

    fun logout(token: String) {
        runCatching { request("POST", "/api/logout", token) }
    }

    fun fetchLedger(token: String): Pair<LedgerState, String?> {
        val body = request("GET", "/api/ledger", token)
        return Models.parseLedger(body) to body.optStringOrNull("updatedAt")
    }

    fun putLedger(token: String, state: LedgerState, baseUpdatedAt: String?): String {
        val payload = JSONObject()
            .put("ledger", Models.ledgerJson(state))
            .put("baseUpdatedAt", baseUpdatedAt ?: JSONObject.NULL)
        val body = request("PUT", "/api/ledger", token, payload)
        return body.optString("updatedAt")
    }

    fun fetchPlanner(token: String): PlannerSnapshot =
        Models.parsePlanner(request("GET", "/api/planner", token))

    fun plannerOperation(
        token: String, operationId: String, baseRevision: Int, command: JSONObject,
    ): PlannerSnapshot {
        val payload = JSONObject()
            .put("operationId", operationId)
            .put("baseRevision", baseRevision)
            .put("command", command)
        val body = request("POST", "/api/planner/operations", token, payload)
        return Models.parsePlanner(body)
    }

    fun pushSamples(token: String, samples: JSONArray): Int =
        request("POST", "/api/samples", token, JSONObject().put("samples", samples))
            .optInt("added", 0)

    companion object {
        fun endpoint(baseUrl: String, path: String): String =
            baseUrl.trimEnd('/') + path

        fun originOf(baseUrl: String): String {
            val parsed = URL(baseUrl)
            return "${parsed.protocol}://${parsed.host}"
        }
    }
}
