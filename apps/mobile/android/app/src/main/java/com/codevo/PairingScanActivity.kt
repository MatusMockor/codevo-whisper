package com.codevo

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.CameraPreview
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory

class PairingScanActivity : Activity() {
    private enum class Phase { Ready, Permission, Capturing, Finished }
    private lateinit var scanner: DecoratedBarcodeView
    private var resumed = false
    private var phase = Phase.Ready

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val spacing = (24 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(16, 26, 26))
            setPadding(spacing, spacing * 2, spacing, spacing)
        }
        layout.addView(TextView(this).apply {
            setText(R.string.pairing_scan_title)
            textSize = 23f
            setTextColor(Color.rgb(241, 245, 236))
        })
        scanner = DecoratedBarcodeView(this).apply {
            setStatusText(getString(R.string.pairing_scan_hint))
            barcodeView.decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
            barcodeView.cameraSettings.requestedCameraId = intent.getIntExtra("camera", -1)
        }
        scanner.barcodeView.addStateListener(object : CameraPreview.StateListener {
            override fun previewSized() {}
            override fun previewStarted() {}
            override fun previewStopped() {}
            override fun cameraClosed() {}
            override fun cameraError(error: Exception) { finishWith("unavailable") }
        })
        scanner.decodeSingle { result ->
            if (isFinishing || !resumed) return@decodeSingle
            phase = Phase.Finished
            scanner.pauseAndWait()
            setResult(RESULT_OK, Intent().putExtra("value", result.text.takeIf { it.length <= 16384 } ?: ""))
            finish()
        }
        layout.addView(scanner, LinearLayout.LayoutParams(-1, 0, 1f))
        layout.addView(Button(this).apply {
            setText(R.string.pairing_scan_cancel)
            isAllCaps = false
            setTextColor(Color.rgb(231, 255, 244))
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.rgb(37, 69, 59))
            minHeight = (52 * resources.displayMetrics.density).toInt()
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(-1, -2))
        setContentView(layout)
    }

    private fun finishWith(reason: String) {
        if (isFinishing) return
        phase = Phase.Finished
        scanner.pauseAndWait()
        setResult(RESULT_CANCELED, Intent().putExtra("error", reason))
        finish()
    }

    override fun onResume() {
        super.onResume()
        if (isFinishing) return
        resumed = true
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            phase = Phase.Capturing
            scanner.resume()
        } else if (phase == Phase.Ready) {
            phase = Phase.Permission
            requestPermissions(arrayOf(Manifest.permission.CAMERA), 19)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 19) return
        if (grantResults.firstOrNull() != PackageManager.PERMISSION_GRANTED) {
            finishWith("permission")
            return
        }
        if (resumed && !isFinishing) {
            phase = Phase.Capturing
            scanner.resume()
        }
    }

    override fun onPause() {
        resumed = false
        scanner.pauseAndWait()
        if (phase == Phase.Capturing && !isFinishing) {
            phase = Phase.Finished
            finish()
        }
        super.onPause()
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations && !isFinishing) finish()
    }
}
