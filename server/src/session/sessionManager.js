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
  open_app: 1500,
  click: 600,
  set_text: 400,
  scroll_up: 300,
  scroll_down: 300,
  press_back: 500,
  press_home: 500,
  request_screenshot: 800,
  default: 400,
};

// ─── Crear sesión nueva ───────────────────────────────────────────────────────

export async function createSession({ ws, deviceId, language = 'es' }) {
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
    ? `Hola${user?.name ? ', ' + user.name : ''}. Soy TETR, tu asistente. ¿En qué te ayudo?`
    : `Hi${user?.name ? ', ' + user.name : ''}. I'm TETR, your assistant. How can I help?`;

  await speakToUser(sessionId, greeting);

  log.info('[Session] Lista', { sessionId, userId: user?.id });
  return sessionId;
}

// ─── Manejar audio del usuario ────────────────────────────────────────────────

export function handleAudioChunk(sessionId, audioChunk) {
  const session = activeSessions.get(sessionId);
  if (!session || session.isProcessing) return;
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
  if (!session || session.isProcessing) return;

  const log = sessionLogger(sessionId);
  log.info('[Session] Usuario dijo', { text });

  session.isProcessing = true;
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
    let agentText = '';
    const pendingActions = [];

    await generateResponse({
      sessionId,
      messages: session.messages,
      screenshot: session.lastScreenshot,
      uiTree: session.lastUiTree,
      language: session.language,
      userName: session.user?.name,

      // Texto en stream — hablar por oraciones para reducir latencia
      onTextChunk: async (chunk) => {
        agentText += chunk;
        if (/[.!?]/.test(chunk) && agentText.length > 10) {
          await speakToUser(sessionId, agentText);
          agentText = '';
        }
      },

      // Herramienta — ejecutar en el celular y esperar
      onToolCall: async (toolName, toolInput, toolId) => {
        const action = { type: toolName, ...toolInput };
        pendingActions.push(action);
        sendToDevice(sessionId, WS_MESSAGES.ACTION, action);
        session.actionsCount++;

        // Esperar a que la pantalla se actualice
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

    // Texto sobrante
    if (agentText.trim()) {
      await speakToUser(sessionId, agentText.trim());
    }

    // Guardar en historial
    const fullAgentText = agentText || pendingActions.map(a => a.type).join(', ');
    session.messages.push({ role: 'assistant', content: fullAgentText });

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
    session.isProcessing = false;
  }
}

// ─── Helper de idioma ─────────────────────────────────────────────────────────

function language(session, es, en) {
  return session.language === 'es' ? es : en;
}

// ─── Hablarle al usuario ──────────────────────────────────────────────────────

async function speakToUser(sessionId, text) {
  const session = activeSessions.get(sessionId);
  if (!session || !text?.trim()) return;

  const log = sessionLogger(sessionId);
  try {
    const audio = await textToSpeech({ text, language: session.language, sessionId });
    if (audio) {
      sendToDevice(sessionId, WS_MESSAGES.SPEECH, { audio: audio.toString('base64') });
      sendToDevice(sessionId, WS_MESSAGES.AGENT_TEXT, { text });
    }
  } catch (error) {
    log.error('[Session] Error TTS', { error: error.message });
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
