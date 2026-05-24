import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { buildSystemPrompt } from './prompts/systemPrompt.js';
import { sessionLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const MAX_TOOL_ITERATIONS = 8; // Máximo de acciones por turno

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

/**
 * Genera la respuesta del agente con loop completo de herramientas.
 *
 * El ciclo correcto de tool use de Anthropic:
 *   1. Mandamos mensajes → Claude responde con tool_use
 *   2. Ejecutamos la herramienta en el celular
 *   3. Esperamos que la pantalla cambie
 *   4. Mandamos tool_result con la nueva pantalla
 *   5. Claude continúa → puede usar más herramientas o dar respuesta final
 *   6. Repetir hasta que Claude dé respuesta de texto o alcancemos MAX_TOOL_ITERATIONS
 */
export async function generateResponse({
  sessionId,
  messages,
  screenshot,
  uiTree,
  language,
  userName,
  onTextChunk,
  onToolCall,
  getLatestScreenContext, // función que devuelve { uiTree, screenshot } actualizado
}) {
  const log = sessionLogger(sessionId);

  // Construir el mensaje del usuario enriquecido con contexto de pantalla
  const workingMessages = [...messages];
  const lastUserMsg = workingMessages[workingMessages.length - 1];

  if (lastUserMsg?.role === 'user' && (uiTree || screenshot)) {
    attachScreenContext(lastUserMsg, uiTree, screenshot);
  }

  log.debug('[Claude] Generando respuesta', { messageCount: messages.length, hasScreenshot: !!screenshot });

  return await withRetry(async () => {
    let finalText = '';
    let iterations = 0;

    // ─── Loop de herramientas ─────────────────────────────────────────────────
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const { text, toolCalls, stopReason } = await streamOneTurn({
        log,
        messages: workingMessages,
        language,
        userName,
        onTextChunk,
      });

      if (text) finalText += text;

      // Sin herramientas — Claude terminó
      if (stopReason === 'end_turn' || toolCalls.length === 0) {
        log.debug('[Claude] Respuesta final', { iterations, chars: finalText.length });
        break;
      }

      // ─── Ejecutar herramientas y recopilar resultados ─────────────────────
      const toolResults = [];

      for (const tool of toolCalls) {
        log.info('[Claude] Herramienta', { name: tool.name, input: tool.input, iteration: iterations });

        let result = 'ok';
        try {
          result = await onToolCall?.(tool.name, tool.input, tool.id) ?? 'ok';
        } catch (e) {
          result = `error: ${e.message}`;
          log.error('[Claude] Herramienta falló', { name: tool.name, error: e.message });
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }

      // ─── Agregar la respuesta de Claude + resultados al historial ─────────
      // (Anthropic requiere que el historial incluya el mensaje del asistente con tool_use)
      workingMessages.push({
        role: 'assistant',
        content: [
          ...(text ? [{ type: 'text', text }] : []),
          ...toolCalls.map(t => ({
            type: 'tool_use',
            id: t.id,
            name: t.name,
            input: t.input,
          })),
        ],
      });

      // Agregar estado actualizado de pantalla a los tool_results
      const latestContext = await getLatestScreenContext?.();
      if (latestContext) {
        const screenText = buildScreenContext(latestContext.uiTree, latestContext.screenshot);
        // Adjuntar contexto al primer tool_result
        toolResults[0].content += `\n\n${screenText}`;

        if (latestContext.screenshot) {
          toolResults[0].content = [
            { type: 'text', text: toolResults[0].content },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: latestContext.screenshot } },
          ];
        }
      }

      workingMessages.push({ role: 'user', content: toolResults });

      // Si stop_reason fue tool_use, continuamos el loop
      if (stopReason !== 'tool_use') break;
    }

    if (iterations >= MAX_TOOL_ITERATIONS) {
      log.warn('[Claude] Alcanzó límite de iteraciones', { max: MAX_TOOL_ITERATIONS });
    }

    return finalText;
  }, { name: 'Claude API', maxAttempts: 2 });
}

// ─── Un turno del stream ──────────────────────────────────────────────────────

async function streamOneTurn({ log, messages, language, userName, onTextChunk }) {
  let text = '';
  let stopReason = 'end_turn';
  const toolCalls = [];
  let pendingTool = null;

  const stream = anthropic.messages.stream({
    model: env.CLAUDE_MODEL,
    max_tokens: 1024,
    temperature: 0.3,
    system: [{ type: 'text', text: buildSystemPrompt({ language, userName }), cache_control: { type: 'ephemeral' } }],
    messages,
    tools: TOOLS,
    tool_choice: { type: 'auto' },
  });

  for await (const event of stream) {
    if (event.type === 'message_delta' && event.delta?.stop_reason) {
      stopReason = event.delta.stop_reason;
    }

    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text;
      onTextChunk?.(event.delta.text);
    }

    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
      pendingTool = { id: event.content_block.id, name: event.content_block.name, inputBuffer: '' };
    }

    if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta' && pendingTool) {
      pendingTool.inputBuffer += event.delta.partial_json;
    }

    if (event.type === 'content_block_stop' && pendingTool) {
      try {
        pendingTool.input = JSON.parse(pendingTool.inputBuffer || '{}');
        toolCalls.push(pendingTool);
      } catch (e) {
        log.error('[Claude] Error parseando input de herramienta', { error: e.message });
      }
      pendingTool = null;
    }
  }

  return { text, toolCalls, stopReason };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function attachScreenContext(userMsg, uiTree, screenshot) {
  const screenContext = buildScreenContext(uiTree, screenshot);
  if (Array.isArray(userMsg.content)) {
    userMsg.content.push({ type: 'text', text: screenContext });
    if (screenshot) {
      userMsg.content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } });
    }
  } else {
    userMsg.content = [
      { type: 'text', text: userMsg.content },
      { type: 'text', text: screenContext },
      ...(screenshot ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshot } }] : []),
    ];
  }
}

function buildScreenContext(uiTree, screenshot) {
  const parts = ['\n\n--- PANTALLA ACTUAL ---'];
  if (uiTree) parts.push(`Elementos visibles:\n${uiTree}`);
  if (!uiTree && screenshot) parts.push('(Ver imagen adjunta)');
  parts.push('--- FIN ---');
  return parts.join('\n');
}
