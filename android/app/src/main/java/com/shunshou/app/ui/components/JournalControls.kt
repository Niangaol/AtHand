package com.shunshou.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.shunshou.app.ui.motion.LocalJournalMotion
import com.shunshou.app.ui.motion.journalPress
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type

@Composable
fun JournalPage(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier.fillMaxSize()
            .journalPage()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 24.dp),
        content = content,
    )
}

@Composable
fun PaperTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    isError: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label, style = Type.caption) },
        singleLine = singleLine,
        isError = isError,
        keyboardOptions = keyboardOptions,
        visualTransformation = visualTransformation,
        shape = RoundedCornerShape(3.dp),
        modifier = modifier.fillMaxWidth().heightIn(min = 56.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = Paper.sheet,
            unfocusedContainerColor = Paper.sheet,
            errorContainerColor = Paper.redWash.copy(alpha = 0.35f),
            focusedBorderColor = Paper.brand,
            unfocusedBorderColor = Paper.ruleStrong,
            errorBorderColor = Paper.red,
            focusedLabelColor = Paper.brand,
            unfocusedLabelColor = Paper.muted,
            cursorColor = Paper.brand,
        ),
    )
}

@Composable
fun PaperPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().heightIn(min = 52.dp),
        shape = RoundedCornerShape(4.dp),
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 3.dp, pressedElevation = 1.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = Paper.brand,
            contentColor = Paper.sheet,
            disabledContainerColor = Paper.paperEdge,
            disabledContentColor = Paper.muted,
        ),
    ) {
        Text(text, style = Type.body)
    }
}

@Composable
fun PaperSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 48.dp),
        shape = RoundedCornerShape(4.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Paper.brand, disabledContentColor = Paper.muted),
    ) {
        Text(text, style = Type.caption)
    }
}

@Composable
fun PaperChoiceChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(4.dp)
    val interactionSource = remember { MutableInteractionSource() }
    val motion = LocalJournalMotion.current
    Box(
        modifier.heightIn(min = 46.dp)
            .journalPress(interactionSource, motion, shape, restingElevation = 1.5f.dp)
            .background(if (selected) Paper.tape.copy(alpha = 0.72f) else Paper.sheet, shape)
            .border(1.dp, if (selected) Paper.tape else Paper.ruleStrong, shape)
            .clickable(interactionSource = interactionSource, indication = null, role = Role.Checkbox, onClick = onClick)
            .semantics { this.selected = selected }
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = Type.caption.copy(color = if (selected) Paper.brandDeep else Paper.inkSoft))
    }
}

@Composable
fun PaperTag(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Paper.brandWash,
    contentColor: Color = Paper.brandDeep,
) {
    Box(
        modifier.background(color, RoundedCornerShape(2.dp)).padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(text, style = Type.caption.copy(color = contentColor))
    }
}

@Composable
fun PaperListRow(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
    danger: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val shape = RoundedCornerShape(3.dp)
    val interactionSource = remember { MutableInteractionSource() }
    val motion = LocalJournalMotion.current
    val pressModifier = if (onClick != null) {
        Modifier.journalPress(interactionSource, motion, shape, restingElevation = 2.dp)
    } else {
        Modifier
    }
    Row(
        modifier.fillMaxWidth()
            .heightIn(min = 66.dp)
            .then(pressModifier)
            .background(Paper.sheet, shape)
            .border(1.dp, Paper.rule, shape)
            .then(if (onClick != null) Modifier.clickable(interactionSource = interactionSource, indication = null, onClick = onClick) else Modifier)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = Type.body.copy(color = if (danger) Paper.red else Paper.ink))
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = Type.caption)
        }
        trailing?.invoke()
    }
}
