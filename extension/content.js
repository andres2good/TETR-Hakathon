// content.js — se inyecta en cada página
// Escucha mensajes del popup y ejecuta acciones en el DOM

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_UI_TREE') {
    sendResponse({ tree: getUiTree() });
  }
  if (msg.type === 'EXECUTE_ACTION') {
    const result = executeAction(msg.action, msg.params);
    sendResponse({ result });
  }
  return true; // mantener canal abierto para respuesta async
});

// ── Leer la página ────────────────────────────────────────────────────────────

function getUiTree() {
  const lines = [`Page: ${document.title}`, `URL: ${location.href}`, ''];

  // Botones y links
  document.querySelectorAll('button, a, [role="button"]').forEach(el => {
    const text = getElText(el);
    if (text.length > 1) lines.push(`[button] "${text.slice(0, 80)}"`);
  });

  // Campos de texto
  document.querySelectorAll('input, textarea, select').forEach(el => {
    const label = el.getAttribute('aria-label') || el.placeholder || el.name || '';
    const val   = el.value ? ` value="${el.value.slice(0, 40)}"` : '';
    if (label) lines.push(`[input] "${label}"${val}`);
  });

  // Headings (dan contexto de qué parte de la página es)
  document.querySelectorAll('h1, h2, h3').forEach(h => {
    const text = h.textContent?.trim();
    if (text) lines.push(`[heading] "${text.slice(0, 80)}"`);
  });

  return lines.slice(0, 60).join('\n');
}

function getElText(el) {
  return (el.textContent?.trim() ||
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.value || '').trim();
}

// ── Ejecutar acciones ─────────────────────────────────────────────────────────

function executeAction(action, params) {
  switch (action) {
    case 'click':       return doClick(params.target || '');
    case 'set_text':    return doSetText(params.text || '', params.target || '');
    case 'scroll_up':   window.scrollBy({ top: -400, behavior: 'smooth' }); return 'scrolled up';
    case 'scroll_down': window.scrollBy({ top:  400, behavior: 'smooth' }); return 'scrolled down';
    case 'press_back':  history.back(); return 'went back';
    default: return `unknown action: ${action}`;
  }
}

function doClick(target) {
  if (!target) return 'no target';

  const q = target.toLowerCase();
  const candidates = [
    ...document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'),
    ...document.querySelectorAll('[tabindex]'),
  ];

  for (const el of candidates) {
    const text = getElText(el).toLowerCase();
    if (text.includes(q)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.click();
      el.focus();
      return `clicked "${getElText(el)}"`;
    }
  }

  // Buscar en cualquier elemento del DOM
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent.toLowerCase().includes(q)) {
      const el = node.parentElement;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.click();
      return `clicked text "${node.textContent.trim().slice(0, 40)}"`;
    }
  }

  return `element not found: "${target}"`;
}

function doSetText(text, target) {
  let el = null;

  if (target) {
    // Buscar campo por label/placeholder/nombre
    const q = target.toLowerCase();
    el = [...document.querySelectorAll('input, textarea')].find(e => {
      const label = (e.getAttribute('aria-label') || e.placeholder || e.name || '').toLowerCase();
      return label.includes(q);
    });
    if (el) {
      el.focus();
      el.click();
    }
  }

  if (!el) el = document.activeElement;
  if (!el || !['INPUT', 'TEXTAREA'].includes(el.tagName)) {
    // Último recurso: primer input visible
    el = document.querySelector('input:not([type="hidden"]):not([type="submit"]), textarea');
  }

  if (el) {
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return `typed "${text}" in ${el.tagName.toLowerCase()}`;
  }

  return 'no input field found';
}
