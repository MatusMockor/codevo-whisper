package com.codevo

import android.app.Activity
import android.content.Intent
import android.hardware.Camera
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.lang.ref.WeakReference

class PairingScannerModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val main = Handler(Looper.getMainLooper())
    private var pending: Promise? = null
    private var launcher: WeakReference<Activity>? = null
    private val listener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != REQUEST_CODE) return
            val promise = pending ?: return
            pending = null
            launcher = null
            val result = Arguments.createMap()
            val error = data?.getStringExtra("error")
            if (error != null) {
                result.putString("kind", "error")
                result.putString("reason", if (error == "permission") "permission" else "unavailable")
            } else if (resultCode == Activity.RESULT_OK) {
                val value = data?.getStringExtra("value")
                result.putString("kind", "result")
                result.putString("value", value?.takeIf { it.length <= MAX_TOKEN_LENGTH } ?: "")
            } else {
                result.putString("kind", "cancelled")
            }
            promise.resolve(result)
        }
    }

    init { context.addActivityEventListener(listener) }
    override fun getName() = "CodevoPairingScanner"

    @ReactMethod fun scan(promise: Promise) {
        main.post {
            val activity = reactApplicationContext.currentActivity
            if (pending != null || activity == null || activity.isFinishing) {
                promise.reject("scanner_unavailable", "QR scanner unavailable")
                return@post
            }
            try {
                val info = Camera.CameraInfo()
                val rear = (0 until Camera.getNumberOfCameras()).firstOrNull {
                    Camera.getCameraInfo(it, info)
                    info.facing == Camera.CameraInfo.CAMERA_FACING_BACK
                } ?: throw IllegalStateException()
                val intent = Intent(activity, PairingScanActivity::class.java).putExtra("camera", rear)
                pending = promise
                launcher = WeakReference(activity)
                activity.startActivityForResult(intent, REQUEST_CODE)
            } catch (_: Exception) {
                pending = null
                launcher = null
                promise.reject("scanner_unavailable", "QR scanner unavailable")
            }
        }
    }

    @ReactMethod fun cancel() {
        main.post { launcher?.get()?.finishActivity(REQUEST_CODE) }
    }

    override fun invalidate() {
        main.post {
            launcher?.get()?.finishActivity(REQUEST_CODE)
            pending?.resolve(Arguments.createMap().apply { putString("kind", "cancelled") })
            pending = null
            launcher = null
            reactApplicationContext.removeActivityEventListener(listener)
        }
        super.invalidate()
    }

    companion object {
        private const val REQUEST_CODE = 1919
        private const val MAX_TOKEN_LENGTH = 16384
    }
}
