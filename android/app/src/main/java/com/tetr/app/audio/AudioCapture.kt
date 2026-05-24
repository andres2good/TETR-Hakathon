package com.tetr.app.audio

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.*

/**
 * Captura audio del micrófono en formato PCM 16-bit 16kHz.
 * Este es el formato que Deepgram espera del lado del servidor.
 */
class AudioCapture(private val onChunk: (ByteArray) -> Unit) {

    companion object {
        private const val TAG = "AudioCapture"
        const val SAMPLE_RATE = 16000
        const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        private const val CHUNK_MS = 100 // Enviar audio cada 100ms
    }

    private var audioRecord: AudioRecord? = null
    private var captureJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    val isRecording: Boolean get() = audioRecord?.recordingState == AudioRecord.RECORDSTATE_RECORDING

    fun start() {
        if (isRecording) return

        val bufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)
        val chunkSize = SAMPLE_RATE * 2 * CHUNK_MS / 1000 // bytes por 100ms

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            CHANNEL_CONFIG,
            AUDIO_FORMAT,
            bufferSize * 4,
        )

        if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "AudioRecord no pudo inicializarse")
            return
        }

        audioRecord?.startRecording()
        Log.i(TAG, "Grabando audio — ${SAMPLE_RATE}Hz PCM16")

        captureJob = scope.launch {
            val buffer = ByteArray(chunkSize)
            while (isActive && isRecording) {
                val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
                if (read > 0) {
                    onChunk(buffer.copyOf(read))
                }
            }
        }
    }

    fun stop() {
        captureJob?.cancel()
        captureJob = null
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        Log.i(TAG, "Audio detenido")
    }
}
