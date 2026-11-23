package com.shunshou.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import com.shunshou.app.data.AppRepository
import com.shunshou.app.data.SessionStore
import com.shunshou.app.data.ShunshouApi
import com.shunshou.app.ui.theme.ShunshouTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SessionStore(this)
        val repository = AppRepository(ShunshouApi(), store, lifecycleScope)
        if (store.isValid()) repository.refresh()
        setContent { ShunshouTheme { AppRoot(repository) } }
    }
}
