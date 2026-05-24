// content.js — se inyecta en cada página

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_UI_TREE') {
    sendResponse({ tree: getUiTree() });
  }
  if (msg.type === 'EXECUTE_ACTION') {
    const result = executeAction(msg.action, msg.params);
    sendResponse({ result });
  }
  return true;
});

// ── UI Tree ───────────────────────────────────────────────────────────────────

function getUiTree() {
  const lines = [`Page: ${document.title}`, `URL: ${location.href}`, ''];

  // Editable fields
  lines.push('=== EDITABLE FIELDS (use exact label as target in set_text) ===');
  getAllEditableFields().forEach(({ el, label, type }) => {
    const val = (el.value || el.innerText || '').trim().slice(0, 60);
    lines.push(`[${type}] target="${label}"${val ? ` current="${val}"` : ''}`);
  });

  // Buttons
  lines.push('');
  lines.push('=== BUTTONS ===');
  document.querySelectorAll(
    'button, [role="button"], input[type="submit"], input[type="button"]'
  ).forEach(el => {
    const text = getElText(el);
    if (text.length > 0 && isVisible(el)) lines.push(`[button] "${text.slice(0, 100)}"`);
  });

  // Links
  lines.push('');
  lines.push('=== LINKS ===');
  document.querySelectorAll('a[href]').forEach(el => {
    const text = getElText(el);
    if (text.length > 1 && isVisible(el)) {
      const href = el.getAttribute('href') || '';
      lines.push(`[link] "${text.slice(0, 100)}"${href && !href.startsWith('javascript') ? ` href="${href.slice(0, 60)}"` : ''}`);
    }
  });

  // Tabs (navigation tabs, not browser tabs)
  lines.push('');
  lines.push('=== TABS / NAV ===');
  document.querySelectorAll('[role="tab"], [role="menuitem"], [role="option"], [role="treeitem"]').forEach(el => {
    const text = getElText(el);
    if (text.length > 0 && isVisible(el)) {
      const selected = el.getAttribute('aria-selected') === 'true' ? ' [active]' : '';
      lines.push(`[${el.getAttribute('role')}] "${text.slice(0, 100)}"${selected}`);
    }
  });

  // Select dropdowns
  lines.push('');
  lines.push('=== DROPDOWNS ===');
  document.querySelectorAll('select').forEach(el => {
    if (!isVisible(el)) return;
    const label = getFieldLabel(el);
    const selected = el.options[el.selectedIndex]?.text || '';
    lines.push(`[select] label="${label}" selected="${selected}"`);
  });

  // Headings
  lines.push('');
  lines.push('=== HEADINGS ===');
  document.querySelectorAll('h1, h2, h3').forEach(h => {
    const text = h.textContent?.trim();
    if (text && isVisible(h)) lines.push(`[heading] "${text.slice(0, 100)}"`);
  });

  return lines.slice(0, 250).join('\n');
}

function getAllEditableFields() {
  const fields = [];
  const seen = new Set();

  document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea'
  ).forEach(el => {
    if (!isVisible(el)) return;
    const label = getFieldLabel(el);
    if (label && !seen.has(label)) { seen.add(label); fields.push({ el, label, type: 'input' }); }
  });

  document.querySelectorAll('[contenteditable="true"]').forEach(el => {
    if (!isVisible(el)) return;
    const label = getFieldLabel(el);
    if (label && !seen.has(label)) { seen.add(label); fields.push({ el, label, type: 'richtext' }); }
  });

  return fields;
}

function getFieldLabel(el) {
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('data-placeholder') ||
    el.getAttribute('placeholder') ||
    getAssociatedLabel(el) ||
    el.getAttribute('name') ||
    el.getAttribute('id') ||
    ''
  ).trim();
}

function getAssociatedLabel(el) {
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label) return label.textContent?.trim();
  }
  const label = el.closest('label');
  return label ? label.textContent?.trim() : '';
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function getElText(el) {
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.textContent?.trim() ||
    el.value ||
    el.getAttribute('alt') ||
    ''
  ).trim();
}

// ── Actions ───────────────────────────────────────────────────────────────────

