package com.shunshou.collector

import org.json.JSONObject
import java.net.URI

data class PairingPayload(val url: String, val code: String, val expiresAt: Long) {
    companion object {
        private val codePattern = Regex("^[0-9a-f]{10}$")

        fun parse(raw: String, now: Long = System.currentTimeMillis()): PairingPayload? {
            val json = runCatching { JSONObject(raw) }.getOrNull() ?: return null
            if (json.optInt("v") != 1) return null
            val url = json.optString("u").trim().trimEnd('/')
            if (!url.startsWith("http://") && !url.startsWith("https://")) return null
            if (runCatching { URI(url).host }.getOrNull().isNullOrBlank()) return null
            val code = json.optString("c").trim().lowercase()
            if (!codePattern.matches(code)) return null
            val expiresAt = json.optLong("e", 0L)
            if (expiresAt <= now) return null
            return PairingPayload(url, code, expiresAt)
        }
    }
}
