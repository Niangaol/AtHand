package com.shunshou.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.dp
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper

fun Modifier.journalPage(): Modifier = drawBehind {
    drawRect(Brush.verticalGradient(listOf(Paper.desk, Paper.kraftWash.copy(alpha = 0.55f))))
    val left = 9.dp.toPx()
    val right = 7.dp.toPx()
    val paperWidth = size.width - left - right
    drawRect(Paper.page, topLeft = Offset(left, 0f), size = Size(paperWidth, size.height))

    for (i in 0 until 46) {
        val x = left + ((i * 47) % 101) / 101f * paperWidth
        val y = ((i * 71) % 137) / 137f * size.height
        val length = (2.5f + (i % 4)) * density
        drawLine(Paper.fiber, Offset(x, y), Offset(x + length, y + density), strokeWidth = 0.65f * density)
    }

    val edge = Path().apply {
        moveTo(size.width - right, 0f)
        for (i in 1..24) {
            val y = size.height * i / 24f
            val wobble = if (i % 2 == 0) 0.45f * density else -0.25f * density
            lineTo(size.width - right + wobble, y)
        }
    }
    drawPath(edge, Paper.paperEdgeDark, style = Stroke(width = 0.9f * density, cap = StrokeCap.Round))
    drawLine(Paper.shadow, Offset(size.width - right + 1.dp.toPx(), 0f), Offset(size.width - right + 1.dp.toPx(), size.height), strokeWidth = 2.dp.toPx())

    val bindingX = 7.dp.toPx()
    val firstHole = 82.dp.toPx()
    val lastHole = size.height - 72.dp.toPx()
    drawLine(Paper.thread, Offset(bindingX, firstHole), Offset(bindingX, lastHole), strokeWidth = 1.1.dp.toPx())
    var holeY = firstHole
    while (holeY <= lastHole) {
        drawCircle(Paper.paperEdgeDark, 4.6.dp.toPx(), Offset(bindingX, holeY))
        drawCircle(Paper.desk, 3.1.dp.toPx(), Offset(bindingX, holeY))
        drawCircle(Paper.sheetHighlight.copy(alpha = 0.65f), 0.8.dp.toPx(), Offset(bindingX - 1.dp.toPx(), holeY - 1.2.dp.toPx()))
        holeY += 108.dp.toPx()
    }

    drawLine(Paper.margin.copy(alpha = 0.42f), Offset(25.dp.toPx(), 0f), Offset(25.dp.toPx(), size.height), strokeWidth = 0.8.dp.toPx())
}

@Composable
fun MaterialWashiTape(
    color: Color,
    modifier: Modifier = Modifier,
    rotation: Float = -1.4f,
) {
    val edgeColor = lerp(color, Paper.ink, 0.16f)
    Box(modifier.rotate(rotation)) {
        Canvas(Modifier.width(88.dp).height(27.dp)) {
            val path = Path().apply {
                moveTo(2.dp.toPx(), 1.dp.toPx())
                lineTo(size.width - 2.dp.toPx(), 0f)
                lineTo(size.width, 5.dp.toPx())
                lineTo(size.width - 2.dp.toPx(), 9.dp.toPx())
                lineTo(size.width, 14.dp.toPx())
                lineTo(size.width - 2.dp.toPx(), 19.dp.toPx())
                lineTo(size.width, 24.dp.toPx())
                lineTo(size.width - 3.dp.toPx(), size.height)
                lineTo(3.dp.toPx(), size.height - 1.dp.toPx())
                lineTo(0f, 22.dp.toPx())
                lineTo(2.dp.toPx(), 17.dp.toPx())
                lineTo(0f, 12.dp.toPx())
                lineTo(2.dp.toPx(), 7.dp.toPx())
                close()
            }
            val shadowOffset = 2.dp.toPx()
            withTransform({ translate(0f, shadowOffset) }) {
                drawPath(path, Paper.shadow)
            }
            drawPath(path, color.copy(alpha = 0.82f))
            clipPath(path) {
                for (i in 0 until 9) {
                    val y = (i + 1) * 3.dp.toPx()
                    drawLine(Paper.tapeFiber, Offset(4.dp.toPx(), y), Offset(size.width - 4.dp.toPx(), y - 4.dp.toPx()), strokeWidth = 0.7.dp.toPx())
                }
                drawLine(Paper.sheetHighlight.copy(alpha = 0.32f), Offset(3.dp.toPx(), 2.dp.toPx()), Offset(size.width - 3.dp.toPx(), 1.dp.toPx()), strokeWidth = 1.dp.toPx())
            }
            drawPath(path, edgeColor.copy(alpha = 0.38f), style = Stroke(width = 0.7.dp.toPx()))
        }
    }
}

@Composable
fun StackedPaperNote(
    modifier: Modifier = Modifier,
    tapeColor: Color = Paper.tape,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(3.dp)
    Box(modifier) {
        Box(
            Modifier.matchParentSize()
                .offset(x = 8.dp, y = 14.dp)
                .background(Paper.shadow.copy(alpha = 0.08f), shape),
        )
        Box(
            Modifier.matchParentSize()
                .offset(x = 6.dp, y = 11.dp)
                .background(Paper.shadow.copy(alpha = 0.12f), shape),
        )
        Box(
            Modifier.matchParentSize()
                .offset(x = 5.dp, y = 9.dp)
                .background(Paper.paperEdgeDark, shape),
        )
        Box(
            Modifier.matchParentSize()
                .offset(x = 3.dp, y = 5.dp)
                .background(Paper.paperEdge, shape),
        )
        Column(
            Modifier.fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Paper.sheetHighlight, Paper.sheet)), shape)
                .border(1.dp, Paper.rule, shape)
                .drawBehind {
                    var y = 26.dp.toPx()
                    while (y < size.height) {
                        drawLine(Paper.rule.copy(alpha = 0.36f), Offset(0f, y), Offset(size.width, y), strokeWidth = 0.6.dp.toPx())
                        y += 28.dp.toPx()
                    }
                    for (i in 0 until 22) {
                        val x = ((i * 43) % 97) / 97f * size.width
                        val fiberY = ((i * 61) % 89) / 89f * size.height
                        drawLine(Paper.fiber, Offset(x, fiberY), Offset(x + 3.dp.toPx(), fiberY + 0.5.dp.toPx()), strokeWidth = 0.6.dp.toPx())
                    }
                }
                .padding(Dimens.paperPadding),
            content = content,
        )
        Canvas(Modifier.matchParentSize()) {
            val fold = 19.dp.toPx()
            val path = Path().apply {
                moveTo(size.width - fold, 0f)
                lineTo(size.width, fold)
                lineTo(size.width, 0f)
                close()
            }
            drawPath(path, Paper.kraftWash)
            drawPath(path, Paper.paperEdge, style = Stroke(width = 0.8.dp.toPx()))
            drawLine(Paper.sheetHighlight, Offset(size.width - fold, 0f), Offset(size.width, fold), strokeWidth = 1.dp.toPx())
        }
        MaterialWashiTape(
            color = tapeColor,
            modifier = Modifier.align(Alignment.TopCenter).offset(y = (-11).dp),
        )
    }
}
