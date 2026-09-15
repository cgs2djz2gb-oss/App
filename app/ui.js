// Kleine UI-Helfer: Elemente bauen, Sheet, Toasts, Bestätigungen.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const backdrop = () => document.getElementById('sheet-backdrop');
const sheetEl = () => document.getElementById('sheet');
let closeHandler = null;

export function openSheet(content, { onClose } = {}) {
  const sheet = sheetEl();
  sheet.replaceChildren(content);
  sheet.hidden = false;
  backdrop().hidden = false;
  closeHandler = onClose || null;
  const focusable = sheet.querySelector('input, textarea, button');
  if (focusable && !matchMedia('(max-width: 880px)').matches) focusable.focus();
}

export function closeSheet() {
  const sheet = sheetEl();
  if (sheet.hidden) return;
  sheet.hidden = true;
  sheet.replaceChildren();
  backdrop().hidden = true;
  const cb = closeHandler;
  closeHandler = null;
  if (cb) cb();
}

export function isSheetOpen() {
  return !sheetEl().hidden;
}

export function openMenu(items, anchorRect) {
  const menu = document.getElementById('menu');
  menu.replaceChildren();
  for (const item of items) {
    if (item === '-') { menu.append(el('hr')); continue; }
    if (item.type === 'title') { menu.append(el('div', { class: 'menu-title', text: item.label })); continue; }
    if (item.type === 'custom') { menu.append(item.node); continue; }
    menu.append(el('button', {
      type: 'button',
      onclick: () => { closeMenu(); item.onClick(); },
    }, [item.label]));
  }
  menu.hidden = false;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  // An einem Punkt (Kontextmenü) links ausrichten, an einer Schaltfläche rechtsbündig.
  const wanted = anchorRect.width ? anchorRect.right - w : anchorRect.left;
  menu.style.left = `${Math.max(8, Math.min(wanted, window.innerWidth - w - 8))}px`;
  const top = anchorRect.bottom + 6;
  menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`;
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, { once: true }), 0);
}

function onDocDown(e) {
  const menu = document.getElementById('menu');
  if (!menu.hidden && !menu.contains(e.target)) closeMenu();
  else if (!menu.hidden) setTimeout(() => document.addEventListener('pointerdown', onDocDown, { once: true }), 0);
}

export function closeMenu() {
  document.getElementById('menu').hidden = true;
}

export function toast(message, action) {
  const wrap = document.getElementById('toast-wrap');
  const node = el('div', { class: 'toast' }, [
    el('span', { text: message }),
    action && el('button', { type: 'button', onclick: () => { node.remove(); action.onClick(); } }, [action.label]),
  ]);
  wrap.append(node);
  setTimeout(() => node.remove(), action ? 6000 : 2600);
  return node;
}

/** Auswahl-Dialog; liefert den gewählten Wert oder null. */
export function choose(title, options, { text } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (settled) return; settled = true; closeSheet(); resolve(val); };
    const body = el('div', { class: 'sheet-body' }, [
      text && el('p', { class: 'hint', text }),
      el('div', { class: 'field' }, options.map((o) =>
        el('button', {
          class: `btn ${o.primary ? 'primary' : ''} ${o.danger ? 'danger' : ''}`,
          style: 'height:40px;justify-content:center',
          onclick: () => finish(o.value),
        }, [o.label]))),
      el('button', { class: 'btn ghost', style: 'height:38px', onclick: () => finish(null) }, ['Abbrechen']),
    ]);
    openSheet(el('div', {}, [
      el('div', { class: 'sheet-head' }, [el('h2', { text: title })]),
      body,
    ]), { onClose: () => finish(null) });
  });
}