function executeAction(action, params) {
  switch (action) {
    case 'click':        return doClick(params.target || '');
    case 'set_text':     return doSetText(params.text || '', params.target || '');
    case 'scroll_up':    window.scrollBy({ top: -500, behavior: 'smooth' }); return 'scrolled up';
    case 'scroll_down':  window.scrollBy({ top:  500, behavior: 'smooth' }); return 'scrolled down';
    case 'press_back':   history.back(); return 'went back';
    case 'press_enter':  return doPressEnterOnFocused();
    case 'navigate_to':  location.href = params.url; return `navigating to ${params.url}`;
    default: return `unknown action: ${action}`;
  }
}

// ── Click ─────────────────────────────────────────────────────────────────────

function doClick(target) {
  if (!target) return 'no target';
  const q = target.toLowerCase().trim();

  const candidates = [
    ...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'),
    ...document.querySelectorAll('a[href]'),
    ...document.querySelectorAll('[role="tab"], [role="menuitem"], [role="option"], [role="link"], [role="treeitem"]'),
    ...document.querySelectorAll('[contenteditable="true"], input, textarea'),
    ...document.querySelectorAll('[tabindex]'),
  ];

  // Deduplicate
  const unique = [...new Set(candidates)];

  let best = null, bestScore = 0;
  for (const el of unique) {
    if (!isVisible(el)) continue;
    const text = getElText(el).toLowerCase();
    const label = getFieldLabel(el).toLowerCase();
    const href = (el.getAttribute('href') || '').toLowerCase();
    const score = Math.max(scoreMatch(text, q), scoreMatch(label, q), scoreMatch(href, q));
    if (score > bestScore) { best = el; bestScore = score; }
  }

  if (best && bestScore > 0) {
    best.scrollIntoView({ behavior: 'smooth', block: 'center' });
    best.focus();
    best.click();
    const label = getElText(best) || getFieldLabel(best) || best.tagName;
    return `clicked "${label.slice(0, 60)}"`;
  }

  // Text node walk as last resort
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeText = node.textContent.trim().toLowerCase();
    if (nodeText.includes(q) && isVisible(node.parentElement)) {
      node.parentElement.click();
      return `clicked text node "${node.textContent.trim().slice(0, 60)}"`;
    }
  }

  return `element not found: "${target}"`;
}

// ── Set Text ──────────────────────────────────────────────────────────────────

function doSetText(text, target) {
  let el = null;

  if (target) {
    const fields = getAllEditableFields();
    const scored = fields
      .map(f => ({ ...f, score: scoreMatch(f.label, target) }))
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      el = scored[0].el;
    } else {
      const available = fields.map(f => `"${f.label}"`).join(', ');
      return `field "${target}" not found. Available fields: ${available || 'none visible'}`;
    }
  }

  if (!el) el = document.activeElement;
  return typeInto(el, text);
}

function typeInto(el, text) {
  if (!el || el === document.body) return 'no element focused';

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus();
  el.click();

  if (el.isContentEditable) {
    // Clear existing content, then insert
    el.focus();
    document.execCommand('selectAll', false, null);
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      el.innerText = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    return `typed in "${getFieldLabel(el) || 'richtext'}": "${text.slice(0, 60)}"`;
  }

  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    const label = getFieldLabel(el).toLowerCase();
    const isSearch = el.type === 'search' || label.includes('search') || label.includes('buscar') || label.includes('búsqueda') || label.includes('query');

    if (isSearch) {
      pressEnter(el);
      el.form?.submit?.();
    }

    return `typed in "${getFieldLabel(el) || el.tagName.toLowerCase()}": "${text.slice(0, 60)}"${isSearch ? ' (search submitted)' : ''}`;
  }

  return 'element is not editable';
}

function doPressEnterOnFocused() {
  const el = document.activeElement;
  if (!el || el === document.body) return 'no focused element';
  pressEnter(el);
  el.form?.submit?.();
  return 'pressed enter';
}

function pressEnter(el) {
  const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown',  opts));
  el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new KeyboardEvent('keyup',    opts));
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreMatch(label, target) {
  if (!label || !target) return 0;
  const l = label.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  if (l === t)                               return 100;
  if (l.startsWith(t) || t.startsWith(l))   return 80;
  if (l.includes(t))                         return 60;
  if (t.includes(l))                         return 40;
  const lWords = new Set(l.split(/\s+/));
  const overlap = t.split(/\s+/).filter(w => lWords.has(w) && w.length > 2).length;
  return overlap > 0 ? overlap * 15 : 0;
}
