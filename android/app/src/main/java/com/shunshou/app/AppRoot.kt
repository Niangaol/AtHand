package com.shunshou.app

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EventNote
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.shunshou.app.data.AppRepository
import com.shunshou.app.data.CalendarSyncWorker
import com.shunshou.app.ui.EntryScreen
import com.shunshou.app.ui.FocusScreen
import com.shunshou.app.ui.HomeScreen
import com.shunshou.app.ui.LedgerScreen
import com.shunshou.app.ui.LoginScreen
import com.shunshou.app.ui.MeScreen
import com.shunshou.app.ui.ScheduleScreen
import com.shunshou.app.ui.components.MessageBar
import com.shunshou.app.ui.motion.JournalMotionSpec
import com.shunshou.app.ui.motion.LocalJournalMotion
import com.shunshou.app.ui.motion.rememberJournalMotion
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
    val context = LocalContext.current
    val motion = rememberJournalMotion()
    LaunchedEffect(state.signedIn) {
        if (state.signedIn) {
            CalendarSyncWorker.schedule(context)
            CalendarSyncWorker.refresh(context)
        }
    }
    if (!state.signedIn) {
        CompositionLocalProvider(LocalJournalMotion provides motion) {
            LoginScreen(state, repository::signIn)
        }
        return
    }
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val current = entry?.destination?.route
    CompositionLocalProvider(LocalJournalMotion provides motion) {
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
                            icon = { JournalTabIcon(tab, current == tab.route, motion) },
                            label = { Text(tab.label, style = Type.caption) },
                            colors = NavigationBarItemDefaults.colors(
                                indicatorColor = Color.Transparent,
                                selectedIconColor = Paper.brand,
                                selectedTextColor = Paper.brand,
                                unselectedIconColor = Paper.muted,
                                unselectedTextColor = Paper.muted,
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            NavHost(
                nav,
                startDestination = Tab.Home.route,
                enterTransition = { tabEnter(motion) },
                exitTransition = { tabExit(motion) },
                popEnterTransition = { tabPopEnter(motion) },
                popExitTransition = { tabPopExit(motion) },
            ) {
                composable(
                    Tab.Home.route,
                    enterTransition = { tabEnter(motion) },
                    exitTransition = { tabExit(motion) },
                    popEnterTransition = { tabPopEnter(motion) },
                    popExitTransition = { tabPopExit(motion) },
                ) {
                    HomeScreen(state, onGoEntry = { nav.navigate("entry") }, onGoFocus = { nav.navigate("focus") })
                }
                composable(
                    Tab.Ledger.route,
                    enterTransition = { tabEnter(motion) },
                    exitTransition = { tabExit(motion) },
                    popEnterTransition = { tabPopEnter(motion) },
                    popExitTransition = { tabPopExit(motion) },
                ) { LedgerScreen(state, repository::deleteRecord) }
                composable(
                    Tab.Schedule.route,
                    enterTransition = { tabEnter(motion) },
                    exitTransition = { tabExit(motion) },
                    popEnterTransition = { tabPopEnter(motion) },
                    popExitTransition = { tabPopExit(motion) },
                ) { ScheduleScreen(state) }
                composable(
                    Tab.Me.route,
                    enterTransition = { tabEnter(motion) },
                    exitTransition = { tabExit(motion) },
                    popEnterTransition = { tabPopEnter(motion) },
                    popExitTransition = { tabPopExit(motion) },
                ) { MeScreen(state, repository::signOut, repository::refresh, repository::syncCalendar) }
                composable(
                    "entry",
                    enterTransition = { paperEnter(motion) },
                    exitTransition = { paperExit(motion) },
                    popEnterTransition = { paperPopEnter(motion) },
                    popExitTransition = { paperPopExit(motion) },
                ) {
                    EntryScreen(state, onSave = repository::addRecord, onBack = { nav.popBackStack() })
                }
                composable(
                    "focus",
                    enterTransition = { paperEnter(motion) },
                    exitTransition = { paperExit(motion) },
                    popEnterTransition = { paperPopEnter(motion) },
                    popExitTransition = { paperPopExit(motion) },
                ) {
                    FocusScreen(state, repository::startFocus, repository::controlFocus, onBack = { nav.popBackStack() })
                }
            }
            val messageDuration = if (motion.enterOffset == 0f) 90 else 180
            AnimatedVisibility(
                visible = state.message != null || state.error != null,
                enter = slideInVertically(tween(messageDuration)) { if (motion.enterOffset == 0f) 0 else it } + fadeIn(tween(messageDuration)),
                exit = slideOutVertically(tween(messageDuration)) { if (motion.enterOffset == 0f) 0 else it } + fadeOut(tween(messageDuration)),
                modifier = Modifier.align(Alignment.BottomCenter),
            ) {
                MessageBar(
                    state.message,
                    state.error,
                    repository::clearMessage,
                )
            }
        }
    }
    }
}

