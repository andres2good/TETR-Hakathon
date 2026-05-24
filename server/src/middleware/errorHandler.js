import logger from '../utils/logger.js';
import { env } from '../config/env.js';

export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  logger.error('[Error]', { message: err.message, status, path: req.path });
  res.status(status).json({
    error: env.IS_PRODUCTION ? 'Error del servidor' : err.message,
  });
}

export function notFound(req, res) {
  res.status(404).json({ error: `Ruta no encontrada: ${req.path}` });
}

export function setupProcessErrorHandlers() {
  process.on('unhandledRejection', (reason) => {
    logger.error('[Process] Promise sin manejar', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('[Process] Excepción no capturada', { message: error.message });
    process.exit(1);
  });
  process.on('SIGTERM', () => { logger.info('[Process] Cerrando...'); process.exit(0); });
  process.on('SIGINT',  () => { logger.info('[Process] Cerrando...'); process.exit(0); });
}
