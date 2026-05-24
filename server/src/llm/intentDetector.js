/**
 * Detects simple intents before calling Claude.
 * For one-word commands we don't need to spend tokens.
 */

const SIMPLE_INTENTS = [
  { patterns: [/\b(volume up|louder|raise volume|turn up)\b/i, /\b(sube el volumen|más volumen)\b/i], action: 'volume_up', params: { steps: 3 } },
  { patterns: [/\b(volume down|quieter|lower volume|turn down)\b/i, /\b(baja el volumen|menos volumen)\b/i], action: 'volume_down', params: { steps: 3 } },
  { patterns: [/\b(scroll up|page up|swipe up)\b/i, /\b(desliza arriba|scroll arriba)\b/i], action: 'scroll_up', params: {} },
  { patterns: [/\b(scroll down|page down|swipe down)\b/i, /\b(desliza abajo|scroll abajo)\b/i], action: 'scroll_down', params: {} },
  { patterns: [/^(go back|back|press back|volver|regresar|atrás)$/i], action: 'press_back', params: {} },
  { patterns: [/^(close tab|close this tab|cierra la pestaña|cierra esta pestaña)$/i], action: 'close_tab', params: {} },
];

/**
 * Returns a direct action if text is a simple command, otherwise null.
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
