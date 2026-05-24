/**
 * Detecta la intención del usuario antes de llamar a Claude.
 * Para comandos simples (subir volumen, ir a inicio) no necesitamos gastar tokens.
 */

const SIMPLE_INTENTS = [
  { patterns: [/sube el volumen/i, /más volumen/i, /volume up/i], action: 'volume_up', params: { steps: 3 } },
  { patterns: [/baja el volumen/i, /menos volumen/i, /volume down/i], action: 'volume_down', params: { steps: 3 } },
  { patterns: [/inicio|pantalla principal|home screen/i, /^(?:ir al?|volver al?) inicio/i], action: 'press_home', params: {} },
  { patterns: [/volver|regresar|atrás|go back/i], action: 'press_back', params: {} },
  { patterns: [/scroll (arriba|hacia arriba)|desliza arriba/i], action: 'scroll_up', params: {} },
  { patterns: [/scroll (abajo|hacia abajo)|desliza abajo/i], action: 'scroll_down', params: {} },
];

/**
 * Devuelve una acción directa si el texto es un comando simple,
 * o null si necesita pasar por Claude.
 */
export function detectSimpleIntent(text) {
  const normalized = text.trim().toLowerCase();
  for (const intent of SIMPLE_INTENTS) {
    if (intent.patterns.some(p => p.test(normalized))) {
      return { action: intent.action, params: intent.params };
    }
  }
  return null;
}
