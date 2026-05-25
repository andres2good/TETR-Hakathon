// sidepanel.js — Echo by Ecolocation

// ── Supabase ──────────────────────────────────────────────────────────────────
// Get SUPABASE_ANON_KEY from: supabase.com → Project Settings → API → anon public
const SUPABASE_URL      = 'https://akkkrfvntbhnemjsejsr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFra2tyZnZudGJobmVtanNlanNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2Mzc1NjEsImV4cCI6MjA5NTIxMzU2MX0.h5r8JeqCcqG2wWOs0pzsQMJB_7DkpnHFCUdG_VmLvVU';


const WEBSITE_URL = 'https://echolocation.squarefire.com.mx';
const SERVER_WS   = 'wss://tetr-hakathon-production.up.railway.app/ws';
const APP_KEY     = 'tetr-secret-2024-xK9mPqR7';
const DEVICE_ID   = 'echo-chrome-' + Math.random().toString(36).slice(2, 6);
const SAMPLE_RATE = 16000;

const WAKE_WORD_REGEX  = /\becho\b/i;
const AWAKE_TIMEOUT_MS = 12000;
const FOLLOWUP_MS      = 10000;

// ── Auth state ────────────────────────────────────────────────────────────────
let currentUser = null;
let accessToken = null;

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

// ── Supabase auth calls ───────────────────────────────────────────────────────
async function supabaseLogin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

async function supabaseSignup(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

async function refreshAccessToken() {
  const saved = await new Promise(r => chrome.storage.local.get(['echoRefresh'], r));
  if (!saved.echoRefresh) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: saved.echoRefresh }),
    });
    const data = await res.json();
    if (data.access_token) {
      accessToken = data.access_token;
      if (data.user) currentUser = data.user;
      chrome.storage.local.set({ echoToken: accessToken, echoRefresh: data.refresh_token, echoUser: currentUser });
      return true;
    }
  } catch(e) {}
  return false;
}

