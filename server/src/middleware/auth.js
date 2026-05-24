import { env } from '../config/env.js';
import logger from '../utils/logger.js';

// Verifica que la app Android que se conecta tenga la clave correcta
// La app manda la clave como query param: wss://servidor/ws?key=APP_SECRET_KEY
export function verifyAppKey(req) {
  const key = new URL(req.url, 'http://localhost').searchParams.get('key');
  if (!key || key !== env.APP_SECRET_KEY) {
    logger.warn('[Auth] Conexión rechazada — clave incorrecta', { ip: req.socket.remoteAddress });
    return false;
  }
  return true;
}
