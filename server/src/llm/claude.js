import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { buildSystemPrompt } from './prompts/systemPrompt.js';
import { sessionLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { ACTIONS } from '../config/constants.js';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// Herramientas que Claude puede usar para controlar el celular
const TOOLS = [
  {
    name: 'click',
    description: 'Toca un elemento en la pantalla por su texto o descripción.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Texto o descripción del elemento a tocar. Ej: "botón Enviar", "chat de María"' },
      },
      required: ['target'],
    },
  },
  {
    name: 'set_text',
    description: 'Escribe texto en el campo actualmente seleccionado o en un campo específico.',
    input_schema: {
      type: 'object',
      properties: {
        text:   { type: 'string', description: 'Texto a escribir' },
        target: { type: 'string', description: 'Campo donde escribir (opcional, si no hay uno seleccionado)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'scroll_up',
    description: 'Desliza la pantalla hacia arriba.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'scroll_down',
    description: 'Desliza la pantalla hacia abajo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'open_app',
    description: 'Abre una aplicación instalada en el celular.',
    input_schema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Nombre de la app. Ej: "WhatsApp", "Spotify", "YouTube", "Teléfono", "Cámara"' },
      },
      required: ['appName'],
    },
  },
  {
    name: 'press_back',
    description: 'Presiona el botón de retroceso (volver atrás).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'press_home',
    description: 'Va a la pantalla de inicio del celular.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'volume_up',
    description: 'Sube el volumen del celular.',
    input_schema: {
      type: 'object',
      properties: {
        steps: { type: 'number', description: 'Cuántos pasos subir (default: 2)' },
      },
    },
  },
  {
    name: 'volume_down',
    description: 'Baja el volumen del celular.',
    input_schema: {
      type: 'object',
      properties: {
        steps: { type: 'number', description: 'Cuántos pasos bajar (default: 2)' },
      },
    },
  },
  {
    name: 'request_screenshot',
    description: 'Pide una captura de pantalla actualizada para ver mejor qué hay en la pantalla.',
    input_schema: { type: 'object', properties: {} },
  },
];

// Genera la respuesta del agente dado el contexto de la conversación
export async function generateResponse({
  sessionId,
  messages,
  screenshot,      // base64 de la pantalla actual (opcional)
  uiTree,          // descripción en texto de los elementos de la pantalla
  language,
  userName,
  onTextChunk,
  onToolCall,
}) {
  const log = sessionLogger(sessionId);

  // Construir el mensaje del usuario enriquecido con contexto de pantalla
  const lastMessages = [...messages];
  const lastUserMsg = lastMessages[lastMessages.length - 1];

  // Si hay contexto de pantalla, lo agregamos al último mensaje del usuario
  if (lastUserMsg?.role === 'user' && (uiTree || screenshot)) {
    const screenContext = buildScreenContext(uiTree, screenshot);
    if (Array.isArray(lastUserMsg.content)) {
      lastUserMsg.content.push({ type: 'text', text: screenContext });
    } else {
      lastUserMsg.content = [
        { type: 'text', text: lastUserMsg.content },
        { type: 'text', text: screenContext },
      ];
      // Si hay screenshot, agregarlo como imagen
      if (screenshot) {
        lastUserMsg.content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: screenshot },
        });
      }
    }
  }

  log.debug('[Claude] Generando respuesta', { messageCount: messages.length, hasScreenshot: !!screenshot });

  return await withRetry(async () => {
    let fullResponse = '';
    let pendingToolCall = null;

    const stream = anthropic.messages.stream({
      model: env.CLAUDE_MODEL,
      max_tokens: 512,
      temperature: 0.3,
      system: [{ type: 'text', text: buildSystemPrompt({ language, userName }), cache_control: { type: 'ephemeral' } }],
      messages: lastMessages,
      tools: TOOLS,
    });

    for await (const event of stream) {
      // Chunk de texto — hablar mientras genera
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullResponse += event.delta.text;
        onTextChunk?.(event.delta.text);
      }

      // Claude empieza a llamar una herramienta
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        pendingToolCall = { id: event.content_block.id, name: event.content_block.name, inputBuffer: '' };
      }

      // Acumulando argumentos de la herramienta
      if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta' && pendingToolCall) {
        pendingToolCall.inputBuffer += event.delta.partial_json;
      }

      // Herramienta completa — ejecutar
      if (event.type === 'content_block_stop' && pendingToolCall) {
        try {
          const input = JSON.parse(pendingToolCall.inputBuffer || '{}');
          log.info('[Claude] Herramienta', { name: pendingToolCall.name, input });
          await onToolCall?.(pendingToolCall.name, input, pendingToolCall.id);
        } catch (e) {
          log.error('[Claude] Error parseando herramienta', { error: e.message });
        }
        pendingToolCall = null;
      }
    }

    return fullResponse;
  }, { name: 'Claude API', maxAttempts: 2 });
}

// Construye el contexto de pantalla para Claude
function buildScreenContext(uiTree, screenshot) {
  const parts = ['\n\n--- CONTEXTO DE PANTALLA ACTUAL ---'];
  if (uiTree) parts.push(`UI Elements:\n${uiTree}`);
  if (!uiTree && screenshot) parts.push('(Ver imagen adjunta)');
  parts.push('--- FIN DE CONTEXTO ---');
  return parts.join('\n');
}
