#!/usr/bin/env python3
"""
TETR Desktop Client
Conecta al servidor TETR y controla la computadora por voz,
igual que la app Android controla el celular.
"""

import time
import uuid
import threading
import sys
import os

# ─── Configuración ────────────────────────────────────────────────────────────

SERVER_URL = os.getenv("TETR_SERVER_URL", "ws://localhost:3000/ws")
APP_KEY    = os.getenv("TETR_APP_KEY",    "tetr-secret-2024-xK9mPqR7")
DEVICE_ID  = str(uuid.uuid4())[:8]  # ID único para esta sesión

# ─── Imports del cliente ──────────────────────────────────────────────────────

from client.audio_capture  import AudioCapture
from client.audio_player   import AudioPlayer
from client.screen_capture import ScreenCapture
from client.action_executor import ActionExecutor
from client.ws_client      import TETRDesktopClient

# ─── Estado global ────────────────────────────────────────────────────────────

audio_player   = AudioPlayer()
screen_capture = ScreenCapture()
action_executor = ActionExecutor(screen_capture)
audio_capture  = None
ws_client      = None

# ─── Callbacks del WebSocket ──────────────────────────────────────────────────

def on_speech(b64_audio: str):
    print("[TETR] Reproduciendo respuesta...")
    audio_player.play_base64(b64_audio)

def on_action(action_type: str, params: dict):
    action_executor.execute(action_type, params)
    # Mandar UI tree actualizado después de la acción
    time.sleep(0.5)
    send_screen_context()

def on_transcript(text: str):
    print(f"\n  Tú: {text}")

def on_agent_text(text: str):
    print(f"  TETR: {text}\n")

def on_connected():
    global audio_capture
    print("\n✓ Conectado a TETR — habla para dar un comando\n")
    print("  Ejemplos:")
    print("  - 'Open Chrome'")
    print("  - 'Scroll down'")
    print("  - 'Type hello world'")
    print("  - 'Volume up'")
    print("\nPresiona Ctrl+C para salir.\n")

    # Empezar a capturar audio
    audio_capture = AudioCapture(on_chunk=ws_client.send_audio)
    audio_capture.start()

    # Mandar contexto inicial de pantalla
    send_screen_context()

def on_disconnected():
    print("[TETR] Desconectado del servidor")
    if audio_capture:
        audio_capture.stop()

# ─── Enviar pantalla al servidor ──────────────────────────────────────────────

def send_screen_context():
    try:
        screenshot = screen_capture.capture_base64()
        ws_client.send_screenshot(screenshot)
        ws_client.send_ui_tree(get_window_info())
    except Exception as e:
        print(f"[Screen] Error: {e}")

def get_window_info() -> str:
    """Descripción simple de las ventanas abiertas."""
    try:
        import subprocess
        if sys.platform == "linux":
            result = subprocess.run(
                ["xdotool", "getactivewindow", "getwindowname"],
                capture_output=True, text=True, timeout=2
            )
            title = result.stdout.strip()
            return f"Active window: {title}" if title else "(desktop)"
        else:
            return "(screenshot available)"
    except Exception:
        return "(screenshot available)"

# ─── Loop de screenshots periódicos ──────────────────────────────────────────

def screenshot_loop():
    while True:
        time.sleep(3)
        if ws_client and ws_client.connected:
            try:
                screenshot = screen_capture.capture_base64()
                ws_client.send_screenshot(screenshot)
            except Exception:
                pass

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    global ws_client

    print("=" * 50)
    print("  TETR Desktop Client")
    print(f"  Servidor: {SERVER_URL}")
    print(f"  Device ID: {DEVICE_ID}")
    print("=" * 50)
    print("\nConectando al servidor...\n")

    ws_client = TETRDesktopClient(
        server_url     = SERVER_URL,
        app_key        = APP_KEY,
        device_id      = DEVICE_ID,
        on_speech      = on_speech,
        on_action      = on_action,
        on_transcript  = on_transcript,
        on_agent_text  = on_agent_text,
        on_connected   = on_connected,
        on_disconnected = on_disconnected,
    )
    ws_client.connect()

    # Thread de screenshots periódicos
    threading.Thread(target=screenshot_loop, daemon=True).start()

    # Mantener el proceso vivo
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\nCerrando TETR...")
        if audio_capture:
            audio_capture.stop()
        ws_client.disconnect()
        print("Hasta luego.")

if __name__ == "__main__":
    main()
