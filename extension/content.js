// content.js — injected into every page

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
// Builds a complete text map of everything interactive on the page.
// Claude reads this instead of screenshots to know what to interact with.

function getUiTree() {
  const lines = [`Page: ${document.title}`, `URL: ${location.href}`, ''];

  // ── Editable fields ───────────────────────────────────────────────────────
  lines.push('=== EDITABLE FIELDS (use exact target label in set_text) ===');
  const fields = getAllEditableFields();
  if (fields.length === 0) lines.push('  (none found)');
  fields.forEach(({ el, label, type }) => {
    const val = getCurrentValue(el).trim().slice(0, 70);
    const state = getState(el);
    lines.push(`  [${type}] target="${label}"${val ? ` value="${val}"` : ''}${state}`);
  });

  // ── Buttons ───────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('=== BUTTONS ===');
  const btns = getButtons();
  if (btns.length === 0) lines.push('  (none found)');
  btns.forEach(({ el, text, state }) => {
    lines.push(`  [button] "${text}"${state}`);
  });

  // ── Links ─────────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('=== LINKS ===');
  const linkEls = [];
  document.querySelectorAll('a[href]').forEach(el => {
    if (isHidden(el)) return;
    const text = getElText(el);
    if (text.length < 2) return;
    const href = el.getAttribute('href') || '';
    linkEls.push(`  [link] "${text.slice(0, 100)}"${href && !href.startsWith('javascript') && !href.startsWith('#') ? ` → ${href.slice(0, 60)}` : ''}`);
  });
  if (linkEls.length === 0) lines.push('  (none found)');
  linkEls.slice(0, 40).forEach(l => lines.push(l));

  // ── Navigation tabs / menu items ──────────────────────────────────────────
  lines.push('');
  lines.push('=== TABS & MENUS ===');
  const navRoles = ['tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'treeitem'];
  const navEls = [];
  document.querySelectorAll(navRoles.map(r => `[role="${r}"]`).join(',')).forEach(el => {
    if (isHidden(el)) return;
    const text = getElText(el);
    if (!text) return;
    const selected = el.getAttribute('aria-selected') === 'true' ? ' [selected]' : '';
    const checked  = el.getAttribute('aria-checked')  === 'true' ? ' [checked]'  : '';
    navEls.push(`  [${el.getAttribute('role')}] "${text.slice(0, 100)}"${selected}${checked}`);
  });
  if (navEls.length === 0) lines.push('  (none found)');
  navEls.slice(0, 30).forEach(l => lines.push(l));

  // ── Listbox options (dropdowns that are open) ─────────────────────────────
  const listboxEls = [];
  document.querySelectorAll('[role="listbox"] [role="option"], [role="combobox"] [role="option"]').forEach(el => {
    if (isHidden(el)) return;
    const text = getElText(el);
    if (!text) return;
    listboxEls.push(`  [option] "${text.slice(0, 80)}"`);
  });
  if (listboxEls.length > 0) {
    lines.push('');
    lines.push('=== DROPDOWN OPTIONS (currently open) ===');
    listboxEls.slice(0, 20).forEach(l => lines.push(l));
  }

  // ── Select elements ───────────────────────────────────────────────────────
  const selects = [];
  document.querySelectorAll('select').forEach(el => {
    if (isHidden(el)) return;
    const label = getFieldLabel(el);
    const sel = el.options[el.selectedIndex]?.text || '';
    selects.push(`  [select] target="${label || el.name || el.id}" selected="${sel}"`);
  });
  if (selects.length > 0) {
    lines.push('');
    lines.push('=== SELECT DROPDOWNS ===');
    selects.forEach(l => lines.push(l));
  }

  // ── Headings ─────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('=== HEADINGS ===');
  document.querySelectorAll('h1, h2, h3').forEach(h => {
    const text = h.textContent?.trim();
    if (text && !isHidden(h)) lines.push(`  [heading] "${text.slice(0, 100)}"`);
  });

  return lines.slice(0, 350).join('\n');
}

// ── Collect editable fields ───────────────────────────────────────────────────

function getAllEditableFields() {
  const fields = [];
  const seen = new Set();

  function add(el, type) {
    const label = getFieldLabel(el);
    if (!label) return;
    const key = label + type;
    if (seen.has(key)) return;
    seen.add(key);
    fields.push({ el, label, type });
  }

  // Regular inputs
  document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]), textarea'
  ).forEach(el => {
    if (isHidden(el)) return;
    add(el, el.tagName === 'TEXTAREA' ? 'textarea' : 'input');
  });

  // Contenteditable divs (Gmail body, Notion, Docs, etc.)
  document.querySelectorAll('[contenteditable="true"], [contenteditable=""]').forEach(el => {
    if (isHidden(el)) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    add(el, 'richtext');
  });

  // ARIA text widgets not already covered (Gmail To, search autocomplete, etc.)
  document.querySelectorAll('[role="combobox"], [role="textbox"], [role="searchbox"], [role="spinbutton"]').forEach(el => {
    if (isHidden(el)) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return; // already got them
    add(el, el.getAttribute('role'));
  });

  return fields;
}

