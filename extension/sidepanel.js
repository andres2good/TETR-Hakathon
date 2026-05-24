// sidepanel.js — NAVI always listening

const SERVER_WS   = 'ws://localhost:3000/ws';
const APP_KEY     = 'tetr-secret-2024-xK9mPqR7';
const DEVICE_ID   = 'navi-chrome-' + Math.random().toString(36).slice(2, 6);
const SAMPLE_RATE = 16000;

const APP_URLS = {
  youtube: 'https://youtube.com',
  'youtube music': 'https://music.youtube.com',
  gmail: 'https://mail.google.com',
  whatsapp: 'https://web.whatsapp.com',
  google: 'https://google.com',
  maps: 'https://maps.google.com',
  spotify: 'https://open.spotify.com',
  twitter: 'https://twitter.com',
  instagram: 'https://instagram.com',
  facebook: 'https://facebook.com',
  github: 'https://github.com',
  netflix: 'https://netflix.com',
  amazon: 'https://amazon.com',
  reddit: 'https://reddit.com',
  twitch: 'https://twitch.tv',
  linkedin: 'https://linkedin.com',
  notion: 'https://notion.so',
};

// ── State ─────────────────────────────────────────────────────────────────────
let ws = null, audioCtx = null, processor = null, stream = null;
let listening = false;

// ── Speech queue — prevents simultaneous playback ─────────────────────────────
const speechQueue = [];
let isSpeaking = false;
let stopCurrentPlayback = null;

function enqueueSpeech(b64) {
  speechQueue.push(b64);
  if (!isSpeaking) drainSpeechQueue();
}

function interruptSpeech() {
  speechQueue.length = 0;
  if (stopCurrentPlayback) { stopCurrentPlayback(); stopCurrentPlayback = null; }
  isSpeaking = false;
  resumeMic();
  setStatus('listening', 'Listening…');
}

async function drainSpeechQueue() {
  if (speechQueue.length === 0) {
    isSpeaking = false;
    resumeMic();
    setStatus('listening', 'Listening…');
    return;
  }
  isSpeaking = true;
  pauseMic();
  setStatus('speaking', 'Speaking…');
  await playPcm(speechQueue.shift());
  drainSpeechQueue();
}

// ── DOM ───────────────────────────────────────────────────────────────────────
const pill      = document.getElementById('pill');
const dot       = document.getElementById('dot');
const statusTxt = document.getElementById('statusTxt');
const micBtn    = document.getElementById('micBtn');
const ring      = document.getElementById('ring');
const convo     = document.getElementById('convo');
const bars      = [0,1,2,3,4,5,6,7,8].map(i => document.getElementById('b'+i));

// ── UI helpers ────────────────────────────────────────────────────────────────
function setStatus(state, text) {
  pill.className = 'status-pill ' + state;
  statusTxt.textContent = text;
  dot.className = 'dot' + (['listening','thinking','speaking'].includes(state) ? ' pulse' : '');
}

function addBubble(role, text) {
  const d = document.createElement('div');
  d.className = 'bubble ' + role;
  d.innerHTML = `<div class="lbl">${role === 'user' ? 'You' : 'NAVI'}</div>${text}`;
  convo.appendChild(d);
  convo.scrollTop = convo.scrollHeight;
}

function animBars(on, level = 0) {
  bars.forEach(b => {
    const h = on ? Math.max(4, level * 80 + Math.random() * 12) : 4;
    b.style.height = h + 'px';
    b.style.background = on ? '#5566ff' : '#1a1a2e';
  });
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect() {
  const url = `${SERVER_WS}?deviceId=${DEVICE_ID}&language=en&key=${APP_KEY}`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    setStatus('connected', 'Connected');
    micBtn.disabled = false;
    startMic();
    sendPageContext();
  };

  ws.onmessage = async (ev) => {
    if (typeof ev.data !== 'string') return;
    const msg = JSON.parse(ev.data);

    switch (msg.type) {
      case 'speech':
        enqueueSpeech(msg.audio);
        break;

      case 'transcript':
        interruptSpeech();
        addBubble('user', msg.text);
        setStatus('thinking', 'Thinking…');
        sendPageContext();
        break;

      case 'agent_text':
        addBubble('agent', msg.text);
        break;

      case 'click':
      case 'set_text':
      case 'clear_field':
      case 'press_key':
      case 'scroll_up':
      case 'scroll_down':
      case 'press_back':
      case 'press_enter':
        executeOnPage(msg.type, msg);
        break;

      case 'navigate_to':
        navigateCurrentTab(msg.url || '');
        break;

      case 'close_tab':
        closeCurrentTab();
        break;

      case 'new_tab':
        chrome.tabs.create({ url: msg.url || 'about:blank' });
        setTimeout(sendPageContext, 1500);
        break;

      case 'switch_tab':
        switchToTab(msg.query || '');
        break;

      case 'request_screenshot':
        // Server asked for a fresh screenshot — send it immediately
        sendPageContext();
        break;

      case 'open_app':
        openApp(msg.appName || '');
        break;

      case 'press_home':
        chrome.tabs.create({ url: 'chrome://newtab' });
        setTimeout(sendPageContext, 500);
        break;
    }
  };

  ws.onclose = () => {
    setStatus('', 'Reconnecting…');
    micBtn.disabled = true;
    stopMic();
    setTimeout(connect, 3000);
  };
}

