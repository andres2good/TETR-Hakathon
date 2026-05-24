package com.tetr.app.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.*

/**
 * Reproduce el audio PCM que manda el servidor (respuesta del agente).
 * El servidor manda PCM s16le 24kHz en base64.
 */
class AudioPlayer {

    companion object {
        private const val TAG = "AudioPlayer"
        private const val SAMPLE_RATE = 24000 // Cartesia genera a 24kHz
    }

    private var audioTrack: AudioTrack? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun playBase64(base64Audio: String) {
        scope.launch {
            try {
                val pcmData = Base64.decode(base64Audio, Base64.DEFAULT)
                play(pcmData)
            } catch (e: Exception) {
                Log.e(TAG, "Error decodificando audio: ${e.message}")
            }
        }
    }

    private fun play(pcmData: ByteArray) {
        stop()

        val bufferSize = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )

        audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        audioTrack?.play()
        audioTrack?.write(pcmData, 0, pcmData.size)
        Log.d(TAG, "Reproduciendo ${pcmData.size} bytes a ${SAMPLE_RATE}Hz")
    }

    fun stop() {
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
    }
}
