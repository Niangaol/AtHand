package com.shunshou.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
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

    Box(Modifier.fillMaxSize().background(Paper.page)) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 48.dp)
        ) {
            Text("顺手", style = Type.pageTitle.copy(fontSize = Type.pageTitle.fontSize * 1.4f))
            Spacer(Modifier.height(6.dp))
            Text("把零散的校园日子，收进一处。", style = Type.caption)
            Spacer(Modifier.height(40.dp))

            OutlinedTextField(
                value = username,
                onValueChange = { username = it },
                label = { Text("账号") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("密码") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            )
            if (register) {
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = confirm,
                    onValueChange = { confirm = it },
                    label = { Text("确认密码") },
                    singleLine = true,
                    isError = mismatch,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                )
            }

            if (state.error != null) {
                Spacer(Modifier.height(12.dp))
                Text(state.error, style = Type.caption.copy(color = Paper.red))
            }

            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { onSubmit(username.trim(), password, register) },
                enabled = canSubmit,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Paper.brand),
            ) {
                Text(if (state.loading) "请稍候…" else if (register) "注册并进入" else "登录", style = Type.body)
            }

            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Text(if (register) "已经有账号？" else "还没有账号？", style = Type.caption)
                TextButton(onClick = { register = !register }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(if (register) "去登录" else "注册一个", style = Type.caption.copy(color = Paper.brand))
                }
            }

            Spacer(Modifier.height(24.dp))
            Text(
                "账号数据保存在云端，账本与日程按账号隔离；同一账号可在网页和手机上查看。",
                style = Type.caption,
            )
        }
    }
}
