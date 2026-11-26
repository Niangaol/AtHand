package com.shunshou.app.ui.motion

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

val LocalJournalMotion = staticCompositionLocalOf { JournalMotionSpec.resolve(false) }

@Composable
fun rememberJournalMotion(): JournalMotionSpec {
    val context = LocalContext.current
    val resolver = context.contentResolver
    var durationScale by remember {
        mutableFloatStateOf(Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f))
    }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                durationScale = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
            }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return JournalMotionSpec.resolve(JournalMotionSpec.isReducedMotion(durationScale))
}

@Composable
fun Modifier.journalEntrance(index: Int = 0, spec: JournalMotionSpec): Modifier {
    val density = LocalDensity.current
    var visible by remember { mutableStateOf(spec.enterOffset == 0f) }
    LaunchedEffect(index, spec) {
        if (spec.staggerDelayMillis > 0) {
            delay((index * spec.staggerDelayMillis).coerceAtMost(140).toLong())
        }
        visible = true
    }
    val progress by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = tween(spec.enterDurationMillis, easing = androidx.compose.animation.core.FastOutSlowInEasing),
        label = "journal-entrance",
    )
    val unsettled = if (spec.enterOffset == 0f) 0f else 1f - progress
    return graphicsLayer {
        translationY = unsettled * with(density) { spec.enterOffset.dp.toPx() }
        scaleX = 1f - 0.015f * unsettled
        scaleY = 1f - 0.015f * unsettled
        rotationZ = unsettled * spec.enterRotation
    }
}

@Composable
fun Modifier.journalPress(
    interactionSource: MutableInteractionSource,
    spec: JournalMotionSpec,
    shape: Shape,
    restingElevation: Dp = 3.dp,
): Modifier {
    val pressed by interactionSource.collectIsPressedAsState()
    val density = LocalDensity.current
    val feedback: AnimationSpec<Float> = when {
        spec.pressDurationMillis == 0 -> snap()
        pressed -> tween(spec.pressDurationMillis)
        else -> spring(dampingRatio = 0.72f, stiffness = 520f)
    }
    val progress by animateFloatAsState(
        targetValue = if (pressed) 1f else 0f,
        animationSpec = feedback,
        label = "journal-press",
    )
    val elevation = if (pressed) 0.4f else restingElevation.value
    return graphicsLayer {
        scaleX = 1f - (1f - spec.pressedScale) * progress
        scaleY = 1f - (1f - spec.pressedScale) * progress
        translationY = with(density) { spec.pressedOffset.dp.toPx() } * progress
        shadowElevation = with(density) { elevation.dp.toPx() }
        this.shape = shape
        clip = false
    }
}
