import sounddevice as sd
import numpy as np
import base64
import threading

SAMPLE_RATE = 24000  # Cartesia genera a 24kHz

class AudioPlayer:
    def __init__(self):
        self._lock = threading.Lock()

    def play_base64(self, b64_audio: str):
        threading.Thread(target=self._play, args=(b64_audio,), daemon=True).start()

    def _play(self, b64_audio: str):
        with self._lock:
            try:
                raw   = base64.b64decode(b64_audio)
                audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                sd.play(audio, samplerate=SAMPLE_RATE)
                sd.wait()
            except Exception as e:
                print(f"[Audio] Error reproduciendo: {e}")
