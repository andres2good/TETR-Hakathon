import mss
import base64
from PIL import Image
import io

class ScreenCapture:
    def __init__(self):
        self._sct = mss.mss()

    def capture_base64(self) -> str:
        """Toma screenshot, lo comprime como JPEG y devuelve base64."""
        monitor = self._sct.monitors[0]  # pantalla principal
        img = self._sct.grab(monitor)
        pil = Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")

        # Reducir a la mitad para que no sea tan pesado
        w, h = pil.size
        pil = pil.resize((w // 2, h // 2), Image.LANCZOS)

        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=60)
        return base64.b64encode(buf.getvalue()).decode()