// ── Collect buttons ───────────────────────────────────────────────────────────

function getButtons() {
  const btns = [];
  const seenEl   = new Set();
  const seenText = new Set();

  document.querySelectorAll(
    'button, [role="button"], [role="switch"], [role="checkbox"], [role="radio"],' +
    'input[type="submit"], input[type="button"], input[type="reset"],' +
    '[aria-haspopup]:not(input):not([role="combobox"])'
  ).forEach(el => {
    if (seenEl.has(el) || isHidden(el)) return;
    seenEl.add(el);
    const text = getElText(el);
    if (!text || seenText.has(text)) return;
    seenText.add(text);
    const state = getState(el);
    btns.push({ el, text: text.slice(0, 100), state });
  });

  return btns;
}

// ── Label resolution ──────────────────────────────────────────────────────────

function getFieldLabel(el) {
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('aria-placeholder') ||
    el.getAttribute('data-placeholder') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('title') ||
    getAssociatedLabel(el) ||
    el.getAttribute('name') ||
    el.getAttribute('id') ||
    el.getAttribute('aria-labelledby') && getTextById(el.getAttribute('aria-labelledby')) ||
    ''
  ).trim();
}

function getAssociatedLabel(el) {
  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl) return lbl.textContent?.trim();
  }
  const closest = el.closest('label');
  if (closest) return closest.textContent?.trim();
  // Look for a preceding label/legend within the same form group
  const parent = el.parentElement;
  if (parent) {
    const sibling = parent.querySelector('label, legend');
    if (sibling && sibling !== el) return sibling.textContent?.trim();
  }
  return '';
}

function getTextById(id) {
  return document.getElementById(id)?.textContent?.trim() || '';
}

function getElText(el) {
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    el.textContent?.trim() ||
    el.value ||
    // SVG icon buttons often have a <title> child
    el.querySelector?.('title')?.textContent?.trim() ||
    el.getAttribute('data-tooltip') ||
    el.getAttribute('data-title') ||
    ''
  ).trim();
}

function getCurrentValue(el) {
  if (el.isContentEditable) return el.innerText || '';
  return el.value || el.textContent || '';
}

function getState(el) {
  const parts = [];
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('disabled');
  if (el.getAttribute('aria-expanded') === 'true') parts.push('expanded');
  if (el.getAttribute('aria-checked') === 'true') parts.push('checked');
  if (el.getAttribute('aria-pressed') === 'true') parts.push('pressed');
  return parts.length ? ` [${parts.join(', ')}]` : '';
}

// ── Visibility ────────────────────────────────────────────────────────────────

