package com.shunshou.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.shunshou.app.data.AppUiState
import com.shunshou.app.ui.components.JournalPage
import com.shunshou.app.ui.components.PaperNote
import com.shunshou.app.ui.components.PaperPrimaryButton
import com.shunshou.app.ui.components.PaperTag
import com.shunshou.app.ui.components.PaperTextField
import com.shunshou.app.ui.components.SectionHeading
import com.shunshou.app.ui.components.WashiTape
import com.shunshou.app.ui.motion.LocalJournalMotion
import com.shunshou.app.ui.motion.journalEntrance
import com.shunshou.app.ui.theme.Dimens
import com.shunshou.app.ui.theme.Paper
import com.shunshou.app.ui.theme.Type

@Composable
fun LoginScreen(state: AppUiState, onSubmit: (String, String, Boolean) -> Unit) {
    var username by remember { mutableStateOf(state.username) }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var register by remember { mutableStateOf(false) }
    val mismatch = register && confirm != password
    val canSubmit = username.trim().length >= 3 && password.length >= 8 && !mismatch && !state.loading
    val motion = LocalJournalMotion.current

    JournalPage(Modifier.padding(vertical = 34.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Dimens.gutter),
            verticalAlignment = Alignment.Top,
        ) {
            Column(Modifier.weight(1f)) {
                Text("顺手", style = Type.pageTitle.copy(fontSize = Type.pageTitle.fontSize * 1.35f))
                Spacer(Modifier.height(6.dp))
                Text("把零散的校园日子，收进一处。", style = Type.caption)
            }
            WashiTape(Paper.tape, modifier = Modifier.padding(top = 6.dp))
        }
        Spacer(Modifier.height(28.dp))

        PaperNote(
            modifier = Modifier.padding(horizontal = Dimens.gutter).journalEntrance(0, motion),
            tapeColor = Paper.tapeGreen,
        ) {
            SectionHeading(if (register) "注册新账号" else "登录顺手")
            Spacer(Modifier.height(14.dp))
            PaperTextField(
                value = username,
                onValueChange = { username = it },
                label = "账号",
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            )
            Spacer(Modifier.height(12.dp))
            PaperTextField(
                value = password,
                onValueChange = { password = it },
                label = "密码",
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            )
            if (register) {
                Spacer(Modifier.height(12.dp))
                PaperTextField(
                    value = confirm,
                    onValueChange = { confirm = it },
                    label = "确认密码",
                    isError = mismatch,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                )
            }
            state.error?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, style = Type.caption.copy(color = Paper.red))
            }
            Spacer(Modifier.height(20.dp))
            PaperPrimaryButton(
                text = if (state.loading) "请稍候…" else if (register) "注册并进入" else "登录",
                onClick = { onSubmit(username.trim(), password, register) },
                enabled = canSubmit,
            )
            Spacer(Modifier.height(6.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (register) "已经有账号？" else "还没有账号？", style = Type.caption)
                TextButton(onClick = { register = !register }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(if (register) "去登录" else "注册一个", style = Type.caption.copy(color = Paper.brand))
                }
            }
        }

        Spacer(Modifier.height(22.dp))
        PaperTag(
            "账号数据保存在云端 · 按账号隔离",
            modifier = Modifier.padding(horizontal = Dimens.gutter),
            color = Paper.kraftWash,
            contentColor = Paper.inkSoft,
        )
    }
}
