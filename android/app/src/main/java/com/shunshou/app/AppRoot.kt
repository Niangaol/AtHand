package com.shunshou.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EventNote
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.shunshou.app.data.AppRepository
import com.shunshou.app.ui.EntryScreen
import com.shunshou.app.ui.FocusScreen
import com.shunshou.app.ui.HomeScreen
import com.shunshou.app.ui.LedgerScreen
import com.shunshou.app.ui.LoginScreen
import com.shunshou.app.ui.MeScreen
import com.shunshou.app.ui.ScheduleScreen
import com.shunshou.app.ui.components.MessageBar
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type

enum class Tab(val route: String, val label: String, val icon: ImageVector) {
    Home("home", "首页", Icons.Outlined.Home),
    Ledger("ledger", "账本", Icons.Outlined.Receipt),
    Schedule("schedule", "日程", Icons.Outlined.EventNote),
    Me("me", "我的", Icons.Outlined.Person),
}

@Composable
fun AppRoot(repository: AppRepository) {
    val state by repository.state.collectAsStateWithLifecycle()
    if (!state.signedIn) {
        LoginScreen(state, repository::signIn)
        return
    }
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val current = entry?.destination?.route
    Scaffold(
        containerColor = Paper.page,
        bottomBar = {
            if (Tab.entries.any { it.route == current }) {
                NavigationBar(containerColor = Paper.sheet, contentColor = Paper.ink) {
                    Tab.entries.forEach { tab ->
                        NavigationBarItem(
                            selected = current == tab.route,
                            onClick = {
                                nav.navigate(tab.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label, style = Type.caption) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            NavHost(nav, startDestination = Tab.Home.route) {
                composable(Tab.Home.route) {
                    HomeScreen(state, onGoEntry = { nav.navigate("entry") }, onGoFocus = { nav.navigate("focus") })
                }
                composable(Tab.Ledger.route) { LedgerScreen(state, repository::deleteRecord) }
                composable(Tab.Schedule.route) { ScheduleScreen(state) }
                composable(Tab.Me.route) { MeScreen(state, repository::signOut, repository::refresh) }
                composable("entry") {
                    EntryScreen(state, onSave = repository::addRecord, onBack = { nav.popBackStack() })
                }
                composable("focus") {
                    FocusScreen(state, repository::startFocus, repository::controlFocus, onBack = { nav.popBackStack() })
                }
            }
            MessageBar(state.message, state.error, repository::clearMessage)
        }
    }
}
