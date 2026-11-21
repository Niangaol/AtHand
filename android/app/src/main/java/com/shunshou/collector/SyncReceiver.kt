package com.shunshou.collector

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class SyncReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != "com.shunshou.collector.SYNC") return
        val pending = goAsync()
        Thread {
            try {
                val prefs = context.getSharedPreferences("shunshou_probe", Context.MODE_PRIVATE)
                val url = SyncClient.urlOrDefault(prefs.getString("syncUrl", null))
                val password = prefs.getString("syncPassword", null).orEmpty()
                val samples = SampleStore.all()
                if (samples.isEmpty()) return@Thread
                val token = SyncSession.token(context, url, password)
                val response = SyncClient.upload(url, samples, token)
                Log.i("ShunshouProbe", "sync ok samples=${samples.size} response=${response.take(200)}")
            } catch (error: Exception) {
                Log.w("ShunshouProbe", "sync failed ${error.message}")
            } finally {
                pending.finish()
            }
        }.start()
    }
}
