import { env } from '../config/env.js';
import { withRetry } from '../utils/retry.js';
import { sessionLogger } from '../utils/logger.js';

const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';

// Convierte texto a audio y devuelve el buffer
export async function textToSpeech({ text, language = 'es', sessionId }) {
  const log = sessionLogger(sessionId);

  if (!text?.trim()) return null;

  return await withRetry(async () => {
    const start = Date.now();

    const response = await fetch(CARTESIA_URL, {
      method: 'POST',
      headers: {
        'X-API-Key': env.CARTESIA_API_KEY,
        'Cartesia-Version': '2024-06-10',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: env.CARTESIA_MODEL,
        transcript: text.trim(),
        voice: { mode: 'id', id: env.CARTESIA_VOICE_ID },
        language,
        output_format: {
          container: 'raw',
          encoding: 'pcm_s16le',  // PCM 16-bit — compatible con Android AudioTrack
          sample_rate: 24000,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw Object.assign(new Error(`Cartesia ${response.status}: ${err}`), { status: response.status });
    }

    const audio = Buffer.from(await response.arrayBuffer());
    log.debug('[Cartesia] Audio generado', { chars: text.length, bytes: audio.length, ms: Date.now() - start });
    return audio;

  }, { name: 'Cartesia TTS' });
}
