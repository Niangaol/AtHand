package com.shunshou.app.data

import android.content.Context
import java.util.UUID

data class Session(
    val baseUrl: String,
    val token: String,
    val expiresAt: Long,
    val username: String,
)

class SessionStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("shunshou_app", Context.MODE_PRIVATE)

    fun load(): Session? {
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        val baseUrl = prefs.getString(KEY_BASE, null) ?: return null
        return Session(
            baseUrl = baseUrl,
            token = token,
            expiresAt = prefs.getLong(KEY_EXPIRES, 0L),
            username = prefs.getString(KEY_USERNAME, "").orEmpty(),
        )
    }

    fun save(session: Session) {
        prefs.edit()
            .putString(KEY_BASE, session.baseUrl)
            .putString(KEY_TOKEN, session.token)
            .putLong(KEY_EXPIRES, session.expiresAt)
            .putString(KEY_USERNAME, session.username)
            .apply()
    }

    fun clear() {
        prefs.edit().remove(KEY_BASE).remove(KEY_TOKEN).remove(KEY_EXPIRES).remove(KEY_USERNAME).apply()
    }

    fun isValid(): Boolean {
        val session = load() ?: return false
        return isValidAt(session.expiresAt, System.currentTimeMillis())
    }

    fun deviceId(): String {
        val existing = prefs.getString(KEY_DEVICE, null)
        if (existing != null) return existing
        val created = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE, created).apply()
        return created
    }

    fun cached(key: String): String? = prefs.getString("cache_$key", null)

    fun cache(key: String, json: String) {
        prefs.edit().putString("cache_$key", json).apply()
    }

    companion object {
        const val DEFAULT_BASE = "https://athand-qnvq63y722x.qoder.zone/functions/v1/app"
        private const val KEY_BASE = "base"
        private const val KEY_TOKEN = "token"
        private const val KEY_EXPIRES = "expiresAt"
        private const val KEY_USERNAME = "username"
        private const val KEY_DEVICE = "deviceId"
        private const val REFRESH_WINDOW_MS = 60_000L

        fun isValidAt(expiresAt: Long, now: Long): Boolean = expiresAt - now > REFRESH_WINDOW_MS
    }
}
