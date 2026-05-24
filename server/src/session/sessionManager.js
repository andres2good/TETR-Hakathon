/**
 * sessionManager.js — Maneja las sesiones activas de usuarios
 *
 * Cada usuario tiene su sesión con historial de conversación,
 * contexto de pantalla y pipeline de voz. Todo en memoria.
 */

import { v4 as uuidv4 } from 'uuid';
import { createDeepgramSession } from '../stt/deepgram.js';
import { generateResponse } from '../llm/claude.js';
import { detectSimpleIntent } from '../llm/intentDetector.js';
import { textToSpeech } from '../tts/cartesia.js';
import { upsertUser, saveSession, endSession, logAction } from '../storage/supabase.js';
import { WS_MESSAGES, SESSION, ACTIONS } from '../config/constants.js';
import { sessionLogger } from '../utils/logger.js';

// Mapa de sesiones activas: sessionId → estado
const activeSessions = new Map();

// Tiempo de espera tras ejecutar una acción para que la pantalla se actualice
const ACTION_SETTLE_MS = {
  open_app: 4000,      // pages need time to load
  navigate_to: 3000,   // navigation also needs time
  close_tab: 500,
  switch_tab: 600,
  new_tab: 1500,
  click: 900,
  set_text: 700,
  scroll_up: 350,
  scroll_down: 350,
  press_back: 800,
  press_home: 600,
  press_enter: 600,
  press_key: 400,
  clear_field: 200,
  request_screenshot: 1500,
  default: 600,
};

// ─── Crear sesión nueva ───────────────────────────────────────────────────────

export async function createSession({ ws, deviceId, language = 'en' }) {
  const sessionId = uuidv4();
  const log = sessionLogger(sessionId);

  log.info('[Session] Nueva sesión', { deviceId, language });

  const user = await upsertUser({ deviceId, language }).catch(() => null);
  await saveSession({ id: sessionId, userId: user?.id, startedAt: new Date().toISOString() }).catch(() => {});

  const session = {
    sessionId,
    ws,
    user,
    language,
    messages: [],
    lastUiTree: null,
    lastScreenshot: null,
    actionsCount: 0,
    isProcessing: false,
    generationId: 0,
    deepgram: null,
    startTime: Date.now(),
  };

  session.deepgram = createDeepgramSession({
    sessionId,
    language,
    onTranscript: (text) => handleUserSpeech(sessionId, text),
    onError: (err) => log.error('[Deepgram] Error', { error: err.message }),
  });

  activeSessions.set(sessionId, session);

  const greeting = language === 'es'
    ? `Hola${user?.name ? ', ' + user.name : ''}. Soy NAVI, tu asistente. ¿En qué te ayudo?`
    : `Hi${user?.name ? ', ' + user.name : ''}! I'm NAVI, what do you want to do today?`;

  await speakToUser(sessionId, greeting);

  log.info('[Session] Lista', { sessionId, userId: user?.id });
  return sessionId;
}

// ─── Manejar audio del usuario ────────────────────────────────────────────────

export function handleAudioChunk(sessionId, audioChunk) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  // Always send audio — lets user barge in at any time
  session.deepgram?.sendAudio(audioChunk);
}

// ─── Manejar UI tree ──────────────────────────────────────────────────────────

export function handleUiTree(sessionId, uiTree) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  session.lastUiTree = uiTree;
}

// ─── Manejar screenshot ───────────────────────────────────────────────────────

export function handleScreenshot(sessionId, screenshotBase64) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  session.lastScreenshot = screenshotBase64;
}

// ─── Procesar lo que dijo el usuario ─────────────────────────────────────────