// ── Microphone ───────────────────────────────────────────────────────────────

micBtn.addEventListener('click', () => {
  listening ? stopMic() : startMic();
});

async function startMic() {
  if (listening) return;
  try {
    stream   = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    await audioCtx.resume();
    audioCtx.onstatechange = () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
    };

    const src = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      const f32 = e.inputBuffer.getChannelData(0);
      const level = f32.reduce((s, v) => s + Math.abs(v), 0) / f32.length;

      // Barge-in: user speaks while NAVI is playing → interrupt immediately
      if (isSpeaking && level > 0.07) {
        interruptSpeech();
        return;
      }

      if (!listening || ws?.readyState !== WebSocket.OPEN) {
        animBars(false);
        return;
      }

      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++)
        i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
      ws.send(i16.buffer);
      animBars(true, level);
    };

    src.connect(processor);
    processor.connect(audioCtx.destination);

    listening = true;
    micBtn.classList.add('active');
    micBtn.textContent = '⏹️';
    ring.classList.add('active');
    setStatus('listening', 'Listening…');
  } catch (e) {
    console.error('Mic error:', e);
    setStatus('', 'Mic permission denied');
  }
}

function pauseMic()  { listening = false; animBars(false); }
function resumeMic() { if (stream) listening = true; }

function stopMic() {
  listening = false;
  processor?.disconnect();
  stream?.getTracks().forEach(t => t.stop());
  audioCtx?.close();
  processor = stream = audioCtx = null;
  micBtn.classList.remove('active');
  micBtn.textContent = '🎙️';
  ring.classList.remove('active');
  animBars(false);
  setStatus('connected', 'Mic off — click to restart');
}

// ── Page actions ─────────────────────────────────────────────────────────────

function executeOnPage(action, params) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'EXECUTE_ACTION', action, params },
      () => { setTimeout(sendPageContext, 800); }
    );
  });
}

// Open an app — checks if a tab with that URL already exists first
function openApp(appName) {
  const normalized = appName.toLowerCase().trim();
  const url = APP_URLS[normalized]
    || (normalized.startsWith('http') ? normalized : null)
    || `https://www.google.com/search?q=${encodeURIComponent(appName)}`;

  chrome.tabs.query({}, (tabs) => {
    // Look for an existing tab that matches this URL
    const existing = tabs.find(t => t.url && t.url.startsWith(url.replace(/\/$/, '')));
    if (existing) {
      // Switch to the existing tab instead of opening a new one
      chrome.tabs.update(existing.id, { active: true });
      chrome.windows.update(existing.windowId, { focused: true });
      setTimeout(sendPageContext, 800);
    } else {
      chrome.tabs.create({ url });
      setTimeout(sendPageContext, 3000);
    }
  });
}

function navigateCurrentTab(url) {
  if (!url) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.update(tabs[0].id, { url });
    setTimeout(sendPageContext, 2500);
  });
}

function closeCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.remove(tabs[0].id);
    setTimeout(sendPageContext, 500);
  });
}

function switchToTab(query) {
  if (!query) return;
  const q = query.toLowerCase();
  chrome.tabs.query({}, (tabs) => {
    const match = tabs.find(t =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.url || '').toLowerCase().includes(q)
    );
    if (match) {
      chrome.tabs.update(match.id, { active: true });
      chrome.windows.update(match.windowId, { focused: true });
      setTimeout(sendPageContext, 600);
    }
  });
}

// ── Screen context ────────────────────────────────────────────────────────────

async function sendPageContext() {
  try {
    const dataUrl = await captureTab();
    if (dataUrl) wsSend({ type: 'screenshot', data: dataUrl.split(',')[1] });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_UI_TREE' }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        wsSend({ type: 'ui_tree', uiTree: res.tree });
      });
    });
  } catch (e) {}
}

function captureTab() {
  return new Promise(resolve => {
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 60 },
      url => resolve(chrome.runtime.lastError ? null : url)
    );
  });
}

function wsSend(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── Audio playback ────────────────────────────────────────────────────────────

function playPcm(b64) {
  return new Promise(resolve => {
    try {
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const i16 = new Int16Array(bytes.buffer);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;

      const ctx = new AudioContext({ sampleRate: 24000 });
      const buf = ctx.createBuffer(1, f32.length, 24000);
      buf.copyToChannel(f32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);

      const done = () => { stopCurrentPlayback = null; ctx.close(); resolve(); };
      stopCurrentPlayback = () => { try { src.stop(); } catch(e) {} done(); };
      src.start();
      src.onended = done;
    } catch (e) { stopCurrentPlayback = null; resolve(); }
  });
}

// ── Send page context every 6 seconds ────────────────────────────────────────

setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) sendPageContext();
}, 6000);

// ── Init ──────────────────────────────────────────────────────────────────────
connect();
