/**
 * sessionManager.js — Maneja las sesiones activas de usuarios
 *
 * Cada usuario conectado tiene una sesión con su historial de conversación,
 * su contexto de pantalla actual y su pipeline de voz.
 * Todo vive en memoria — cuando el usuario desconecta, se limpia.
 */

import { v4 as uuidv4 } from 'uuid';
import { createDeepgramSession } from '../stt/deepgram.js';
import { generateResponse } from '../llm/claude.js';
import { textToSpeech } from '../tts/cartesia.js';
import { upsertUser, saveSession, endSession, logAction } from '../storage/supabase.js';
import { WS_MESSAGES, SESSION, ACTIONS } from '../config/constants.js';
import { sessionLogger } from '../utils/logger.js';

// Mapa de sesiones activas: sessionId → estado
const activeSessions = new Map();

// ─── Crear sesión nueva ───────────────────────────────────────────────────────

export async function createSession({ ws, deviceId, language = 'es' }) {
  const sessionId = uuidv4();
  const log = sessionLogger(sessionId);

  log.info('[Session] Nueva sesión', { deviceId, language });

  // Obtener o crear usuario en Supabase
  const user = await upsertUser({ deviceId, language }).catch(() => null);

  // Guardar sesión en Supabase
  await saveSession({ id: sessionId, userId: user?.id, startedAt: new Date().toISOString() }).catch(() => {});

  const session = {
    sessionId,
    ws,
    user,
    language,
    messages: [],         // Historial de conversación para Claude
    lastUiTree: null,     // Último UI tree recibido del dispositivo
    lastScreenshot: null, // Último screenshot recibido
    actionsCount: 0,
    isProcessing: false,
    deepgram: null,
    startTime: Date.now(),
  };

  // Iniciar Deepgram
  session.deepgram = createDeepgramSession({
    sessionId,
    language,
    onTranscript: (text) => handleUserSpeech(sessionId, text),
    onError: (err) => log.error('[Deepgram] Error', { error: err.message }),
  });

  activeSessions.set(sessionId, session);

  // Saludo inicial
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

// ─── Manejar UI tree recibido del dispositivo ─────────────────────────────────

export function handleUiTree(sessionId, uiTree) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  session.lastUiTree = uiTree;
}

// ─── Manejar screenshot recibido del dispositivo ──────────────────────────────

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

  // Enviar transcripción a la app (para mostrar en pantalla si quieren)
  sendToDevice(sessionId, WS_MESSAGES.TRANSCRIPT, { text });

  // Agregar al historial
  session.messages.push({ role: 'user', content: text });

  // Mantener historial acotado
  if (session.messages.length > SESSION.MAX_HISTORY * 2) {
    session.messages = session.messages.slice(-SESSION.MAX_HISTORY * 2);
  }

  try {
    let agentText = '';
    const pendingActions = [];

    await generateResponse({
      sessionId,
      messages: session.messages,
      screenshot: session.lastScreenshot,
      uiTree: session.lastUiTree,
      language: session.language,
      userName: session.user?.name,

      // Cada chunk de texto — convertir a audio y enviar
      onTextChunk: async (chunk) => {
        agentText += chunk;
        // Hablar por oraciones para reducir latencia
        if (/[.!?]/.test(chunk) && agentText.length > 10) {
          await speakToUser(sessionId, agentText);
          agentText = '';
        }
      },

      // Claude quiere ejecutar una acción en el dispositivo
      onToolCall: async (toolName, toolInput, toolId) => {
        const action = { type: toolName, ...toolInput };
        pendingActions.push(action);

        // Enviar la acción al dispositivo Android para ejecutarla
        sendToDevice(sessionId, WS_MESSAGES.ACTION, action);
        session.actionsCount++;

        // Si Claude pide screenshot, esperar un momento para recibirlo
        if (toolName === ACTIONS.SCREENSHOT) {
          await new Promise(r => setTimeout(r, 800));
        }

        return { success: true, action: toolName };
      },
    });

    // Hablar lo que quedó pendiente
    if (agentText.trim()) {
      await speakToUser(sessionId, agentText.trim());
    }

    // Guardar en historial y Supabase
    const fullAgentText = session.messages[session.messages.length - 1]?.content || agentText;
    session.messages.push({ role: 'assistant', content: fullAgentText });

    await logAction({
      userId: session.user?.id,
      sessionId,
      userText: text,
      agentText: fullAgentText,
      action: pendingActions[0] || null,
    }).catch(() => {});

    // Limpiar screenshot después de usarlo (para no mandarlo en cada turno)
    session.lastScreenshot = null;

  } catch (error) {
    log.error('[Session] Error procesando', { error: error.message });
    const fallback = session.language === 'es'
      ? 'Tuve un problema. ¿Puedes repetir lo que dijiste?'
      : 'I had an issue. Can you repeat that?';
    await speakToUser(sessionId, fallback);
  } finally {
    session.isProcessing = false;
  }
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
    sessionLogger(sessionId).error('[Session] Error enviando mensaje', { type, error: e.message });
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

// Encontrar sessionId a partir del WebSocket
export function getSessionByWs(ws) {
  for (const [id, session] of activeSessions.entries()) {
    if (session.ws === ws) return id;
  }
  return null;
}
