package com.shunshou.collector

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

class ScanActivity : ComponentActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var hint: TextView
    private val analyzer = Executors.newSingleThreadExecutor()
    private var provider: ProcessCameraProvider? = null
    private var scanner: BarcodeScanner? = null
    private var handled = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "需要相机权限才能扫码", Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        setContentView(R.layout.activity_scan)
        previewView = findViewById(R.id.previewView)
        hint = findViewById(R.id.textScanHint)
        hint.text = "对准电脑上的配对二维码\n点屏幕取消"
        previewView.setOnClickListener { finish() }
        startCamera()
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            runCatching {
                val cameraProvider = future.get()
                provider = cameraProvider
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                val barcodeScanner = BarcodeScanning.getClient(
                    BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                )
                scanner = barcodeScanner
                analysis.setAnalyzer(analyzer, ImageAnalysis.Analyzer { proxy -> scanFrame(barcodeScanner, proxy) })
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }.onFailure {
                hint.text = "相机启动失败：${it.message ?: "请检查相机权限"}"
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun scanFrame(barcodeScanner: BarcodeScanner, proxy: ImageProxy) {
        val media = proxy.image
        if (handled || media == null) {
            proxy.close()
            return
        }
        val image = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
        barcodeScanner.process(image)
            .addOnSuccessListener { barcodes ->
                if (handled) return@addOnSuccessListener
                val raw = barcodes.asSequence()
                    .mapNotNull { it.rawValue }
                    .firstOrNull { PairingPayload.parse(it) != null }
                    ?: return@addOnSuccessListener
                handled = true
                setResult(RESULT_OK, Intent().putExtra(EXTRA_PAYLOAD, raw))
                finish()
            }
            .addOnCompleteListener { proxy.close() }
    }

    override fun onDestroy() {
        provider?.unbindAll()
        scanner?.close()
        analyzer.shutdown()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_PAYLOAD = "pairing_payload"
    }
}
