import { env } from './config/env.js';

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import cors from 'cors';

import logger from './utils/logger.js';
import { errorHandler, notFound, setupProcessErrorHandlers } from './middleware/errorHandler.js';
import { verifyAppKey } from './middleware/auth.js';
import {
  createSession,
  handleAudioChunk,
  handleUiTree,
  handleScreenshot,
  closeSession,
  getSessionByWs,
  getActiveSessionsCount,
} from './session/sessionManager.js';
import { WS_MESSAGES } from './config/constants.js';

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    activeSessions: getActiveSessionsCount(),
    timestamp: new Date().toISOString(),
  });
});

app.use(notFound);
app.use(errorHandler);

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', async (ws, req) => {
  // Verificar que la app tenga la clave correcta
  if (!verifyAppKey(req)) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  // Leer parámetros de conexión
  const url = new URL(req.url, 'http://localhost');
  const deviceId = url.searchParams.get('deviceId') || `anon-${Date.now()}`;
  const language  = url.searchParams.get('language') || 'es';

  logger.info('[WS] Nueva conexión', { deviceId, language });

  // Crear sesión — esto inicia Deepgram y manda el saludo
  const sessionId = await createSession({ ws, deviceId, language }).catch(err => {
    logger.error('[WS] Error creando sesión', { error: err.message });
    ws.close(1011, 'Error iniciando sesión');
    return null;
  });

  if (!sessionId) return;

  // ─── Mensajes entrantes del dispositivo Android ───────────────────────────

  ws.on('message', (data) => {
    try {
      // Intentar parsear como JSON primero (mensajes de control)
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case WS_MESSAGES.UI_TREE:
          // Android manda la lista de elementos de la pantalla
          handleUiTree(sessionId, msg.uiTree);
          break;

        case WS_MESSAGES.SCREENSHOT:
          // Android manda captura de pantalla en base64
          handleScreenshot(sessionId, msg.data);
          break;

        case WS_MESSAGES.SESSION_END:
          closeSession(sessionId);
          ws.close();
          break;

        default:
          logger.debug('[WS] Mensaje desconocido', { type: msg.type });
      }

    } catch {
      // No es JSON — es audio crudo (Buffer de PCM)
      handleAudioChunk(sessionId, data);
    }
  });

  // ─── Desconexión ──────────────────────────────────────────────────────────

  ws.on('close', () => {
    logger.info('[WS] Desconexión', { sessionId });
    closeSession(sessionId);
  });

  ws.on('error', (error) => {
    logger.error('[WS] Error', { sessionId, error: error.message });
    closeSession(sessionId);
  });
});

// ─── Arrancar ─────────────────────────────────────────────────────────────────

setupProcessErrorHandlers();

httpServer.listen(env.PORT, () => {
  logger.info('✓ Servidor TETR corriendo', {
    port: env.PORT,
    environment: env.NODE_ENV,
    wsUrl: `ws://localhost:${env.PORT}/ws`,
    health: `http://localhost:${env.PORT}/health`,
  });
});
