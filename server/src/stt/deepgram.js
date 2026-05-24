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
    encoding: 'linear16',     // Audio PCM desde Android
    sample_rate: 16000,        // 16kHz — calidad óptima para reconocimiento de voz
    channels: 1,
    punctuate: true,
    interim_results: true,
    endpointing: 400,          // Detecta fin de enunciado tras 400ms de silencio
    smart_format: true,
  });

  connection.on(LiveTranscriptionEvents.Open, () => {
    log.info('[Deepgram] Sesión abierta');
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const text = data.channel?.alternatives?.[0]?.transcript || '';
    const isFinal = data.speech_final;

    if (isFinal && text.trim().length > 1) {
      log.debug('[Deepgram] Transcripción', { text });
      onTranscript(text.trim());
    }
  });

  connection.on(LiveTranscriptionEvents.Error, (error) => {
    log.error('[Deepgram] Error', { error: error.message });
    onError?.(error);
  });

  return {
    sendAudio: (chunk) => {
      if (connection.getReadyState() === 1) connection.send(chunk);
    },
    close: () => connection.finish(),
    isOpen: () => connection.getReadyState() === 1,
  };
}
