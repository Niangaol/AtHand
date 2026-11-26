package com.shunshou.app.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type
import com.shunshou.app.ui.motion.LocalJournalMotion
import com.shunshou.app.ui.motion.journalPress

enum class PaperPattern { Grid, Dots, Plain }

fun Modifier.journalPaper(pattern: PaperPattern = PaperPattern.Grid): Modifier = drawBehind {
    drawRect(Paper.page)
    if (pattern == PaperPattern.Plain) return@drawBehind
    val spacing = 24.dp.toPx()
    if (pattern == PaperPattern.Grid) {
        var x = spacing
        while (x < size.width) {
            drawLine(
                Paper.grid,
                Offset(x, 0f),
                Offset(x, size.height),
                strokeWidth = 0.7.dp.toPx(),
                cap = StrokeCap.Round,
            )
            x += spacing
        }
        var y = spacing
        while (y < size.height) {
            drawLine(
                Paper.grid,
                Offset(0f, y),
                Offset(size.width, y),
                strokeWidth = 0.7.dp.toPx(),
                cap = StrokeCap.Round,
            )
            y += spacing
        }
    } else {
        val radius = 0.9.dp.toPx()
        var y = spacing
        while (y < size.height) {
            var x = spacing
            while (x < size.width) {
                drawCircle(Paper.grid, radius, Offset(x, y))
                x += spacing
            }
            y += spacing
        }
    }
}

@Composable
fun PaperNote(
    modifier: Modifier = Modifier,
    tapeColor: Color = Paper.tape,
    content: @Composable ColumnScope.() -> Unit,
) {
    StackedPaperNote(modifier, tapeColor, content)
}

@Composable
fun WashiTape(
    color: Color,
    modifier: Modifier = Modifier,
) {
    MaterialWashiTape(color, modifier)
}

@Composable
fun TicketDivider(modifier: Modifier = Modifier) {
    Canvas(modifier.fillMaxWidth().height(14.dp)) {
        val y = size.height / 2
        val inset = 10.dp.toPx()
        drawLine(
            color = Paper.ruleStrong,
            start = Offset(inset, y),
            end = Offset(size.width - inset, y),
            strokeWidth = 1.dp.toPx(),
            cap = StrokeCap.Round,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 5.dp.toPx())),
        )
        drawCircle(Paper.page, 7.dp.toPx(), Offset(0f, y))
        drawCircle(Paper.page, 7.dp.toPx(), Offset(size.width, y))
    }
}

@Composable
fun SectionHeading(
    text: String,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(width = 4.dp, height = 18.dp)
                .background(Paper.red, RoundedCornerShape(2.dp)),
        )
        Text(
            text,
            style = Type.sectionTitle,
            modifier = Modifier.padding(start = 9.dp).weight(1f),
        )
        trailing?.invoke()
    }
}

@Composable
fun PaperQuickAction(
    title: String,
    hint: String,
    icon: ImageVector,
    tapeColor: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(Dimens.rMd)
    val interactionSource = remember { MutableInteractionSource() }
    val motion = LocalJournalMotion.current
    val pressed by interactionSource.collectIsPressedAsState()
    val tapeOffset by animateDpAsState(if (pressed) 1.dp else 0.dp, label = "quick-action-tape")
    Box(
        modifier.heightIn(min = 138.dp)
            .journalPress(interactionSource, motion, shape, restingElevation = 4.dp),
    ) {
        Box(
            Modifier.matchParentSize()
                .offset(y = 6.dp)
                .background(Paper.paperEdgeDark, shape),
        )
        Box(
            Modifier.matchParentSize()
                .background(Paper.sheet, shape)
                .border(1.dp, Paper.rule, shape)
                .clickable(interactionSource = interactionSource, indication = null, onClick = onClick)
                .padding(horizontal = 14.dp, vertical = 16.dp),
        ) {
            Column(Modifier.fillMaxWidth()) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = Paper.brand,
                    modifier = Modifier.size(25.dp),
                )
                Spacer(Modifier.height(12.dp))
                Text(title, style = Type.sectionTitle)
                Text(hint, style = Type.caption, modifier = Modifier.padding(top = 2.dp))
            }
            MaterialWashiTape(
                color = tapeColor,
                rotation = 1.2f,
                modifier = Modifier.align(Alignment.TopEnd).offset(x = (-4).dp, y = (-11).dp + tapeOffset),
            )
        }
    }
}

@Composable
fun EmptyPaperHint(
    text: String,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit = {},
) {
    val shape = RoundedCornerShape(2.dp)
    Box(
        modifier.fillMaxWidth()
            .shadow(3.dp, shape, ambientColor = Paper.shadow, spotColor = Paper.shadow)
            .background(Paper.kraftWash.copy(alpha = 0.62f), shape)
            .border(1.dp, Paper.rule, shape)
            .drawBehind {
                val dash = floatArrayOf(4.dp.toPx(), 4.dp.toPx())
                drawLine(
                    Paper.ruleStrong.copy(alpha = 0.38f),
                    Offset(10.dp.toPx(), 8.dp.toPx()),
                    Offset(size.width - 10.dp.toPx(), 8.dp.toPx()),
                    strokeWidth = 0.8.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(dash),
                )
                drawLine(
                    Paper.ruleStrong.copy(alpha = 0.28f),
                    Offset(0f, 0f),
                    Offset(size.width / 2f, size.height * 0.24f),
                    strokeWidth = 0.8.dp.toPx(),
                )
                drawLine(
                    Paper.ruleStrong.copy(alpha = 0.28f),
                    Offset(size.width, 0f),
                    Offset(size.width / 2f, size.height * 0.24f),
                    strokeWidth = 0.8.dp.toPx(),
                )
            }
            .padding(horizontal = 16.dp, vertical = 20.dp),
    ) {
        Text(text, style = Type.journalNote, modifier = Modifier.padding(end = 36.dp))
        content()
    }
}
