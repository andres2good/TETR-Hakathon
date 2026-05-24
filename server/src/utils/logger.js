import winston from 'winston';
import { env } from '../config/env.js';

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message}${metaStr}`;
  })
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  transports: [
    new winston.transports.Console({
      format: env.IS_PRODUCTION ? prodFormat : devFormat,
    }),
  ],
});

// Helper para logs con sessionId
export function sessionLogger(sessionId) {
  return {
    info:  (msg, meta = {}) => logger.info(msg, { sessionId, ...meta }),
    warn:  (msg, meta = {}) => logger.warn(msg, { sessionId, ...meta }),
    error: (msg, meta = {}) => logger.error(msg, { sessionId, ...meta }),
    debug: (msg, meta = {}) => logger.debug(msg, { sessionId, ...meta }),
  };
}

export default logger;
