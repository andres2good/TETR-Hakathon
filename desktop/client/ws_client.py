import websocket
import json
import threading
import uuid

class TETRDesktopClient:
    def __init__(self, server_url: str, app_key: str, device_id: str,
                 on_speech, on_action, on_transcript, on_agent_text,
                 on_connected, on_disconnected):
        self.url          = f"{server_url}?deviceId={device_id}&language=en"
        self.app_key      = app_key
        self.on_speech    = on_speech
        self.on_action    = on_action
        self.on_transcript  = on_transcript
        self.on_agent_text  = on_agent_text
        self.on_connected   = on_connected
        self.on_disconnected = on_disconnected
        self._ws = None
        self.connected = False

    def connect(self):
        self._ws = websocket.WebSocketApp(
            self.url,
            header={"X-App-Key": self.app_key},
            on_open=self._on_open,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
        )
        t = threading.Thread(target=self._ws.run_forever, daemon=True)
        t.start()

    def _on_open(self, ws):
        self.connected = True
        print("[WS] Conectado al servidor TETR")
        self.on_connected()

    def _on_message(self, ws, message):
        try:
            msg = json.loads(message)
            t   = msg.get("type", "")
            if   t == "speech":     self.on_speech(msg["audio"])
            elif t == "transcript": self.on_transcript(msg["text"])
            elif t == "agent_text": self.on_agent_text(msg["text"])
            else:                   self.on_action(t, msg)
        except Exception as e:
            print(f"[WS] Error procesando mensaje: {e}")

    def _on_error(self, ws, error):
        print(f"[WS] Error: {error}")
        self.connected = False
        self.on_disconnected()

    def _on_close(self, ws, code, msg):
        print(f"[WS] Cerrado: {code}")
        self.connected = False
        self.on_disconnected()

    def send_audio(self, pcm_bytes: bytes):
        if self.connected and self._ws:
            try:
                self._ws.send_binary(pcm_bytes)
            except Exception:
                pass

    def send_ui_tree(self, tree: str):
        self._send({"type": "ui_tree", "uiTree": tree})

    def send_screenshot(self, b64: str):
        self._send({"type": "screenshot", "data": b64})

    def disconnect(self):
        self._send({"type": "session_end"})
        if self._ws:
            self._ws.close()

    def _send(self, obj: dict):
        if self.connected and self._ws:
            try:
                self._ws.send(json.dumps(obj))
            except Exception:
                pass
