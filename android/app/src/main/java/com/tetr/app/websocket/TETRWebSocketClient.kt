package com.tetr.app.websocket

import android.util.Log
import com.tetr.app.BuildConfig
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Cliente WebSocket que conecta la app Android con el servidor TETR.
 *
 * Mensajes que ENVÍA al servidor:
 *   - Audio PCM binario (crudo, sin JSON)
 *   - { type: "ui_tree", uiTree: "..." }
 *   - { type: "screenshot", data: "base64..." }
 *   - { type: "session_end" }
 *
 * Mensajes que RECIBE del servidor:
 *   - { type: "speech", audio: "base64..." }
 *   - { type: "action", type: "click", target: "..." }
 *   - { type: "transcript", text: "..." }
 *   - { type: "agent_text", text: "..." }
 */
class TETRWebSocketClient(
    private val deviceId: String,
    private val language: String,
    private val onSpeech: (String) -> Unit,       // base64 audio a reproducir
    private val onAction: (String, JSONObject) -> Unit, // nombre de acción + parámetros
    private val onTranscript: (String) -> Unit,   // lo que dijo el usuario
    private val onAgentText: (String) -> Unit,    // lo que respondió el agente
    private val onConnected: () -> Unit,
    private val onDisconnected: () -> Unit,
) {

    companion object {
        private const val TAG = "TETRWebSocket"
        var instance: TETRWebSocketClient? = null
            private set
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // Sin timeout — conexión permanente
        .pingInterval(30, TimeUnit.SECONDS)    // Keepalive
        .build()

    private var webSocket: WebSocket? = null
    private var isConnected = false

    fun connect() {
        val url = "${BuildConfig.SERVER_URL}?deviceId=$deviceId&language=$language"
        val request = Request.Builder()
            .url(url)
            .addHeader("X-App-Key", BuildConfig.APP_KEY)
            .build()

        Log.i(TAG, "Conectando a $url")

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                isConnected = true
                instance = this@TETRWebSocketClient
                Log.i(TAG, "Conectado al servidor TETR")
                onConnected()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                isConnected = false
                instance = null
                Log.e(TAG, "Error WebSocket: ${t.message}")
                onDisconnected()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                isConnected = false
                instance = null
                Log.i(TAG, "WebSocket cerrado: $code $reason")
                onDisconnected()
            }
        })
    }

    private fun handleMessage(text: String) {
        try {
            val msg = JSONObject(text)
            when (msg.getString("type")) {
                "speech" -> onSpeech(msg.getString("audio"))
                "transcript" -> onTranscript(msg.getString("text"))
                "agent_text" -> onAgentText(msg.getString("text"))
                else -> {
                    // Es una acción para el dispositivo
                    val actionType = msg.getString("type")
                    onAction(actionType, msg)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error procesando mensaje: ${e.message}")
        }
    }

    // ─── Enviar audio PCM crudo ───────────────────────────────────────────────

    fun sendAudio(pcmData: ByteArray) {
        if (!isConnected) return
        val buffer = okio.ByteString.of(*pcmData)
        webSocket?.send(buffer)
    }

    // ─── Enviar UI tree ───────────────────────────────────────────────────────

    fun sendUiTree(tree: String) {
        if (!isConnected) return
        val msg = JSONObject().apply {
            put("type", "ui_tree")
            put("uiTree", tree)
        }
        webSocket?.send(msg.toString())
    }

    // ─── Enviar screenshot ────────────────────────────────────────────────────

    fun sendScreenshot(base64: String) {
        if (!isConnected) return
        val msg = JSONObject().apply {
            put("type", "screenshot")
            put("data", base64)
        }
        webSocket?.send(msg.toString())
    }

    // ─── Cerrar conexión ──────────────────────────────────────────────────────

    fun disconnect() {
        webSocket?.send(JSONObject().apply { put("type", "session_end") }.toString())
        webSocket?.close(1000, "Usuario cerró sesión")
        isConnected = false
        instance = null
    }
}
