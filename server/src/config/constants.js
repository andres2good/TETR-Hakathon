// Límites de sesión
export const SESSION = {
  MAX_DURATION_MS:     30 * 60 * 1000,  // 30 minutos máximo por sesión
  SILENCE_TIMEOUT_MS:  10 * 1000,        // 10 segundos sin hablar → pregunta si sigue ahí
  MAX_HISTORY:         20,               // Máximo de turnos a recordar en la conversación
};

// Pipeline de voz
export const PIPELINE = {
  MAX_LATENCY_MS:      1000,             // Latencia máxima aceptable end-to-end
  MIN_TEXT_LENGTH:     2,                // Mínimo de caracteres para procesar
};

// Acciones que puede ejecutar en Android
export const ACTIONS = {
  CLICK:        'click',          // Tocar un elemento
  SET_TEXT:     'set_text',       // Escribir texto en un campo
  SCROLL_UP:    'scroll_up',      // Deslizar hacia arriba
  SCROLL_DOWN:  'scroll_down',    // Deslizar hacia abajo
  SWIPE_LEFT:   'swipe_left',
  SWIPE_RIGHT:  'swipe_right',
  OPEN_APP:     'open_app',       // Abrir una app por nombre
  PRESS_BACK:   'press_back',     // Botón atrás
  PRESS_HOME:   'press_home',     // Botón inicio
  VOLUME_UP:    'volume_up',
  VOLUME_DOWN:  'volume_down',
  SCREENSHOT:   'request_screenshot', // Pedirle al dispositivo una captura
};

// Tipos de mensajes WebSocket entre app Android y backend
export const WS_MESSAGES = {
  // Android → Backend
  AUDIO_CHUNK:   'audio_chunk',    // Chunk de audio del micrófono
  SCREENSHOT:    'screenshot',      // Captura de pantalla en base64
  UI_TREE:       'ui_tree',         // Lista de elementos de la pantalla
  SESSION_START: 'session_start',   // Iniciar sesión
  SESSION_END:   'session_end',     // Terminar sesión

  // Backend → Android
  SPEECH:        'speech',          // Audio de respuesta en base64
  ACTION:        'action',          // Acción a ejecutar en el dispositivo
  TRANSCRIPT:    'transcript',      // Texto de lo que dijo el usuario (para debug)
  AGENT_TEXT:    'agent_text',      // Texto de lo que dice el agente (para debug)
  ERROR:         'error',           // Error a mostrar al usuario
};
