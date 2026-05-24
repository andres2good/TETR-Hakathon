import { env } from '../config/env.js';
import logger from '../utils/logger.js';

// Verifica que la app Android que se conecta tenga la clave correcta.
// La app puede mandarla de dos formas (soportamos ambas):
//   - Header:     X-App-Key: <clave>
//   - Query param: wss://servidor/ws?key=<clave>
export function verifyAppKey(req) {
  const headerKey = req.headers['x-app-key'];
  const queryKey  = new URL(req.url, 'http://localhost').searchParams.get('key');
  const key = headerKey || queryKey;

  if (!key || key !== env.APP_SECRET_KEY) {
    logger.warn('[Auth] Conexión rechazada — clave incorrecta', { ip: req.socket.remoteAddress });
    return false;
  }
  return true;
}
