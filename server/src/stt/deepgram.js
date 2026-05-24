import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { env } from '../config/env.js';
import { sessionLogger } from '../utils/logger.js';

const deepgramClient = createClient(env.DEEPGRAM_API_KEY);

// Abre una sesión de transcripción en tiempo real para un usuario
export function createDeepgramSession({ sessionId, language = 'es', onTranscript, onError }) {
  const log = sessionLogger(sessionId);

  const connection = deepgramClient.listen.live({
    model: env.DEEPGRAM_MODEL,
    language,
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
    punctuate: true,
    interim_results: true,
    endpointing: 400,
    utterance_end_ms: 1200,   // Wait 1.2s of silence before declaring utterance done
    smart_format: true,
  });

  // Accumulate is_final chunks — fire only on UtteranceEnd so user isn't cut off mid-sentence
  let accumulated = '';

  connection.on(LiveTranscriptionEvents.Open, () => {
    log.info('[Deepgram] Sesión abierta');
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const text = data.channel?.alternatives?.[0]?.transcript || '';
    if (data.is_final && text.trim()) {
      accumulated += (accumulated ? ' ' : '') + text.trim();
    }
  });

  connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
    const text = accumulated.trim();
    accumulated = '';
    if (text.length > 1) {
      log.debug('[Deepgram] Utterance completa', { text });
      onTranscript(text);
    }
  });

  connection.on(LiveTranscriptionEvents.Error, (error) => {
    log.error('[Deepgram] Error', { error: error.message });
    onError?.(error);
  });

  // Keepalive every 8s so Deepgram doesn't drop the connection during processing
  const keepAliveInterval = setInterval(() => {
    if (connection.getReadyState() === 1) connection.keepAlive();
  }, 8000);

  return {
    sendAudio: (chunk) => {
      if (connection.getReadyState() === 1) connection.send(chunk);
    },
    resetAccumulator: () => { accumulated = ''; },
    close: () => {
      clearInterval(keepAliveInterval);
      connection.finish();
    },
    isOpen: () => connection.getReadyState() === 1,
  };
}