function isHidden(el) {
  if (!el) return true;
  // display:none does NOT inherit — must walk ancestors
  let node = el;
  while (node && node !== document.body) {
    if (window.getComputedStyle(node).display === 'none') return true;
    node = node.parentElement;
  }
  // visibility inherits BUT can be overridden by children — check el itself only
  return window.getComputedStyle(el).visibility === 'hidden';
}

function isInViewport(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// ── Actions ───────────────────────────────────────────────────────────────────

function executeAction(action, params) {
  switch (action) {
    case 'click':        return doClick(params.target || '');
    case 'set_text':     return doSetText(params.text || '', params.target || '');
    case 'clear_field':  return doClearField(params.target || '');
    case 'press_key':    return doPressKey(params.key || 'Enter');
    case 'scroll_up':    window.scrollBy({ top: -500, behavior: 'smooth' }); return 'scrolled up';
    case 'scroll_down':  window.scrollBy({ top:  500, behavior: 'smooth' }); return 'scrolled down';
    case 'press_back':   history.back(); return 'went back';
    case 'navigate_to':
      if (!params.url) return 'no url';
      location.href = params.url;
      return `navigating to ${params.url}`;
    default: return `unknown action: ${action}`;
  }
}

// ── Click ─────────────────────────────────────────────────────────────────────

function doClick(target) {
  if (!target) return 'no target specified';

  if (/^\d+\s*[,x]\s*\d+$/i.test(target.trim())) {
    return 'ERROR: pixel coordinates are not supported. Use the exact text label from the UI tree.';
  }

  const q = target.toLowerCase().trim();

  // Every kind of interactive element Chrome can have
  const selectors = [
    'button', '[role="button"]',
    'input[type="submit"]', 'input[type="button"]', 'input[type="reset"]',
    'input[type="checkbox"]', 'input[type="radio"]',
    'a[href]', 'a[onclick]',
    '[role="tab"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
    '[role="option"]', '[role="treeitem"]', '[role="link"]', '[role="switch"]',
    '[role="checkbox"]', '[role="radio"]', '[role="listitem"]',
    '[role="gridcell"]', '[role="row"]', '[role="cell"]', '[role="combobox"]',
    '[aria-haspopup]',
    '[tabindex]:not([tabindex="-1"])',
    '[onclick]',
    'input', 'select', 'textarea',
  ];

  const seen = new Set();
  const candidates = [];
  document.querySelectorAll(selectors.join(',')).forEach(el => {
    if (!seen.has(el)) { seen.add(el); candidates.push(el); }
  });

  let best = null, bestScore = 0;
  for (const el of candidates) {
    if (isHidden(el)) continue;
    const text = getElText(el).toLowerCase();
    const lbl  = getFieldLabel(el).toLowerCase();
    const tip  = (
      el.getAttribute('data-tooltip') || el.getAttribute('data-title') ||
      el.getAttribute('aria-description') || el.getAttribute('data-testid') || ''
    ).toLowerCase();
    const score = Math.max(scoreMatch(text, q), scoreMatch(lbl, q), scoreMatch(tip, q));
    if (score > bestScore) { best = el; bestScore = score; }
  }

  if (best && bestScore > 0) return fireClick(best, bestScore);

  // Text-node walk — find any matching text, then climb to nearest clickable ancestor
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.toLowerCase().includes(q)) continue;
    if (isHidden(node.parentElement)) continue;
    const clickable = findClickableAncestor(node.parentElement) || node.parentElement;
    return fireClick(clickable, 'text-walk');
  }

  return `element not found: "${target}". Call request_screenshot, check the UI tree for the exact label.`;
}

