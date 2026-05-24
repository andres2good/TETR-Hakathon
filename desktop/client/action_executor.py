import subprocess
import sys
import threading
import pyautogui
import time

# Seguridad — evitar que pyautogui mueva el mouse a una esquina y bloquee
pyautogui.FAILSAFE = True
pyautogui.PAUSE    = 0.1

class ActionExecutor:
    def __init__(self, screen_capture):
        self.screen = screen_capture

    def execute(self, action_type: str, params: dict):
        print(f"[Action] {action_type} — {params}")
        try:
            if   action_type == "click":            self._click(params.get("target", ""))
            elif action_type == "set_text":         self._set_text(params.get("text", ""), params.get("target", ""))
            elif action_type == "scroll_up":        pyautogui.scroll(5)
            elif action_type == "scroll_down":      pyautogui.scroll(-5)
            elif action_type == "open_app":         self._open_app(params.get("appName", ""))
            elif action_type == "press_back":       pyautogui.hotkey("alt", "left")
            elif action_type == "press_home":       self._show_desktop()
            elif action_type == "volume_up":        self._volume(params.get("steps", 2), up=True)
            elif action_type == "volume_down":      self._volume(params.get("steps", 2), up=False)
            elif action_type == "request_screenshot": pass  # el cliente ya manda screenshots periódicos
            else: print(f"[Action] Desconocida: {action_type}")
        except Exception as e:
            print(f"[Action] Error en {action_type}: {e}")

    # ─── Click por texto usando OCR ───────────────────────────────────────────

    def _click(self, target: str):
        if not target:
            return
        try:
            import pytesseract
            from PIL import Image
            import mss, io

            # Tomar screenshot fresco
            with mss.mss() as sct:
                mon = sct.monitors[0]
                img = sct.grab(mon)
                pil = Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")

            # OCR para encontrar el texto en pantalla
            data = pytesseract.image_to_data(pil, output_type=pytesseract.Output.DICT)
            query = target.lower()

            for i, word in enumerate(data["text"]):
                if query in word.lower() and int(data["conf"][i]) > 30:
                    x = data["left"][i] + data["width"][i]  // 2
                    y = data["top"][i]  + data["height"][i] // 2
                    pyautogui.click(x, y)
                    print(f"[Action] Click en '{word}' ({x},{y})")
                    return

            print(f"[Action] No encontré '{target}' en pantalla")
        except ImportError:
            print("[Action] pytesseract no instalado — usando posición del mouse")

    # ─── Escribir texto ───────────────────────────────────────────────────────

    def _set_text(self, text: str, target: str):
        if target:
            self._click(target)
            time.sleep(0.3)
        pyautogui.write(text, interval=0.02)

    # ─── Abrir aplicación ─────────────────────────────────────────────────────

    def _open_app(self, app_name: str):
        app = app_name.lower()
        if sys.platform == "linux":
            apps = {
                "chrome": "google-chrome", "chromium": "chromium-browser",
                "firefox": "firefox",      "terminal": "gnome-terminal",
                "files": "nautilus",       "calculator": "gnome-calculator",
                "spotify": "spotify",      "vscode": "code",
            }
            cmd = apps.get(app, app)
            subprocess.Popen([cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        elif sys.platform == "darwin":  # macOS
            subprocess.Popen(["open", "-a", app_name])

        elif sys.platform == "win32":
            subprocess.Popen(["start", app_name], shell=True)

    # ─── Mostrar escritorio ───────────────────────────────────────────────────

    def _show_desktop(self):
        if sys.platform == "linux":
            pyautogui.hotkey("super", "d")
        elif sys.platform == "darwin":
            pyautogui.hotkey("f11")
        elif sys.platform == "win32":
            pyautogui.hotkey("win", "d")

    # ─── Volumen ──────────────────────────────────────────────────────────────

    def _volume(self, steps: int, up: bool):
        key = "volumeup" if up else "volumedown"
        for _ in range(steps):
            pyautogui.press(key)
