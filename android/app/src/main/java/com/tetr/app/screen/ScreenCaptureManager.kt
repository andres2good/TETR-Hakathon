package com.tetr.app.screen

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import java.io.ByteArrayOutputStream

/**
 * Captura pantallas usando MediaProjection de Android.
 * Requiere que el usuario apruebe el permiso una vez.
 */
class ScreenCaptureManager(private val context: Context) {

    companion object {
        private const val TAG = "ScreenCapture"
        const val REQUEST_CODE = 1001
        private const val JPEG_QUALITY = 60 // Comprimir para reducir tamaño

        // Último screenshot disponible para cuando Claude lo pida
        @Volatile var latestScreenshot: String? = null
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null

    private val metrics = DisplayMetrics().also {
        (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
            .defaultDisplay.getMetrics(it)
    }

    private val screenWidth = metrics.widthPixels / 2  // Mitad de resolución = menos datos
    private val screenHeight = metrics.heightPixels / 2
    private val screenDpi = metrics.densityDpi

    fun initialize(resultCode: Int, data: Intent) {
        val projectionManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = projectionManager.getMediaProjection(resultCode, data)

        imageReader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 2)

        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "TETRCapture",
            screenWidth, screenHeight, screenDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface, null, null,
        )

        Log.i(TAG, "ScreenCapture inicializado ${screenWidth}x${screenHeight}")
    }

    fun captureAsBase64(): String? {
        return try {
            val image = imageReader?.acquireLatestImage() ?: return null
            val planes = image.planes
            val buffer = planes[0].buffer
            val pixelStride = planes[0].pixelStride
            val rowStride = planes[0].rowStride
            val rowPadding = rowStride - pixelStride * screenWidth

            val bitmap = Bitmap.createBitmap(
                screenWidth + rowPadding / pixelStride,
                screenHeight,
                Bitmap.Config.ARGB_8888,
            )
            bitmap.copyPixelsFromBuffer(buffer)
            image.close()

            val cropped = Bitmap.createBitmap(bitmap, 0, 0, screenWidth, screenHeight)

            val out = ByteArrayOutputStream()
            cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.e(TAG, "Error capturando pantalla: ${e.message}")
            null
        }
    }

    fun release() {
        virtualDisplay?.release()
        mediaProjection?.stop()
        imageReader?.close()
        virtualDisplay = null
        mediaProjection = null
        imageReader = null
    }
}
