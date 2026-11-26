package com.shunshou.app.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

object CalendarSyncPreferences {
    private const val PREFS = "shunshou_app_calendar"
    private const val KEY_ENABLED = "autoEnabled"

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, true)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_ENABLED, enabled).apply()
    }
}

class CalendarSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        if (!CalendarSyncPreferences.isEnabled(applicationContext)) return Result.success()
        val store = SessionStore(applicationContext)
        if (!store.isValid()) return Result.success()
        val result = CloudCalendarSync.sync(applicationContext, store, ShunshouApi(store.load()!!.baseUrl))
        return when {
            result.success -> Result.success()
            runAttemptCount < 3 -> Result.retry()
            else -> Result.failure()
        }
    }

    companion object {
        private const val PERIODIC = "calendar-cloud-periodic"
        private const val REFRESH = "calendar-cloud-refresh"
        private val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        fun schedule(context: Context) {
            if (!CalendarSyncPreferences.isEnabled(context)) return
            val work = WorkManager.getInstance(context)
            work.cancelUniqueWork("calendar-daily")
            work.enqueueUniquePeriodicWork(
                PERIODIC,
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<CalendarSyncWorker>(6, TimeUnit.HOURS)
                    .setConstraints(constraints)
                    .build(),
            )
        }

        fun refresh(context: Context) {
            if (!CalendarSyncPreferences.isEnabled(context)) return
            WorkManager.getInstance(context).enqueueUniqueWork(
                REFRESH,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<CalendarSyncWorker>()
                    .setConstraints(constraints)
                    .build(),
            )
        }

        fun setEnabled(context: Context, enabled: Boolean) {
            CalendarSyncPreferences.setEnabled(context, enabled)
            val work = WorkManager.getInstance(context)
            if (enabled) {
                schedule(context)
                refresh(context)
            } else {
                work.cancelUniqueWork(PERIODIC)
                work.cancelUniqueWork(REFRESH)
            }
        }
    }
}
