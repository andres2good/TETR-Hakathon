import sounddevice as sd
import numpy as np
import threading

SAMPLE_RATE = 16000  # mismo que Android
CHUNK_MS    = 100    # enviar audio cada 100ms
CHUNK_SIZE  = int(SAMPLE_RATE * CHUNK_MS / 1000)

class AudioCapture:
    def __init__(self, on_chunk):
        self.on_chunk = on_chunk
        self._stream  = None
        self._running = False

    def start(self):
        self._running = True
        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype='int16',
            blocksize=CHUNK_SIZE,
            callback=self._callback,
        )
        self._stream.start()
        print("[Audio] Micrófono activo — 16kHz PCM16")

    def _callback(self, indata, frames, time, status):
        if self._running:
            self.on_chunk(indata.tobytes())

    def stop(self):
        self._running = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
        print("[Audio] Micrófono detenido")
