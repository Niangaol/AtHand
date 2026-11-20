package com.shunshou.collector

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import kotlin.math.abs

object SampleStore {
    private const val PREFS = "shunshou_probe"
    private const val KEY = "samples"
    private const val MAX = 30
    private val items = mutableListOf<PaymentSample>()
    var listener: (() -> Unit)? = null

    fun all(): List<PaymentSample> = synchronized(items) { items.toList() }

    fun load(context: Context) {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return
        synchronized(items) {
            items.clear()
            runCatching {
                val array = JSONArray(raw)
                for (index in 0 until array.length()) {
                    val item = array.getJSONObject(index)
                    items.add(
                        PaymentSample(
                            id = item.getString("id"),
                            packageName = item.getString("packageName"),
                            title = item.optString("title"),
                            text = item.optString("text"),
                            at = item.getLong("at"),
                            amountCents = if (item.isNull("amountCents")) null else item.getLong("amountCents"),
                            direction = Direction.valueOf(item.getString("direction")),
                            merchant = item.optString("merchant"),
                            source = Source.valueOf(item.getString("source")),
                            note = item.optString("note"),
                        )
                    )
                }
            }.onFailure { items.clear() }
        }
    }

    fun add(context: Context, sample: PaymentSample) {
        synchronized(items) {
            val duplicate = items.any {
                it.packageName == sample.packageName && it.title == sample.title &&
                    it.text == sample.text && abs(it.at - sample.at) < 60_000
            }
            if (duplicate) return
            items.add(0, sample.copy(id = sample.id.ifEmpty { UUID.randomUUID().toString() }))
            while (items.size > MAX) items.removeAt(items.lastIndex)
            persist(context)
        }
        listener?.invoke()
    }

    fun clear(context: Context) {
        synchronized(items) {
            items.clear()
            persist(context)
        }
        listener?.invoke()
    }

    private fun persist(context: Context) {
        val array = JSONArray()
        for (item in items) {
            array.put(JSONObject().apply {
                put("id", item.id)
                put("packageName", item.packageName)
                put("title", item.title)
                put("text", item.text)
                put("at", item.at)
                put("amountCents", item.amountCents ?: JSONObject.NULL)
                put("direction", item.direction.name)
                put("merchant", item.merchant)
                put("source", item.source.name)
                put("note", item.note)
            })
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, array.toString()).apply()
    }
}
