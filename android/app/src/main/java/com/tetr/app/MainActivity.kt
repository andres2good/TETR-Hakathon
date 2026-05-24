package com.tetr.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.view.accessibility.AccessibilityManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.tetr.app.accessibility.TETRAccessibilityService
import com.tetr.app.audio.AudioCapture
import com.tetr.app.audio.AudioPlayer
import com.tetr.app.databinding.ActivityMainBinding
import com.tetr.app.screen.ScreenCaptureManager
import com.tetr.app.websocket.TETRWebSocketClient
import org.json.JSONObject
import java.util.UUID

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val PERMISSION_MIC = 100
        private const val REQUEST_SCREEN_CAPTURE = 1001
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var audioCapture: AudioCapture
    private lateinit var audioPlayer: AudioPlayer
    private lateinit var screenCapture: ScreenCaptureManager
    private var wsClient: TETRWebSocketClient? = null

    private val deviceId by lazy {
        getSharedPreferences("tetr", MODE_PRIVATE)
            .getString("device_id", null)
            ?: UUID.randomUUID().toString().also { id ->
                getSharedPreferences("tetr", MODE_PRIVATE).edit()
                    .putString("device_id", id).apply()
            }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        audioPlayer = AudioPlayer()
        screenCapture = ScreenCaptureManager(this)
        ScreenCaptureManager.latestScreenshot = null

        setupButton()
        checkPermissions()
    }

    // ─── Permisos y configuración ─────────────────────────────────────────────

    private fun checkPermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.RECORD_AUDIO), PERMISSION_MIC
            )
        } else {
            checkAccessibilityEnabled()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_MIC && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            checkAccessibilityEnabled()
        } else {
            Toast.makeText(this, "TETR necesita el micrófono para funcionar", Toast.LENGTH_LONG).show()
        }
    }

    private fun isAccessibilityEnabled(): Boolean {
        val am = getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager
        val enabledServices = Settings.Secure.getString(
            contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabledServices.contains(packageName)
    }

    private fun checkAccessibilityEnabled() {
        if (isAccessibilityEnabled()) {
            binding.btnActivate.text = "TETR activo ✓"
            binding.btnActivate.isEnabled = false
            requestScreenCapturePermission()
        } else {
            binding.btnActivate.text = getString(R.string.btn_go_to_settings)
            binding.btnActivate.isEnabled = true
        }
    }

    private fun setupButton() {
        binding.btnActivate.setOnClickListener {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            startActivity(intent)
        }
    }

    // ─── Captura de pantalla ──────────────────────────────────────────────────

    private fun requestScreenCapturePermission() {
        val pm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(pm.createScreenCaptureIntent(), REQUEST_SCREEN_CAPTURE)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_SCREEN_CAPTURE && resultCode == RESULT_OK && data != null) {
            screenCapture.initialize(resultCode, data)
            startCapturingScreenshots()
            connectToServer()
        }
    }

    // ─── Captura periódica de pantalla ────────────────────────────────────────

    private fun startCapturingScreenshots() {
        Thread {
            while (!isFinishing) {
                Thread.sleep(2000) // Actualizar screenshot cada 2 segundos
                val screenshot = screenCapture.captureAsBase64()
                if (screenshot != null) {
                    ScreenCaptureManager.latestScreenshot = screenshot
                }
            }
        }.start()
    }

    // ─── Conexión al servidor ─────────────────────────────────────────────────

    private fun connectToServer() {
        updateStatus("Conectando…", "#FFAA00")

        wsClient = TETRWebSocketClient(
            deviceId = deviceId,
            language = "es",
            onSpeech = { base64Audio ->
                runOnUiThread { updateStatus("Hablando…", "#4A90D9") }
                audioPlayer.playBase64(base64Audio)
            },
            onAction = { actionType, params ->
                Log.i(TAG, "Acción recibida: $actionType")
                TETRAccessibilityService.instance?.actionExecutor?.execute(actionType, params)
            },
            onTranscript = { text ->
                runOnUiThread {
                    binding.tvUserText.text = "Tú: $text"
                    updateStatus("Procesando…", "#FFAA00")
                }
            },
            onAgentText = { text ->
                runOnUiThread {
                    binding.tvAgentText.text = text
                }
            },
            onConnected = {
                runOnUiThread { updateStatus("Conectado — di algo", "#4CAF50") }
                startAudioCapture()
            },
            onDisconnected = {
                runOnUiThread { updateStatus("Desconectado", "#FF6B6B") }
                stopAudioCapture()
            },
        )

        wsClient?.connect()
    }

    // ─── Audio ────────────────────────────────────────────────────────────────

    private fun startAudioCapture() {
        audioCapture = AudioCapture { pcmChunk ->
            wsClient?.sendAudio(pcmChunk)
        }
        audioCapture.start()
    }

    private fun stopAudioCapture() {
        if (::audioCapture.isInitialized) audioCapture.stop()
    }

    // ─── UI helpers ───────────────────────────────────────────────────────────

    private fun updateStatus(text: String, color: String) {
        binding.tvStatus.text = text
        binding.tvStatus.setTextColor(android.graphics.Color.parseColor(color))
    }

    override fun onResume() {
        super.onResume()
        checkAccessibilityEnabled()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopAudioCapture()
        wsClient?.disconnect()
        screenCapture.release()
        audioPlayer.stop()
    }
}
