package com.shunshou.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type

@Composable
fun PageHeader(
    title: String,
    subtitle: String? = null,
    action: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text(title, style = Type.pageTitle)
            if (subtitle != null) Text(subtitle, style = Type.caption)
        }
        action?.invoke()
    }
    RuleLine()
}

@Composable
fun RuleLine() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Paper.rule))
}

@Composable
fun FigureText(text: String, style: TextStyle = Type.figure) {
    Text(text, style = style)
}

@Composable
fun EmptyHint(text: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 28.dp)) {
        Text(text, style = Type.caption)
    }
}

@Composable
fun MessageBar(
    message: String?,
    error: String?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val text = error ?: message ?: return
    Box(
        modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 8.dp)
            .background(if (error != null) Paper.redWash else Paper.brandWash, RoundedCornerShape(Dimens.rSm))
            .padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 4.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text,
                style = Type.caption.copy(color = if (error != null) Paper.red else Paper.brandDeep),
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("知道了", style = Type.caption)
            }
        }
    }
}
