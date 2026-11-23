package com.shunshou.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object Paper {
    val page = Color(0xFFF2F3EE)
    val sheet = Color(0xFFFDFDF9)
    val rule = Color(0xFFE0E2D8)
    val ruleStrong = Color(0xFFC1C5B5)
    val ink = Color(0xFF1C1F1A)
    val inkSoft = Color(0xFF464C43)
    val muted = Color(0xFF666C60)
    val brand = Color(0xFF2F5A45)
    val brandDeep = Color(0xFF1F4030)
    val brandWash = Color(0x142F5A45)
    val red = Color(0xFF9E3B27)
    val redWash = Color(0x129E3B27)
    val steel = Color(0xFF4B6067)
}

private val scheme = lightColorScheme(
    primary = Paper.brand,
    onPrimary = Color.White,
    primaryContainer = Paper.brandWash,
    onPrimaryContainer = Paper.brandDeep,
    secondary = Paper.steel,
    onSecondary = Color.White,
    secondaryContainer = Paper.page,
    onSecondaryContainer = Paper.inkSoft,
    tertiary = Paper.red,
    onTertiary = Color.White,
    background = Paper.page,
    onBackground = Paper.ink,
    surface = Paper.sheet,
    onSurface = Paper.ink,
    surfaceVariant = Paper.page,
    onSurfaceVariant = Paper.inkSoft,
    surfaceContainer = Paper.sheet,
    surfaceContainerHigh = Paper.sheet,
    surfaceContainerHighest = Paper.sheet,
    surfaceContainerLow = Paper.page,
    surfaceContainerLowest = Paper.sheet,
    outline = Paper.ruleStrong,
    outlineVariant = Paper.rule,
    error = Paper.red,
    onError = Color.White,
    errorContainer = Paper.redWash,
    onErrorContainer = Paper.red,
    inverseSurface = Paper.ink,
    inverseOnSurface = Paper.sheet,
    scrim = Color(0xFF000000),
)

private val shapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(4.dp),
    medium = RoundedCornerShape(6.dp),
    large = RoundedCornerShape(8.dp),
    extraLarge = RoundedCornerShape(8.dp),
)

private val Serif = FontFamily.Serif
private val Sans = FontFamily.SansSerif

object Type {
    val pageTitle = TextStyle(fontFamily = Serif, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, lineHeight = 34.sp, color = Paper.ink)
    val sectionTitle = TextStyle(fontFamily = Sans, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, lineHeight = 24.sp, color = Paper.ink)
    val body = TextStyle(fontFamily = Sans, fontSize = 14.sp, fontWeight = FontWeight.Normal, lineHeight = 24.sp, color = Paper.ink)
    val caption = TextStyle(fontFamily = Sans, fontSize = 12.sp, fontWeight = FontWeight.Normal, lineHeight = 21.sp, color = Paper.muted)
    val figureLarge = TextStyle(fontFamily = Serif, fontSize = 38.sp, fontWeight = FontWeight.Medium, lineHeight = 50.sp, color = Paper.ink, fontFeatureSettings = "tnum")
    val figure = TextStyle(fontFamily = Serif, fontSize = 17.sp, fontWeight = FontWeight.Medium, lineHeight = 26.sp, color = Paper.ink, fontFeatureSettings = "tnum")
}

object Dimens {
    val gutter = 16.dp
    val rSm = 4.dp
    val rMd = 6.dp
    val rLg = 8.dp
}

@Composable
fun ShunshouTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, shapes = shapes, content = content)
}