private fun tabEnter(spec: JournalMotionSpec): EnterTransition {
    if (spec.enterOffset == 0f) return EnterTransition.None
    return slideInHorizontally(tween(spec.pageDurationMillis, easing = FastOutSlowInEasing)) { (it * 0.1f).toInt() }
}

private fun tabExit(spec: JournalMotionSpec): ExitTransition = ExitTransition.None

private fun tabPopEnter(spec: JournalMotionSpec): EnterTransition = EnterTransition.None

private fun tabPopExit(spec: JournalMotionSpec): ExitTransition {
    if (spec.enterOffset == 0f) return ExitTransition.None
    return slideOutHorizontally(tween(spec.pageDurationMillis)) { (it * 0.1f).toInt() }
}

private fun paperEnter(spec: JournalMotionSpec): EnterTransition {
    if (spec.enterOffset == 0f) return EnterTransition.None
    return slideInVertically(tween(spec.pageDurationMillis, easing = FastOutSlowInEasing)) { (it * 0.06f).toInt() }
}

private fun paperExit(spec: JournalMotionSpec): ExitTransition = ExitTransition.None

private fun paperPopEnter(spec: JournalMotionSpec): EnterTransition = EnterTransition.None

private fun paperPopExit(spec: JournalMotionSpec): ExitTransition {
    if (spec.enterOffset == 0f) return ExitTransition.None
    return slideOutVertically(tween(spec.pageDurationMillis)) { (it * 0.06f).toInt() }
}

@Composable
private fun JournalTabIcon(tab: Tab, selected: Boolean, motion: JournalMotionSpec) {
    val density = LocalDensity.current
    val lift by animateFloatAsState(
        targetValue = if (selected) 1f else 0f,
        animationSpec = tween(motion.pageDurationMillis, easing = FastOutSlowInEasing),
        label = "journal-tab-lift",
    )
    val shape = RoundedCornerShape(5.dp)
    Box(
        Modifier.size(58.dp, 42.dp).graphicsLayer {
            translationY = with(density) { (-3).dp.toPx() } * lift
            scaleX = 0.96f + 0.04f * lift
            scaleY = 0.96f + 0.04f * lift
            shadowElevation = with(density) { (if (selected) 3f else 0f).dp.toPx() }
            this.shape = shape
        },
    ) {
        Box(
            Modifier.matchParentSize()
                .background(if (selected) Paper.kraftWash.copy(alpha = 0.72f) else Color.Transparent, shape)
                .border(1.dp, if (selected) Paper.paperEdge else Color.Transparent, shape),
        )
        Icon(tab.icon, contentDescription = tab.label, tint = if (selected) Paper.brand else Paper.muted, modifier = Modifier.align(Alignment.Center))
        if (selected) {
            Box(
                Modifier.align(Alignment.TopCenter)
                    .offset(y = (-6).dp)
                    .width(34.dp)
                    .height(8.dp)
                    .background(Paper.tape.copy(alpha = 0.82f), RoundedCornerShape(1.dp)),
            )
        }
    }
}
