package com.tetr.app.screen

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.tetr.app.R

/**
 * Servicio en primer plano requerido por Android para usar MediaProjection.
 * Android exige que la captura de pantalla corra en un servicio visible al usuario.
 */
class ScreenCaptureService : Service() {

    companion object {
        private const val CHANNEL_ID = "tetr_capture"
        private const val NOTIFICATION_ID = 1
    }

    inner class LocalBinder : Binder() {
        fun getService(): ScreenCaptureService = this@ScreenCaptureService
    }

    private val binder = LocalBinder()

    override fun onBind(intent: Intent): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "TETR captura de pantalla",
            NotificationManager.IMPORTANCE_LOW,
        ).apply { description = "Requerido para que TETR pueda ver tu pantalla" }

        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("TETR activo")
            .setContentText("Escuchando tus comandos de voz…")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
}