async function checkSubscription(userId, token) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&status=eq.active&limit=1`,
    { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } }
  );
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return checkSubscription(currentUser.id, accessToken);
    return false;
  }
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

// ── Auth UI handlers ──────────────────────────────────────────────────────────
let authMode = 'login';

function switchTab(mode) {
  authMode = mode;
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-signup').classList.toggle('active', mode === 'signup');
  document.getElementById('auth-btn').textContent = mode === 'login' ? 'Sign In' : 'Create Account';
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  errEl.style.color = '';
}

async function handleAuth() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl    = document.getElementById('auth-error');
  const btn      = document.getElementById('auth-btn');

  if (!email || !password) { errEl.textContent = 'Please fill in all fields.'; return; }

  btn.disabled = true;
  btn.textContent = '…';
  errEl.textContent = '';

  try {
    const data = authMode === 'login'
      ? await supabaseLogin(email, password)
      : await supabaseSignup(email, password);

    if (data.error || data.error_description) {
      errEl.textContent = data.error_description || data.error || 'Something went wrong.';
      btn.disabled = false;
      btn.textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
      return;
    }

    // Supabase signup with email confirmation enabled — no session returned yet
    if (authMode === 'signup' && !data.access_token) {
      errEl.style.color = 'var(--eco)';
      errEl.textContent = 'Account created! Opening plans page…';
      btn.disabled = false;
      switchTab('login');
      chrome.tabs.create({ url: WEBSITE_URL });
      return;
    }

    accessToken = data.access_token;
    currentUser = data.user;

    // Save token + refresh token for next open
    chrome.storage.local.set({ echoToken: accessToken, echoRefresh: data.refresh_token, echoUser: currentUser });

    // Signup with immediate session (email confirmation disabled) — go buy a plan
    if (authMode === 'signup') {
      chrome.tabs.create({ url: WEBSITE_URL });
      showScreen('plans');
      return;
    }

    await proceedAfterLogin();
  } catch(e) {
    errEl.textContent = 'Connection error. Try again.';
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Sign In' : 'Create Account';
  }
}

async function proceedAfterLogin() {
  const active = await checkSubscription(currentUser.id, accessToken);
  if (active) {
    showScreen('app');
    connect();
  } else {
    showScreen('plans');
  }
}

async function checkAccessAndContinue() {
  if (!currentUser || !accessToken) return;
  const active = await checkSubscription(currentUser.id, accessToken);
  if (active) {
    showScreen('app');
    connect();
  } else {
    alert('No active subscription found yet. Please subscribe or wait a few minutes after payment.');
  }
}

function logout() {
  chrome.storage.local.remove(['echoToken', 'echoRefresh', 'echoUser']);
  currentUser = null; accessToken = null;
  if (ws) { try { ws.close(); } catch(e) {} ws = null; }
  showScreen('login');
}

// ── No-subscription screen ────────────────────────────────────────────────────
function openWebsite() {
  chrome.tabs.create({ url: WEBSITE_URL });
}

// ── Init — check saved token on open ─────────────────────────────────────────
async function initApp() {
  const saved = await new Promise(r => chrome.storage.local.get(['echoToken', 'echoUser', 'echoRefresh'], r));
  if (saved.echoToken && saved.echoUser) {
    accessToken = saved.echoToken;
    currentUser = saved.echoUser;
    // Try to use the saved token; if expired, refresh automatically
    await proceedAfterLogin();
  } else if (saved.echoRefresh) {
    // No token in storage but we have a refresh token — silently get a new access token
    const ok = await refreshAccessToken();
    if (ok) {
      await proceedAfterLogin();
    } else {
      chrome.storage.local.remove(['echoToken', 'echoRefresh', 'echoUser']);
      showScreen('login');
    }
  } else {
    showScreen('login');
  }
}

initApp();

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
let listening   = false;   // whether mic audio goes to WebSocket
let isAwake     = false;   // whether wake word has been detected
let isThinking  = false;   // whether server is processing a command
let awakeTimer  = null;    // timeout that puts Echo to sleep

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
    if (isAwake) {
      // Stay awake briefly for a follow-up command after Echo finishes speaking
      setStatus('listening', 'Listening…');
      scheduleAwakeTimeout(FOLLOWUP_MS);
    }
    return;
  }
  isSpeaking = true;
  pauseMic();
  setStatus('speaking', 'Speaking…');
  await playPcm(speechQueue.shift());
  // Natural breath between sentences (only if more chunks are queued)
  if (speechQueue.length > 0) await new Promise(r => setTimeout(r, 220));
  drainSpeechQueue();
}

// ── DOM ───────────────────────────────────────────────────────────────────────
const pill      = document.getElementById('pill');
const dot       = document.getElementById('dot');
const statusTxt = document.getElementById('statusTxt');
const micBtn    = document.getElementById('micBtn');
const ring      = document.getElementById('ring');
const convo     = document.getElementById('convo');
const tagline   = document.getElementById('tagline');
const hint      = document.getElementById('hint');
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
  d.innerHTML = `<div class="lbl">${role === 'user' ? 'You' : 'Echo'}</div>${text}`;
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

// ── Wake word detection (Web Speech API) ──────────────────────────────────────
let wakeRecognition = null;

function initWakeWordDetection() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.warn('[Echo] SpeechRecognition not available — always-on mode');
    wakeUp();
    return;
  }

  wakeRecognition = new SR();
  wakeRecognition.continuous     = true;
  wakeRecognition.interimResults = true;
  wakeRecognition.lang           = 'en-US';

  wakeRecognition.onresult = (event) => {
    if (isAwake) return; // already awake, Deepgram handles the rest
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (WAKE_WORD_REGEX.test(transcript)) {
        wakeUp();
        break;
      }
    }
  };

  wakeRecognition.onend = () => {
    // Auto-restart so it keeps listening even after a long pause
    if (!isAwake) {
      try { wakeRecognition.start(); } catch(e) {}
    }
  };

  wakeRecognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      console.warn('[Echo] Mic permission denied for wake word');
      return;
    }
    // Restart on transient errors
    setTimeout(() => {
      if (!isAwake) try { wakeRecognition.start(); } catch(e2) {}
    }, 500);
  };

  try { wakeRecognition.start(); } catch(e) {}
  goToSleep();
}

function wakeUp() {
  if (isAwake) {
    // Already awake — just reset the timeout
    scheduleAwakeTimeout(AWAKE_TIMEOUT_MS);
    return;
  }

  isAwake = true;

  // Stop wake word recognition while Deepgram handles everything
  try { wakeRecognition?.stop(); } catch(e) {}

  playActivationTone();
  startMic();
  scheduleAwakeTimeout(AWAKE_TIMEOUT_MS);
  hint.textContent = 'Say "Echo" again to give another command';
  tagline.textContent = 'Awake';
}

function goToSleep() {
  isAwake    = false;
  isThinking = false;
  clearTimeout(awakeTimer);
  awakeTimer = null;

  stopMicSilent(); // stop Deepgram mic, keep stream alive for wake word
  setStatus('sleeping', 'Sleeping…');
  animBars(false);
  tagline.textContent = 'Say Echo to wake me';
  hint.textContent = 'Say "Echo" to wake me up';

  // Restart wake word recognition
  setTimeout(() => {
    try { wakeRecognition?.start(); } catch(e) {}
  }, 300);
}

function scheduleAwakeTimeout(ms) {
  clearTimeout(awakeTimer);
  awakeTimer = setTimeout(() => {
    // If still busy (thinking, speaking, or speech queued), extend rather than sleep
    if (isThinking || isSpeaking || speechQueue.length > 0) {
      scheduleAwakeTimeout(ms);
      return;
    }
    goToSleep();
  }, ms);
}

// Two-note activation tone: 660 Hz → 880 Hz
function playActivationTone() {
  try {
    const ctx  = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.connect(ctx.destination);

    const playNote = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      osc.connect(gain);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };

    playNote(660, 0,    0.10);
    playNote(880, 0.12, 0.14);

    setTimeout(() => ctx.close(), 600);
  } catch(e) {}
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect() {
  if (ws && ws.readyState < 2) return; // already connected or connecting
  const url = `${SERVER_WS}?deviceId=${DEVICE_ID}&language=en&key=${APP_KEY}`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    setStatus('sleeping', 'Connected — say Echo');
    micBtn.disabled = false;
    // Start mic stream (needed for barge-in level detection) but don't send audio yet
    startMicStream();
    initWakeWordDetection();
    sendPageContext();
  };

  ws.onmessage = async (ev) => {
    if (typeof ev.data !== 'string') return;
    const msg = JSON.parse(ev.data);

    switch (msg.type) {
      case 'speech':
        isThinking = false;
        enqueueSpeech(msg.audio);
        break;

      case 'transcript':
        isThinking = true;
        interruptSpeech();
        addBubble('user', msg.text);
        setStatus('thinking', 'Thinking…');
        scheduleAwakeTimeout(AWAKE_TIMEOUT_MS);
        sendPageContext();
        break;

      case 'agent_text':
        isThinking = false;
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
        // Small delay so the page has a chance to paint before we capture
        setTimeout(sendPageContext, 500);
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
  if (isAwake) {
    goToSleep();
  } else {
    wakeUp();
  }
});

// Start mic hardware stream (for barge-in level detection) without sending audio to WS
async function startMicStream() {
  if (stream) return;
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
        if (!isAwake) wakeUp();
        return;
      }

      // While awake and user is talking, keep resetting the sleep timer
      if (isAwake && !isSpeaking && level > 0.02) {
        scheduleAwakeTimeout(AWAKE_TIMEOUT_MS);
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
  } catch (e) {
    console.error('Mic error:', e);
    setStatus('', 'Mic permission denied');
  }
}

async function startMic() {
  await startMicStream(); // ensure hardware stream is ready
  listening = true;
  micBtn.classList.add('active');
  micBtn.textContent = '⏹️';
  ring.classList.add('active');
  setStatus('listening', 'Listening…');
}

function pauseMic()  { listening = false; animBars(false); }
function resumeMic() { if (stream && isAwake) listening = true; }

// Stop sending audio to WS, but keep stream alive for barge-in + wake word level
function stopMicSilent() {
  listening = false;
  micBtn.classList.remove('active');
  micBtn.textContent = '🎙️';
  ring.classList.remove('active');
  animBars(false);
}

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
  setStatus('sleeping', 'Say Echo to wake me');
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
    const existing = tabs.find(t => t.url && t.url.startsWith(url.replace(/\/$/, '')));
    if (existing) {
      chrome.tabs.update(existing.id, { active: true });
      chrome.windows.update(existing.windowId, { focused: true });
      setTimeout(sendPageContext, 800);
    } else {
      chrome.tabs.create({ url });
      setTimeout(sendPageContext, 5000);
    }
  });
}

function navigateCurrentTab(url) {
  if (!url) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.update(tabs[0].id, { url });
    setTimeout(sendPageContext, 3500);
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

// connect() is called only from proceedAfterLogin() — never at startup

// ── Wire up all UI events (no inline onclick — blocked by extension CSP) ──────
document.getElementById('tab-login').addEventListener('click', () => switchTab('login'));
document.getElementById('tab-signup').addEventListener('click', () => switchTab('signup'));
document.getElementById('auth-btn').addEventListener('click', handleAuth);
document.getElementById('auth-email').addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
document.getElementById('auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
document.getElementById('btn-get-echo').addEventListener('click', openWebsite);
document.getElementById('already-link').addEventListener('click', checkAccessAndContinue);
document.getElementById('logout-link').addEventListener('click', logout);
