package com.shunshou.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shunshou.collector.R

object Paper {
    val desk = Color(0xFFE8DFD0)
    val page = Color(0xFFF7F3EA)
    val sheet = Color(0xFFFFFDF7)
    val sheetHighlight = Color(0xFFFFFFFF)
    val paperEdge = Color(0xFFD9CCB9)
    val paperEdgeDark = Color(0xFFC3B49D)
    val shadow = Color(0x55382F25)
    val fiber = Color(0x22A89A84)
    val grid = Color(0xFFE9E2D5)
    val rule = Color(0xFFDED7C8)
    val ruleStrong = Color(0xFFBDB4A3)
    val margin = Color(0xFFD6A198)
    val thread = Color(0xFF8D7B62)
    val ink = Color(0xFF26251F)
    val inkSoft = Color(0xFF4F4B40)
    val muted = Color(0xFF787164)
    val brand = Color(0xFF365B46)
    val brandDeep = Color(0xFF254532)
    val brandWash = Color(0xFFE4EDE2)
    val sage = Color(0xFFD8E4D2)
    val sageDeep = Color(0xFF758B70)
    val red = Color(0xFFA34832)
    val redWash = Color(0xFFF2E1D9)
    val steel = Color(0xFF52666B)
    val kraft = Color(0xFFD8C3A5)
    val kraftWash = Color(0xFFF0E4D2)
    val tape = Color(0xFFE8D68F)
    val tapeGreen = Color(0xFFCAD9BC)
    val tapeFiber = Color(0x66FFF9DD)
    val blush = Color(0xFFF0DCD2)
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

private val Journal = FontFamily(Font(R.font.lxgw_wenkai_regular))
private val Serif = FontFamily.Serif
private val Sans = FontFamily.SansSerif

object Type {
    val pageTitle = TextStyle(fontFamily = Journal, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, lineHeight = 36.sp, color = Paper.ink)
    val sectionTitle = TextStyle(fontFamily = Journal, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, lineHeight = 26.sp, color = Paper.ink)
    val body = TextStyle(fontFamily = Sans, fontSize = 14.sp, fontWeight = FontWeight.Normal, lineHeight = 24.sp, color = Paper.ink)
    val caption = TextStyle(fontFamily = Sans, fontSize = 12.sp, fontWeight = FontWeight.Normal, lineHeight = 21.sp, color = Paper.muted)
    val journalNote = TextStyle(fontFamily = Journal, fontSize = 13.sp, fontWeight = FontWeight.Normal, lineHeight = 21.sp, color = Paper.inkSoft)
    val figureLarge = TextStyle(fontFamily = Serif, fontSize = 40.sp, fontWeight = FontWeight.Medium, lineHeight = 52.sp, color = Paper.ink, fontFeatureSettings = "tnum")
    val figure = TextStyle(fontFamily = Serif, fontSize = 18.sp, fontWeight = FontWeight.Medium, lineHeight = 28.sp, color = Paper.ink, fontFeatureSettings = "tnum")
}

object Dimens {
    val gutter = 34.dp
    val sectionGap = 22.dp
    val paperPadding = 18.dp
    val rSm = 4.dp
    val rMd = 6.dp
    val rLg = 8.dp
}

@Composable
fun ShunshouTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, shapes = shapes, content = content)
}
