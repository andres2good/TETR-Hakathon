import logger from './logger.js';

export async function withRetry(fn, { name = 'operación', maxAttempts = 3, initialDelayMs = 800 } = {}) {
  let delay = initialDelayMs;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;

      // Rate limit (429) or overloaded (529) — wait longer before retry
      const isRateLimit = error.status === 429 || error.status === 529;
      const waitMs = isRateLimit ? Math.max(delay, 3000) : delay;

      logger.warn(`[Retry] ${name} falló (intento ${attempt}/${maxAttempts}), reintentando en ${waitMs}ms`, {
        error: error.message,
        status: error.status,
      });
      await new Promise(r => setTimeout(r, waitMs));
      delay *= 2;
    }
  }

  logger.error(`[Retry] ${name} falló definitivamente`, { error: lastError.message, status: lastError.status });
  throw lastError;
}
