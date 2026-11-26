package com.shunshou.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
    Column {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween,
        ) {
            Column {
                Text(title, style = Type.pageTitle)
                if (subtitle != null) Text(subtitle, style = Type.journalNote)
            }
            action?.invoke()
        }
        TicketDivider(Modifier.padding(horizontal = Dimens.gutter))
    }
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
fun EmptyHint(text: String, modifier: Modifier = Modifier) {
    EmptyPaperHint(text, modifier)
}

@Composable
fun MessageBar(
    message: String?,
    error: String?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val text = error ?: message ?: return
    val shape = RoundedCornerShape(Dimens.rMd)
    Box(
        modifier.fillMaxWidth().padding(horizontal = Dimens.gutter, vertical = 8.dp)
            .background(if (error != null) Paper.redWash else Paper.brandWash, shape)
            .border(1.dp, if (error != null) Paper.red.copy(alpha = 0.25f) else Paper.sageDeep.copy(alpha = 0.35f), shape)
            .padding(start = 14.dp, top = 6.dp, bottom = 6.dp, end = 4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text,
                style = Type.journalNote.copy(color = if (error != null) Paper.red else Paper.brandDeep),
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("知道了", style = Type.caption)
            }
        }
    }
}
