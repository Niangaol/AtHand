package com.shunshou.collector

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

class CalendarWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = if (CalendarSync.sync(applicationContext, inputData.getBoolean("force", false))) Result.success() else if (runAttemptCount < 3) Result.retry() else Result.failure()

    companion object {
        private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        fun schedule(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("calendar-daily", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<CalendarWorker>(24, TimeUnit.HOURS).setConstraints(constraints).build())
        }
        fun refresh(context: Context, force: Boolean = false) {
            val work = OneTimeWorkRequestBuilder<CalendarWorker>().setConstraints(constraints)
                .setInputData(androidx.work.workDataOf("force" to force)).build()
            WorkManager.getInstance(context).enqueueUniqueWork("calendar-refresh", ExistingWorkPolicy.KEEP, work)
        }
    }
}