// Walk up the DOM to find the nearest element that can be meaningfully clicked
function findClickableAncestor(el) {
  let node = el;
  while (node && node !== document.body) {
    const tag  = node.tagName?.toLowerCase() || '';
    const role = node.getAttribute?.('role') || '';
    if (['button','a','input','select','textarea'].includes(tag) ||
        ['button','link','tab','menuitem','menuitemradio','menuitemcheckbox',
         'option','switch','checkbox','radio','treeitem','gridcell'].includes(role) ||
        node.getAttribute?.('onclick') ||
        (node.getAttribute?.('tabindex') != null && node.getAttribute('tabindex') !== '-1')) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

// Fire the complete pointer+mouse+click sequence that all frameworks respond to
function fireClick(el, scoreOrTag) {
  // 'instant' scroll is synchronous — ensures getBoundingClientRect is accurate
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  try { el.focus(); } catch(e) {}

  const rect = el.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width  / 2);
  const y = Math.round(rect.top  + rect.height / 2);
  const base = {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y, screenX: x, screenY: y,
    buttons: 1, button: 0,
  };

  el.dispatchEvent(new PointerEvent('pointerover',  { ...base, isPrimary: true }));
  el.dispatchEvent(new MouseEvent ('mouseover',   base));
  el.dispatchEvent(new PointerEvent('pointermove', { ...base, isPrimary: true }));
  el.dispatchEvent(new MouseEvent ('mousemove',   base));
  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, isPrimary: true }));
  el.dispatchEvent(new MouseEvent ('mousedown',   base));
  el.dispatchEvent(new PointerEvent('pointerup',   { ...base, isPrimary: true }));
  el.dispatchEvent(new MouseEvent ('mouseup',     base));
  el.dispatchEvent(new MouseEvent ('click',       base));

  // Native .click() as a final safety net
  try { el.click(); } catch(e) {}

  const label = getElText(el) || getFieldLabel(el);
  return `clicked "${label.slice(0, 60)}" (${scoreOrTag})`;
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
      return `field "${target}" not found. Available: ${available || 'none visible'}`;
    }
  } else {
    el = document.activeElement;
  }

  if (!el || el === document.body) return 'no field focused or found';
  return typeInto(el, text);
}

function doClearField(target) {
  const fields = getAllEditableFields();
  const scored = fields
    .map(f => ({ ...f, score: scoreMatch(f.label, target) }))
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score);

  const el = scored[0]?.el || document.activeElement;
  if (!el || el === document.body) return 'no field found to clear';

  el.focus();
  if (el.isContentEditable) {
    el.innerText = '';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  } else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return `cleared "${getFieldLabel(el) || el.tagName}"`;
}

// ── Typing engine ─────────────────────────────────────────────────────────────

function typeInto(el, text) {
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  el.focus();
  el.click();

  const role = el.getAttribute('role') || '';

  // Contenteditable (Gmail body, Notion, Google Docs, WhatsApp)
  if (el.isContentEditable) {
    return typeIntoContentEditable(el, text);
  }

  // ARIA combobox/textbox not already contenteditable (Gmail To field uses textarea underneath)
  if (['combobox', 'textbox', 'searchbox'].includes(role) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
    return typeCharByChar(el, text);
  }

  // Standard input / textarea (most sites, React apps)
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    return typeIntoInput(el, text);
  }

  return 'element is not typeable';
}

function typeIntoContentEditable(el, text) {
  el.focus();

  // Move cursor to end
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  // Try execCommand first (most reliable for rich editors)
  let ok = document.execCommand('insertText', false, text);

  if (!ok || el.innerText.indexOf(text) === -1) {
    // Fallback: select all and replace
    document.execCommand('selectAll', false, null);
    ok = document.execCommand('insertText', false, text);
  }

  if (!ok) {
    // Nuclear fallback
    el.innerText = text;
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true,
      inputType: 'insertText', data: text,
    }));
  }

  const label = getFieldLabel(el) || 'richtext';
  return `typed "${text.slice(0, 50)}" in "${label}"`;
}

