// popup.js — lógica principal de la extensión TETR

const SERVER_WS  = 'ws://localhost:3000/ws';
const APP_KEY    = 'tetr-secret-2024-xK9mPqR7';
const DEVICE_ID  = 'chrome-ext-' + Math.random().toString(36).slice(2, 6);
const SAMPLE_RATE = 16000;

// ── Apps web conocidas ────────────────────────────────────────────────────────
const APP_URLS = {
  youtube:     'https://youtube.com',
  gmail:       'https://mail.google.com',
  whatsapp:    'https://web.whatsapp.com',
  google:      'https://google.com',
  maps:        'https://maps.google.com',
  spotify:     'https://open.spotify.com',
  twitter:     'https://twitter.com',
  instagram:   'https://instagram.com',
  facebook:    'https://facebook.com',
  github:      'https://github.com',
  netflix:     'https://netflix.com',
  amazon:      'https://amazon.com',
};

// ── Estado ────────────────────────────────────────────────────────────────────
let ws = null, audioCtx = null, processor = null, stream = null;
let recording = false;

// ── DOM ───────────────────────────────────────────────────────────────────────
const pill      = document.getElementById('pill');
const dot       = document.getElementById('dot');
const statusTxt = document.getElementById('statusTxt');
const micBtn    = document.getElementById('micBtn');
const ring      = document.getElementById('ring');
const convo     = document.getElementById('convo');
const bars      = [0,1,2,3,4,5,6].map(i => document.getElementById('b'+i));

// ── Status ────────────────────────────────────────────────────────────────────
function setStatus(state, text) {
  pill.className = 'status-pill ' + state;
  statusTxt.textContent = text;
  dot.className = 'dot' + (state !== 'connected' ? ' pulse' : '');
}

function addBubble(role, text) {
  const d = document.createElement('div');
  d.className = 'bubble ' + role;
  d.innerHTML = `<div class="lbl">${role === 'user' ? 'You' : 'TETR'}</div>${text}`;
  convo.appendChild(d);
  convo.scrollTop = convo.scrollHeight;
}

function animBars(on, level = 0) {
  bars.forEach(b => {
    const h = on ? Math.max(4, level * 60 + Math.random() * 10) : 4;
    b.style.height = h + 'px';
    b.style.background = on ? '#44f' : '#222';
  });
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect() {
  const url = `${SERVER_WS}?deviceId=${DEVICE_ID}&language=en&key=${APP_KEY}`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    setStatus('connected', 'Connected — click mic');
    micBtn.disabled = false;
    // Mandar contexto inicial de la página
    sendPageContext();
  };

  ws.onmessage = async (ev) => {
    if (typeof ev.data !== 'string') return;
    const msg = JSON.parse(ev.data);

    switch (msg.type) {
      case 'speech':
        setStatus('speaking', 'Speaking…');
        await playPcm(msg.audio);
        setStatus('connected', 'Connected — click mic');
        break;

      case 'transcript':
        addBubble('user', msg.text);
        setStatus('thinking', 'Thinking…');
        // Mandar screenshot + UI tree actualizado cuando el usuario habla
        sendPageContext();
        break;

      case 'agent_text':
        addBubble('agent', msg.text);
        break;

      // Acciones en el DOM de la página activa
      case 'click':
      case 'set_text':
      case 'scroll_up':
      case 'scroll_down':
      case 'press_back':
        executeOnPage(msg.type, msg);
        break;

      case 'open_app':
      case 'press_home':
        openApp(msg.appName || '');
        break;

      case 'volume_up':
      case 'volume_down':
        // No aplica en browser
        break;
    }
  };

  ws.onclose = () => {
    setStatus('', 'Disconnected — retrying…');
    micBtn.disabled = true;
    stopMic();
    setTimeout(connect, 3000);
  };
}

// ── Ejecutar acción en la página activa ──────────────────────────────────────

function executeOnPage(action, params) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'EXECUTE_ACTION',
      action,
      params,
    }, (response) => {
      if (chrome.runtime.lastError) return;
      // Después de la acción, mandar el nuevo estado de la página
      setTimeout(sendPageContext, 600);
    });
  });
}

// ── Abrir app / web ───────────────────────────────────────────────────────────

function openApp(appName) {
  const key = appName.toLowerCase();
  const url = APP_URLS[key] || `https://www.google.com/search?q=${encodeURIComponent(appName)}`;
  chrome.tabs.create({ url });
}

// ── Mandar contexto de pantalla al servidor ───────────────────────────────────

async function sendPageContext() {
  try {
    // Screenshot de la pestaña activa
    const dataUrl = await captureTab();
    if (dataUrl) {
      const b64 = dataUrl.split(',')[1];
      wsSend({ type: 'screenshot', data: b64 });
    }

    // UI tree de la página
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_UI_TREE' }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        wsSend({ type: 'ui_tree', uiTree: res.tree });
      });
    });
  } catch (e) {
    console.warn('sendPageContext error:', e);
  }
}

function captureTab() {
  return new Promise((resolve) => {
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 55 }, (url) => {
      resolve(chrome.runtime.lastError ? null : url);
    });
  });
}

function wsSend(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── Micrófono ─────────────────────────────────────────────────────────────────

micBtn.addEventListener('click', async () => {
  recording ? stopMic() : await startMic();
});

async function startMic() {
  try {
    stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const src = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!recording || ws?.readyState !== WebSocket.OPEN) return;
      const f32 = e.inputBuffer.getChannelData(0);
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++)
        i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
      ws.send(i16.buffer);

      const level = f32.reduce((s, v) => s + Math.abs(v), 0) / f32.length;
      animBars(true, level);
    };

    src.connect(processor);
    processor.connect(audioCtx.destination);

    recording = true;
    micBtn.classList.add('active');
    micBtn.textContent = '⏹️';
    ring.classList.add('active');
    setStatus('listening', 'Listening…');
  } catch (e) {
    alert('Microphone permission denied.');
  }
}

function stopMic() {
  recording = false;
  processor?.disconnect();
  stream?.getTracks().forEach(t => t.stop());
  audioCtx?.close();
  processor = stream = audioCtx = null;
  micBtn.classList.remove('active');
  micBtn.textContent = '🎙️';
  ring.classList.remove('active');
  animBars(false);
  if (ws?.readyState === WebSocket.OPEN)
    setStatus('connected', 'Connected — click mic');
}

// ── Reproducir audio PCM 24kHz ────────────────────────────────────────────────

function playPcm(b64) {
  return new Promise((resolve) => {
    try {
      const raw   = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const i16   = new Int16Array(bytes.buffer);
      const f32   = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;

      const ctx = new AudioContext({ sampleRate: 24000 });
      const buf = ctx.createBuffer(1, f32.length, 24000);
      buf.copyToChannel(f32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
      src.onended = () => { ctx.close(); resolve(); };
    } catch (e) { resolve(); }
  });
}

// ── Loop de contexto periódico ────────────────────────────────────────────────

setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN && !recording) sendPageContext();
}, 4000);

// ── Init ──────────────────────────────────────────────────────────────────────
connect();
