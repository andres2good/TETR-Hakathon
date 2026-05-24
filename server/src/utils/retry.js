import logger from './logger.js';

// Reintenta una función async con backoff exponencial
// Si falla 3 veces, lanza el error
export async function withRetry(fn, { name = 'operación', maxAttempts = 3, initialDelayMs = 500 } = {}) {
  let delay = initialDelayMs;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      logger.warn(`[Retry] ${name} falló (intento ${attempt}/${maxAttempts}), reintentando en ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }

  logger.error(`[Retry] ${name} falló definitivamente`, { error: lastError.message });
  throw lastError;
}
