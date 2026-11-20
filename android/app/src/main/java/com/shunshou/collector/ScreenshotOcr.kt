package com.shunshou.collector

import android.graphics.BitmapFactory
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions

object ScreenshotOcr {
    fun recognize(
        png: ByteArray,
        onResult: (List<String>) -> Unit,
        onError: (Throwable) -> Unit,
    ) {
        val bitmap = BitmapFactory.decodeByteArray(png, 0, png.size)
        if (bitmap == null) {
            onError(IllegalStateException("截图解码失败"))
            return
        }
        val client = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        client.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { result ->
                val lines = result.textBlocks
                    .flatMap { it.lines }
                    .map { it.text.trim() }
                    .filter { it.isNotEmpty() }
                client.close()
                onResult(lines)
            }
            .addOnFailureListener { error ->
                client.close()
                onError(error)
            }
    }
}