async function handleUserSpeech(sessionId, text) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  // Interrupt any in-flight generation — bump the generation ID so stale callbacks bail out
  session.generationId++;
  const myGen = session.generationId;
  session.isProcessing = true;
  session.deepgram?.resetAccumulator();

  const log = sessionLogger(sessionId);
  log.info('[Session] Usuario dijo', { text, gen: myGen });

  sendToDevice(sessionId, WS_MESSAGES.TRANSCRIPT, { text });
  session.messages.push({ role: 'user', content: text });

  // Mantener historial acotado
  if (session.messages.length > SESSION.MAX_HISTORY * 2) {
    session.messages = session.messages.slice(-SESSION.MAX_HISTORY * 2);
  }

  try {
    // ─── Intento de intención simple primero (sin gastar tokens) ─────────────
    const simple = detectSimpleIntent(text);
    if (simple) {
      log.info('[Session] Intención simple detectada', simple);
      sendToDevice(sessionId, WS_MESSAGES.ACTION, { type: simple.action, ...simple.params });
      session.actionsCount++;

      const confirmations = {
        volume_up: language(session, 'Volumen subido', 'Volume up'),
        volume_down: language(session, 'Volumen bajado', 'Volume down'),
        press_home: language(session, 'Yendo al inicio', 'Going home'),
        press_back: language(session, 'Regresando', 'Going back'),
        scroll_up: language(session, 'Deslizando arriba', 'Scrolling up'),
        scroll_down: language(session, 'Deslizando abajo', 'Scrolling down'),
      };
      const confirmation = confirmations[simple.action] || language(session, 'Listo', 'Done');
      await speakToUser(sessionId, confirmation);
      session.messages.push({ role: 'assistant', content: confirmation });
      return;
    }

    // ─── Respuesta completa con Claude + loop de herramientas ─────────────────
    let agentText = '';      // current TTS buffer (reset after each spoken chunk)
    let fullAgentText = '';  // full text for history (never reset)
    const pendingActions = [];

    await generateResponse({
      sessionId,
      messages: session.messages,
      screenshot: null,          // Never auto-send — Claude uses the live UI tree instead.
      uiTree: session.lastUiTree, // Screenshots only arrive via explicit request_screenshot calls.
      language: session.language,
      userName: session.user?.name,

      onTextChunk: async (chunk) => {
        if (session.generationId !== myGen) return; // user interrupted
        agentText += chunk;
        fullAgentText += chunk;

        // Fire TTS only on sentence-ending punctuation followed by space or end-of-chunk.
        // Require minimum 12 chars to avoid firing on "Dr.", "3.5", etc.
        const endsWithSentence = /[.!?](\s|$)/.test(chunk) || /[.!?]$/.test(agentText.trim());
        if (endsWithSentence && agentText.trim().length >= 12) {
          const toSpeak = agentText.trim();
          agentText = '';
          await speakToUser(sessionId, toSpeak, myGen);
        }
      },

      // Herramienta — ejecutar en el celular y esperar
      onToolCall: async (toolName, toolInput, toolId) => {
        if (session.generationId !== myGen) return 'interrupted';
        const action = { type: toolName, ...toolInput };
        pendingActions.push(action);
        sendToDevice(sessionId, WS_MESSAGES.ACTION, action);
        session.actionsCount++;

        const wait = ACTION_SETTLE_MS[toolName] ?? ACTION_SETTLE_MS.default;
        await new Promise(r => setTimeout(r, wait));

        return { success: true, action: toolName };
      },

      // Devolver el estado más reciente de la pantalla después de cada acción
      getLatestScreenContext: async () => ({
        uiTree: session.lastUiTree,
        screenshot: session.lastScreenshot,
      }),
    });

    // Remaining text that didn't hit a sentence boundary
    if (agentText.trim()) {
      await speakToUser(sessionId, agentText.trim());
    }

    // Use full accumulated text for history; fall back to action list
    if (!fullAgentText.trim()) fullAgentText = pendingActions.map(a => a.type).join(', ');
    session.messages.push({ role: 'assistant', content: fullAgentText.trim() });

    await logAction({
      userId: session.user?.id,
      sessionId,
      userText: text,
      agentText: fullAgentText,
      action: pendingActions[0] || null,
    }).catch(() => {});

    // Limpiar screenshot — ya se usó en este turno
    session.lastScreenshot = null;

  } catch (error) {
    log.error('[Session] Error procesando', { error: error.message });
    const fallback = session.language === 'es'
      ? 'Tuve un problema. ¿Puedes repetir?'
      : 'I had an issue. Can you repeat that?';
    await speakToUser(sessionId, fallback);
  } finally {
    if (session.generationId === myGen) session.isProcessing = false;
  }
}

// ─── Helper de idioma ─────────────────────────────────────────────────────────

function language(session, es, en) {
  return session.language === 'es' ? es : en;
}

// ─── Hablarle al usuario ──────────────────────────────────────────────────────

async function speakToUser(sessionId, text, genId) {
  const session = activeSessions.get(sessionId);
  if (!session || !text?.trim()) return;
  if (genId !== undefined && session.generationId !== genId) return; // interrupted

  const log = sessionLogger(sessionId);

  // Always send text immediately — extension can speak it via browser TTS
  sendToDevice(sessionId, WS_MESSAGES.AGENT_TEXT, { text });

  try {
    const audio = await textToSpeech({ text, language: session.language, sessionId });
    if (audio) {
      // High-quality Cartesia audio — send it so extension upgrades to it
      sendToDevice(sessionId, WS_MESSAGES.SPEECH, { audio: audio.toString('base64') });
    }
  } catch (error) {
    log.debug('[Session] TTS no disponible, usando voz del navegador', { error: error.message });
  }
}

// ─── Enviar mensaje al dispositivo ───────────────────────────────────────────

function sendToDevice(sessionId, type, payload) {
  const session = activeSessions.get(sessionId);
  if (!session || session.ws.readyState !== 1) return;
  try {
    session.ws.send(JSON.stringify({ type, ...payload }));
  } catch (e) {
    sessionLogger(sessionId).error('[Session] Error enviando', { type, error: e.message });
  }
}

// ─── Terminar sesión ──────────────────────────────────────────────────────────

export async function closeSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  const log = sessionLogger(sessionId);
  log.info('[Session] Cerrando', { actionsCount: session.actionsCount, durationMs: Date.now() - session.startTime });

  session.deepgram?.close();
  activeSessions.delete(sessionId);

  await endSession({ id: sessionId, actionsCount: session.actionsCount }).catch(() => {});
}

export function getActiveSessionsCount() {
  return activeSessions.size;
}

export function getSessionByWs(ws) {
  for (const [id, session] of activeSessions.entries()) {
    if (session.ws === ws) return id;
  }
  return null;
}
