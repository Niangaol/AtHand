package com.shunshou.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import com.shunshou.app.data.AppRepository
import com.shunshou.app.data.CalendarSyncWorker
import com.shunshou.app.data.SessionStore
import com.shunshou.app.data.ShunshouApi
import com.shunshou.app.ui.theme.ShunshouTheme

class MainActivity : ComponentActivity() {
    private lateinit var store: SessionStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SessionStore(this)
        val repository = AppRepository(ShunshouApi(), store, applicationContext, lifecycleScope)
        CalendarSyncWorker.schedule(this)
        if (store.isValid()) {
            repository.refresh()
            CalendarSyncWorker.refresh(this)
        }
        setContent { ShunshouTheme { AppRoot(repository) } }
    }

    override fun onResume() {
        super.onResume()
        if (::store.isInitialized && store.isValid()) CalendarSyncWorker.refresh(this)
    }
}
