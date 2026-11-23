package com.shunshou.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ShunshouApiTest {
    @Test
    fun mapsErrorCodesToChineseMessages() {
        assertEquals("账号或密码不对。", ApiErrors.message(ApiException(401, "")))
        assertEquals("服务地址不被允许，请稍后再试。", ApiErrors.message(ApiException(403, "")))
        assertEquals("数据在别处更新了，已为你刷新。", ApiErrors.message(ApiException(409, "")))
        assertEquals("云端暂时不可用，请稍后再试。", ApiErrors.message(ApiException(503, "")))
    }

    @Test
    fun joinsBaseUrlAndPath() {
        assertEquals(
            "https://example.com/functions/v1/app/api/login",
            ShunshouApi.endpoint("https://example.com/functions/v1/app/", "/api/login"),
        )
    }

    @Test
    fun keepsOriginFromBaseUrl() {
        assertEquals(
            "https://athand-qnvq63y722x.qoder.zone",
            ShunshouApi.originOf(SessionStore.DEFAULT_BASE),
        )
    }
}