function typeIntoInput(el, text) {
  el.focus();

  // Use the native value setter — bypasses React's read-only descriptor
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  nativeSetter.call(el, text);

  // Fire events React, Vue, and Angular all listen to
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true, cancelable: true,
    inputType: 'insertText', data: text,
  }));

  const label = getFieldLabel(el).toLowerCase();
  const isSearch = el.type === 'search'
    || label.includes('search') || label.includes('buscar')
    || label.includes('query') || label.includes('búsqueda');

  if (isSearch) {
    pressKeyOnEl(el, 'Enter', 13);
    el.form?.submit?.();
  }

  return `typed "${text.slice(0, 50)}" in "${getFieldLabel(el) || el.tagName}"${isSearch ? ' (search submitted)' : ''}`;
}

// For ARIA widgets that only respond to real keyboard events
function typeCharByChar(el, text) {
  el.focus();

  // Clear first
  if (el.value !== undefined) {
    const proto = HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el.isContentEditable) {
    document.execCommand('selectAll', false, null);
  }

  for (const char of text) {
    const opts = { key: char, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', { ...opts, charCode: char.charCodeAt(0) }));
    if (el.isContentEditable) {
      document.execCommand('insertText', false, char);
    } else if (el.value !== undefined) {
      const proto = HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, el.value + char);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
    }
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  return `typed "${text.slice(0, 50)}" char-by-char in "${getFieldLabel(el)}"`;
}

// ── Press key ─────────────────────────────────────────────────────────────────

function doPressKey(key) {
  const el = document.activeElement || document.body;

  const KEY_MAP = {
    'Enter':      { key: 'Enter',     code: 'Enter',      keyCode: 13  },
    'Tab':        { key: 'Tab',       code: 'Tab',        keyCode: 9   },
    'Escape':     { key: 'Escape',    code: 'Escape',     keyCode: 27  },
    'ArrowUp':    { key: 'ArrowUp',   code: 'ArrowUp',    keyCode: 38  },
    'ArrowDown':  { key: 'ArrowDown', code: 'ArrowDown',  keyCode: 40  },
    'ArrowLeft':  { key: 'ArrowLeft', code: 'ArrowLeft',  keyCode: 37  },
    'ArrowRight': { key: 'ArrowRight',code: 'ArrowRight', keyCode: 39  },
    'Space':      { key: ' ',         code: 'Space',      keyCode: 32  },
    'Backspace':  { key: 'Backspace', code: 'Backspace',  keyCode: 8   },
    'Delete':     { key: 'Delete',    code: 'Delete',     keyCode: 46  },
    'Home':       { key: 'Home',      code: 'Home',       keyCode: 36  },
    'End':        { key: 'End',       code: 'End',        keyCode: 35  },
  };

  const opts = { ...(KEY_MAP[key] || { key, code: key, keyCode: 0 }), bubbles: true, cancelable: true };
  pressKeyOnEl(el, key, opts.keyCode, opts);

  // For Tab key, also move focus
  if (key === 'Tab') {
    const focusable = [...document.querySelectorAll(
      'input:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
    )].filter(e => !isHidden(e));
    const idx = focusable.indexOf(document.activeElement);
    if (idx >= 0) focusable[Math.min(idx + 1, focusable.length - 1)]?.focus();
  }

  return `pressed ${key} on ${getElText(el) || el.tagName || 'page'}`;
}

function pressKeyOnEl(el, key, keyCode, overrideOpts) {
  const opts = overrideOpts || { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown',  opts));
  el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new KeyboardEvent('keyup',    opts));

  // For Enter on a form input, also submit the form
  if ((key === 'Enter' || keyCode === 13) && el.form) {
    try { el.form.requestSubmit?.() || el.form.submit?.(); } catch(e) {}
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreMatch(label, target) {
  if (!label || !target) return 0;
  const l = label.toLowerCase().trim();
  const t = target.toLowerCase().trim();
  if (l === t)                              return 100;
  if (l.startsWith(t) || t.startsWith(l))  return 80;
  if (l.includes(t))                        return 60;
  if (t.includes(l))                        return 40;
  const lWords = new Set(l.split(/\s+/));
  const overlap = t.split(/\s+/).filter(w => lWords.has(w) && w.length > 2).length;
  return overlap > 0 ? overlap * 15 : 0;
}
