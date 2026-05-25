import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { buildSystemPrompt } from './prompts/systemPrompt.js';
import { sessionLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const MAX_TOOL_ITERATIONS = 15;

const TOOLS = [
  {
    name: 'click',
    description: 'Clicks an element on the page by its visible text, aria-label, or description.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Text or label of the element to click. Must match exactly what is shown in the UI tree.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'set_text',
    description: 'Types text into a field. Use the exact "target" label from the UI tree EDITABLE FIELDS section.',
    input_schema: {
      type: 'object',
      properties: {
        text:   { type: 'string', description: 'Text to type' },
        target: { type: 'string', description: 'Exact field label from the UI tree (e.g. "Search", "Subject", "Message Body")' },
      },
      required: ['text'],
    },
  },
  {
    name: 'scroll_up',
    description: 'Scrolls the page up to see content above.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'scroll_down',
    description: 'Scrolls the page down to see more content.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'open_app',
    description: 'Opens a website or app in the browser. If the site is already open in a tab, switches to that tab instead of opening a new one.',
    input_schema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'App or site name. E.g. "YouTube Music", "Gmail", "WhatsApp", "Spotify", "Twitter", "Netflix"' },
      },
      required: ['appName'],
    },
  },
  {
    name: 'navigate_to',
    description: 'Navigates the current tab to a specific URL. Use this instead of open_app when you have an exact URL.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to navigate to, e.g. "https://youtube.com/watch?v=..."' },
      },
      required: ['url'],
    },
  },
  {
    name: 'close_tab',
    description: 'Closes the current browser tab.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_tab',
    description: 'Switches to a browser tab that matches the given title or URL fragment.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of the tab title or URL to match. E.g. "Gmail", "YouTube", "GitHub"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'press_back',
    description: 'Goes back to the previous page.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'press_home',
    description: 'Opens a new blank tab (home).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'volume_up',
    description: 'Increases the volume.',
    input_schema: {
      type: 'object',
      properties: {
        steps: { type: 'number', description: 'Steps to increase (default: 2)' },
      },
    },
  },
  {
    name: 'volume_down',
    description: 'Decreases the volume.',
    input_schema: {
      type: 'object',
      properties: {
        steps: { type: 'number', description: 'Steps to decrease (default: 2)' },
      },
    },
  },
  {
    name: 'press_key',
    description: 'Presses a keyboard key on the currently focused element. Use Tab to move between fields, Enter to confirm/submit, Escape to cancel, ArrowDown to open dropdowns.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'], description: 'Key to press' },
      },
      required: ['key'],
    },
  },
  {
    name: 'clear_field',
    description: 'Clears the content of a field before typing new text into it.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Exact field label from the UI tree' },
      },
      required: ['target'],
    },
  },
  {
    name: 'request_screenshot',
    description: 'Takes a fresh screenshot to see the current state of the page. Use ONLY when the UI tree is missing key elements or a visual check is needed. Do NOT use after every action.',
    input_schema: { type: 'object', properties: {} },
  },
];

/**
 * Generates the agent response with full tool use loop.
 * Each tool call gets its own fresh screen context.
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
  getLatestScreenContext,
}) {
  const log = sessionLogger(sessionId);

  // Sanitize: Anthropic requires strictly alternating user/assistant messages,
  // starting with user. Merge or drop any consecutive same-role messages.
  const sanitized = [];
  for (const m of messages) {
    if (sanitized.length > 0 && sanitized[sanitized.length - 1].role === m.role) {
      // Merge into previous message — keeps content readable
      const prev = sanitized[sanitized.length - 1];
      const prevText = typeof prev.content === 'string' ? prev.content : JSON.stringify(prev.content);
      const curText  = typeof m.content  === 'string' ? m.content  : JSON.stringify(m.content);
      prev.content = `${prevText}\n${curText}`;
    } else {
      sanitized.push({ ...m });
    }
  }
  // Must start with user
  while (sanitized.length > 0 && sanitized[0].role !== 'user') sanitized.shift();

  const workingMessages = sanitized.map((m, i) => {
    if (i === sanitized.length - 1 && m.role === 'user' && (uiTree || screenshot)) {
      const copy = { ...m };
      attachScreenContext(copy, uiTree, screenshot);
      return copy;
    }
    return m;
  });

  log.debug('[Claude] Generating response', { messageCount: sanitized.length, hasScreenshot: !!screenshot });

  return await withRetry(async () => {
    let finalText = '';
    let iterations = 0;

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

      if (stopReason === 'end_turn' || toolCalls.length === 0) {
        log.debug('[Claude] Final response', { iterations, chars: finalText.length });
        break;
      }

      // Execute each tool and get fresh screen context after each one
      const toolResults = [];

      for (const tool of toolCalls) {
        log.info('[Claude] Tool call', { name: tool.name, input: tool.input, iteration: iterations });

        let result = 'ok';
        try {
          result = await onToolCall?.(tool.name, tool.input, tool.id) ?? 'ok';
        } catch (e) {
          result = `error: ${e.message}`;
          log.error('[Claude] Tool failed', { name: tool.name, error: e.message });
        }

        // Get fresh screen state after EVERY tool call
        const latestContext = await getLatestScreenContext?.();
        let content = typeof result === 'string' ? result : JSON.stringify(result);

        if (latestContext) {
          const screenText = buildScreenContext(latestContext.uiTree, latestContext.screenshot);
          content += `\n\n${screenText}`;
        }

        // If screenshot available, include it as vision content
        if (latestContext?.screenshot) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: [
              { type: 'text', text: content },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: latestContext.screenshot } },
            ],
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content,
          });
        }
      }

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

      workingMessages.push({ role: 'user', content: toolResults });

      if (stopReason !== 'tool_use') break;
    }

    if (iterations >= MAX_TOOL_ITERATIONS) {
      log.warn('[Claude] Reached iteration limit', { max: MAX_TOOL_ITERATIONS });
    }

    return finalText;
  }, { name: 'Claude API', maxAttempts: 3 });
}

// ── Single streaming turn ─────────────────────────────────────────────────────

async function streamOneTurn({ log, messages, language, userName, onTextChunk }) {
  let text = '';
  let stopReason = 'end_turn';
  const toolCalls = [];
  let pendingTool = null;

  const stream = anthropic.messages.stream({
    model: env.CLAUDE_MODEL,
    max_tokens: 350,
    temperature: 0.1,
    system: buildSystemPrompt({ language, userName }),
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
      await onTextChunk?.(event.delta.text);
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
        log.error('[Claude] Error parsing tool input', { error: e.message });
      }
      pendingTool = null;
    }
  }

  return { text, toolCalls, stopReason };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const parts = ['\n\n--- CURRENT SCREEN ---'];
  if (uiTree) parts.push(`Visible elements:\n${uiTree}`);
  if (!uiTree && screenshot) parts.push('(See attached image)');
  parts.push('--- END ---');
  return parts.join('\n');
}
