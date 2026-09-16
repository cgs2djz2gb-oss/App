// Zeitraster: Rendering der Tages-/Wochenansicht plus Ziehen, Größe ändern, Anlegen.
import { addDays, dowOf, fmtTime, todayYmd, nowMinutes, DOW_SHORT, fmtHours, parseYmd } from './dates.js';
import { occurrencesByDate, layoutDay, plannedMinutes } from './recurrence.js';
import { getState, moveOccurrence, patchOccurrence, deleteOccurrence, ovKey } from './store.js';
import { toast, el } from './ui.js';

let app = null;               // wird von main.js gesetzt
let buckets = new Map();
let nowTimer = null;
let didInitialScroll = false;
let focusedKey = null;      // Block, der zuletzt die Tastatur hatte
let lastCenteredDate = null;// zuletzt seitlich angesteuerter Tag
let pendingFocusKey = null; // Schlüssel, den der Block nach der Änderung trägt

export function initGrid(appRef) {
  app = appRef;
  const cols = document.getElementById('columns');
  cols.addEventListener('pointerdown', onGridPointerDown);
  cols.addEventListener('contextmenu', onBlockContextMenu);
  document.getElementById('grid-head').addEventListener('click', onHeadClick);
  clearInterval(nowTimer);
  nowTimer = setInterval(() => renderNowLine(), 30000);
}

const settings = () => getState().settings;
const dayStartMin = () => settings().dayStart * 60;
const dayEndMin = () => settings().dayEnd * 60;
const hourH = () => settings().hourHeight;
const pxPerMin = () => hourH() / 60;
const minToY = (min) => (min - dayStartMin()) * pxPerMin();
const yToMin = (y) => y / pxPerMin() + dayStartMin();
const snapMin = (min) => Math.round(min / settings().snap) * settings().snap;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Kann das Raster seitlich gescrollt werden? (Woche auf schmalen Geräten)
 * Die reine Breitenmessung genügt nicht: nach einem Ansichtswechsel behält der
 * Browser kurz seine alte Scrollbreite. Deshalb zählt, ob Querscrollen erlaubt ist.
 */
function scrollsSideways() {
  const scroller = document.getElementById('grid-scroll');
  if (getComputedStyle(scroller).overflowX !== 'auto') return false;
  return scroller.scrollWidth - scroller.clientWidth > 4;
}

export function visibleDates() {
  const s = getState();
  if (app.view === 'day') return [app.cursor];
  const start = app.weekStart();
  return Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter(
    (d) => s.settings.showWeekend !== false || (dowOf(d) !== 0 && dowOf(d) !== 6)
  );
}

export function renderPlanner() {
  const dates = visibleDates();
  const state = getState();
  // Vor dem Neuaufbau merken, welcher Block die Tastatur hat - das Entfernen
  // der alten Elemente löst sonst ein blur aus und der Fokus wäre weg.
  const active = document.activeElement;
  if (pendingFocusKey) {
    focusedKey = pendingFocusKey;
    pendingFocusKey = null;
  } else if (active && active.classList && active.classList.contains('block')) {
    focusedKey = active.dataset.key;
  }
  buckets = occurrencesByDate(state, dates[0], dates[dates.length - 1]);

  document.documentElement.style.setProperty('--hour-h', `${hourH()}px`);
  renderHead(dates);
  renderColumns(dates);
  renderNowLine();
  document.getElementById('empty-state').hidden = state.blocks.length > 0;

  if (focusedKey) {
    const again = document.querySelector(`.block[data-key="${CSS.escape(focusedKey)}"]`);
    if (again) again.focus({ preventScroll: true });
    else focusedKey = null;
  }

  const scroller = document.getElementById('grid-scroll');
  if (!didInitialScroll) {
    didInitialScroll = true;
    const target = minToY(clamp(nowMinutes() - 60, dayStartMin(), dayEndMin())) - 20;
    scroller.scrollTop = Math.max(0, target);
  }
  // Schmale Wochenansicht scrollt seitlich – der gewählte Tag soll sichtbar sein.
  if (!scrollsSideways()) {
    scroller.scrollLeft = 0;
    lastCenteredDate = null;
  } else if (app.cursor !== lastCenteredDate) {
    lastCenteredDate = app.cursor;
    const col = scroller.querySelector(`.col[data-date="${app.cursor}"]`);
    if (col) {
      const left = col.offsetLeft - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter-w') || 0);
      scroller.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
    }
  }
}

function renderHead(dates) {
  const head = document.getElementById('grid-head');
  const today = todayYmd();
  const cells = dates.map((d) => {
    const date = parseYmd(d);
    const planned = plannedMinutes(buckets.get(d) || []);
    return el('div', {
      class: `head-cell ${d === today ? 'today' : ''} ${d === app.cursor && app.view === 'week' ? 'sel' : ''}`,
      dataset: { date: d },
      title: 'Zum Tag wechseln',
    }, [
      el('div', { class: 'dow', text: DOW_SHORT[date.getDay()] }),
      el('div', { class: 'dnum', text: String(date.getDate()) }),
      el('div', { class: 'load', text: planned ? fmtHours(planned) : '' }),
    ]);
  });
  head.replaceChildren(
    el('div', {}),
    el('div', { class: 'head-cols', style: `grid-template-columns: repeat(${dates.length}, 1fr)` }, cells)
  );
}

function renderColumns(dates) {
  const total = dayEndMin() - dayStartMin();
  const height = total * pxPerMin();
  const gutter = document.getElementById('gutter');
  gutter.style.height = `${height}px`;
  const labels = [];
  for (let h = settings().dayStart; h <= settings().dayEnd; h++) {
    labels.push(el('div', { class: 'hour-label', style: `top:${minToY(h * 60)}px`, text: `${String(h).padStart(2, '0')}:00` }));
  }
  gutter.replaceChildren(...labels);

  const columns = document.getElementById('columns');
  columns.style.gridTemplateColumns = `repeat(${dates.length}, 1fr)`;
  columns.style.height = `${height}px`;
  // Schmale Spalten (Woche auf dem Handy) zeigen nur noch den Titel einzeilig.
  const colWidth = columns.getBoundingClientRect().width / dates.length;
  columns.classList.toggle('narrow', colWidth < 96);
  const today = todayYmd();

  const cols = dates.map((d) => {
    const dow = dowOf(d);
    const col = el('div', {
      class: `col ${dow === 0 || dow === 6 ? 'weekend' : ''} ${d === today ? 'today-col' : ''}`,
      dataset: { date: d },
    });
    for (let h = settings().dayStart; h <= settings().dayEnd; h++) {
      col.append(el('div', { class: 'hline', style: `top:${minToY(h * 60)}px` }));
      if (h < settings().dayEnd && hourH() >= 48) {
        col.append(el('div', { class: 'hline half', style: `top:${minToY(h * 60 + 30)}px` }));
      }
    }
    const occs = buckets.get(d) || [];
    const lanes = layoutDay(occs);
    for (const occ of occs) col.append(renderBlock(occ, lanes.get(occ.key)));
    return col;
  });
  columns.replaceChildren(...cols);
}

export function renderBlock(occ, lane = { lane: 0, lanes: 1 }) {
  const top = minToY(occ.start);
  const h = Math.max(occ.duration * pxPerMin(), 17);
  const width = 100 / lane.lanes;
  const left = lane.lane * width;
  const doneTodos = occ.todos.filter((t) => t.done).length;
  const short = h < 38;

  const label = [
    occ.title || 'Ohne Titel',
    `${fmtTime(occ.start)} bis ${fmtTime(occ.start + occ.duration)}`,
    occ.isRecurring ? 'Teil einer Serie' : null,
    occ.todos.length ? `${doneTodos} von ${occ.todos.length} Schritten erledigt` : null,
    occ.done ? 'erledigt' : null,
  ].filter(Boolean).join(', ');

  const node = el('div', {
    class: `block ${short ? 'short' : ''} ${occ.done ? 'done' : ''}`,
    tabindex: '0',
    role: 'button',
    'aria-label': label,
    style: `top:${top}px;height:${h}px;left:calc(${left}% + 2px);width:calc(${width}% - 4px);` +
           `--bg-c:var(--c-${occ.color}-bg);--fg-c:var(--c-${occ.color})`,
    dataset: { key: occ.key, blockId: occ.blockId, date: occ.date, anchor: occ.anchorDate },
  }, [
    el('div', { class: 'b-title', text: occ.title || 'Ohne Titel' }),
    el('div', { class: 'b-meta', text: short
      ? fmtTime(occ.start)
      : `${fmtTime(occ.start)}–${fmtTime(occ.start + occ.duration)}${occ.todos.length ? ` · ${doneTodos}/${occ.todos.length}` : ''}` }),
    (occ.isRecurring || occ.notes) && el('div', { class: 'b-badges', text: `${occ.isRecurring ? '↻' : ''}${occ.notes ? ' ✎' : ''}` }),
    occ.todos.length > 0 && el('div', { class: 'prog', style: `width:${Math.round((doneTodos / occ.todos.length) * 100)}%` }),
    el('div', { class: 'handle top' }),
    el('div', { class: 'handle bottom' }),
  ]);
  node._occ = occ;
  node.addEventListener('focus', () => { focusedKey = occ.key; });
  node.addEventListener('keydown', onBlockKeydown);
  return node;
}

/** Blöcke mit der Tastatur bewegen: Pfeile schieben, Umschalt dehnt. */
function onBlockKeydown(e) {
  const occ = e.currentTarget._occ;
  if (!occ) return;
  const step = e.altKey ? 5 : settings().snap;

  const moveTo = (start, date = occ.date) => {
    if (occ.isRecurring) {
      moveOccurrence(occ.blockId, occ.anchorDate, date, start, 'single');
    } else {
      patchOccurrence(occ.blockId, occ.date, { start, date }, 'series');
      // Bei Einzelblöcken ist der Tag Teil des Schlüssels – sonst wäre der Fokus weg.
      pendingFocusKey = ovKey(occ.blockId, date);
    }
    app.refresh();
  };
  const resizeTo = (duration) => {
    patchOccurrence(occ.blockId, occ.anchorDate, { duration }, occ.isRecurring ? 'single' : 'series');
    app.refresh();
  };

  switch (e.key) {
    case 'Enter':
    case ' ':
      e.preventDefault();
      app.openEditor(occ);
      break;
    case 'ArrowUp':
    case 'ArrowDown': {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      if (e.shiftKey) {
        resizeTo(clamp(occ.duration + dir * step, settings().snap, dayEndMin() - occ.start));
      } else {
        moveTo(clamp(occ.start + dir * step, dayStartMin(), dayEndMin() - occ.duration));
      }
      break;
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (app.view !== 'week') return;
      e.preventDefault();
      e.stopPropagation();
      const dates = visibleDates();
      const idx = dates.indexOf(occ.date);
      const next = dates[clamp(idx + (e.key === 'ArrowRight' ? 1 : -1), 0, dates.length - 1)];
      if (next !== occ.date) moveTo(occ.start, next);
      break;
    }
    case 'Delete':
    case 'Backspace': {
      e.preventDefault();
      e.stopPropagation();
      deleteOccurrence(occ.blockId, occ.anchorDate, occ.isRecurring ? 'single' : 'series');
      focusedKey = null;
      app.refresh();
      toast('Gelöscht', { label: 'Rückgängig', onClick: () => app.undoAll(1) });
      break;
    }
    case 'f':
    case 'F':
      e.preventDefault();
      e.stopPropagation();
      app.startSession(occ);
      break;
    default:
      break;
  }
}

function renderNowLine() {
  document.querySelectorAll('.nowline').forEach((n) => n.remove());
  const today = todayYmd();
  const col = document.querySelector(`.col[data-date="${today}"]`);
  if (!col) return;
  const min = nowMinutes();
  if (min < dayStartMin() || min > dayEndMin()) return;
  col.append(el('div', { class: 'nowline', style: `top:${minToY(min)}px` }));
}

function onBlockContextMenu(e) {
  const node = e.target.closest('.block');
  if (!node || !node._occ) return;
  e.preventDefault();
  app.openBlockMenu(node._occ, { x: e.clientX, y: e.clientY });
}

function onHeadClick(e) {
  const cell = e.target.closest('.head-cell');
  if (!cell) return;
  app.goToDate(cell.dataset.date, { switchToDay: app.view === 'day' });
}

// ---------- Zeigergesten ----------

function colGeometry() {
  const columns = document.getElementById('columns');
  const rect = columns.getBoundingClientRect();
  const dates = visibleDates();
  return { rect, dates, colWidth: rect.width / dates.length };
}

function dateAtX(x) {
  const { rect, dates, colWidth } = colGeometry();
  const idx = clamp(Math.floor((x - rect.left) / colWidth), 0, dates.length - 1);
  return dates[idx];
}

function onGridPointerDown(e) {
  if (e.button !== undefined && e.button > 0) return;
  const blockEl = e.target.closest('.block');
  if (blockEl) {
    const handle = e.target.closest('.handle');
    startBlockGesture(e, blockEl, handle ? (handle.classList.contains('top') ? 'resize-top' : 'resize-bottom') : 'move');
  } else {
    startCreateGesture(e);
  }
}

function startBlockGesture(e, node, mode) {
  const occ = node._occ;
  if (!occ) return;
  const columns = document.getElementById('columns');
  const scroller = document.getElementById('grid-scroll');
  const touch = e.pointerType === 'touch';
  const startX = e.clientX;
  const startY = e.clientY;
  const orig = { start: occ.start, duration: occ.duration, date: occ.date };
  let active = !touch && mode !== 'move';   // Anfasser starten sofort
  let moved = false;
  let panned = false;                      // mit dem Finger gescrollt statt gezogen
  let longPress = null;
  let next = { ...orig };
  let panLast = startY;

  const activate = () => {
    active = true;
    node.classList.add('dragging');
    if (navigator.vibrate) navigator.vibrate(8);
  };
  if (mode === 'move' && !touch) active = false;
  if (!touch && mode === 'move') { /* aktiviert nach kleiner Bewegung */ }
  if (touch && mode !== 'move') activate();
  if (touch && mode === 'move') longPress = setTimeout(activate, 220);
  if (!touch && mode !== 'move') node.classList.add('dragging');

  node.setPointerCapture(e.pointerId);

  // Position des Griffs im Block, damit der Block beim Ziehen nicht springt.
  const grabOffsetMin = yToMin(startY - node.getBoundingClientRect().top) - dayStartMin();
  let lastPointer = { x: startX, y: startY };
  let autoScrollFrame = null;

  /** Uhrzeit unter dem Zeiger – unabhängig davon, wie weit inzwischen gescrollt wurde. */
  const pointerMinutes = (clientY) => {
    const col = node.parentElement;
    const rect = col.getBoundingClientRect();
    return yToMin(clientY - rect.top);
  };

  const applyPointer = () => {
    const { x, y } = lastPointer;
    if (mode === 'move') {
      const maxStart = dayEndMin() - orig.duration;
      next.start = clamp(snapMin(pointerMinutes(y) - grabOffsetMin), dayStartMin(), maxStart);
      next.date = app.view === 'week' ? dateAtX(x) : orig.date;
      const targetCol = columns.querySelector(`.col[data-date="${next.date}"]`);
      if (targetCol && node.parentElement !== targetCol) {
        targetCol.append(node);
        node.style.left = '2px';
        node.style.width = 'calc(100% - 4px)';
      }
      node.style.top = `${minToY(next.start)}px`;
    } else if (mode === 'resize-bottom') {
      const end = clamp(snapMin(pointerMinutes(y)), orig.start + settings().snap, dayEndMin());
      next.start = orig.start;
      next.duration = end - orig.start;
      node.style.height = `${Math.max(next.duration * pxPerMin(), 17)}px`;
    } else {
      const end = orig.start + orig.duration;
      next.start = clamp(snapMin(pointerMinutes(y)), dayStartMin(), end - settings().snap);
      next.duration = end - next.start;
      node.style.top = `${minToY(next.start)}px`;
      node.style.height = `${Math.max(next.duration * pxPerMin(), 17)}px`;
    }
    const meta = node.querySelector('.b-meta');
    if (meta) meta.textContent = `${fmtTime(next.start)}–${fmtTime(next.start + next.duration)}`;
  };

  /** Am oberen und unteren Rand mitscrollen, sonst endet das Ziehen am Bildrand. */
  const stepAutoScroll = () => {
    autoScrollFrame = null;
    if (!active) return;
    const rect = scroller.getBoundingClientRect();
    const edge = 64;
    let speed = 0;
    if (lastPointer.y < rect.top + edge) speed = -(rect.top + edge - lastPointer.y);
    else if (lastPointer.y > rect.bottom - edge) speed = lastPointer.y - (rect.bottom - edge);
    if (speed) {
      const before = scroller.scrollTop;
      scroller.scrollTop += clamp(speed * 0.25, -22, 22);
      if (scroller.scrollTop !== before) applyPointer();
    }
    autoScrollFrame = requestAnimationFrame(stepAutoScroll);
  };

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!active) {
      if (touch) {
        // Vor dem Long-Press: Liste normal scrollen lassen.
        if (Math.abs(dy) > 6 || Math.abs(dx) > 6) {
          clearTimeout(longPress);
          longPress = null;
          panned = true;
          scroller.scrollTop -= ev.clientY - panLast;
          panLast = ev.clientY;
        }
        return;
      }
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      activate();
    }
    moved = true;
    ev.preventDefault();
    lastPointer = { x: ev.clientX, y: ev.clientY };
    applyPointer();
    if (!autoScrollFrame) autoScrollFrame = requestAnimationFrame(stepAutoScroll);
  };

  const onUp = (ev) => {
    clearTimeout(longPress);
    if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
    node.releasePointerCapture?.(ev.pointerId);
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', onUp);
    node.removeEventListener('pointercancel', onUp);
    node.classList.remove('dragging');

    if (!active || !moved) {
      // Nach einem Wisch nur scrollen – der Editor gehört zum Tippen.
      if (!moved && !panned) app.openEditor(occ);
      else app.refresh();
      return;
    }
    const changedTime = next.start !== orig.start || next.duration !== orig.duration;
    const changedDay = next.date !== orig.date;
    if (!changedTime && !changedDay) { app.refresh(); return; }

    commitGeometry(occ, next, orig);
  };

  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
}

function commitGeometry(occ, next, orig) {
  const patch = {};
  if (next.duration !== orig.duration) patch.duration = next.duration;

  if (occ.isRecurring) {
    moveOccurrence(occ.blockId, occ.anchorDate, next.date, next.start, 'single');
    if (patch.duration) patchOccurrence(occ.blockId, occ.anchorDate, patch, 'single');
    app.refresh();
    toast(`Verschoben: ${fmtTime(next.start)}`, {
      label: 'Ganze Serie',
      onClick: () => {
        moveOccurrence(occ.blockId, occ.anchorDate, next.date, next.start, 'series');
        if (patch.duration) patchOccurrence(occ.blockId, occ.anchorDate, patch, 'series');
        app.refresh();
      },
    });
    return;
  }
  patch.start = next.start;
  if (next.date !== orig.date) patch.date = next.date;
  patchOccurrence(occ.blockId, occ.date, patch, 'series');
  app.refresh();
}

function startCreateGesture(e) {
  const col = e.target.closest('.col');
  if (!col) return;
  const scroller = document.getElementById('grid-scroll');
  const touch = e.pointerType === 'touch';
  const date = col.dataset.date;
  const rect = col.getBoundingClientRect();
  const startMinRaw = yToMin(e.clientY - rect.top);
  const startMin = clamp(snapMin(startMinRaw), dayStartMin(), dayEndMin() - settings().snap);
  const startY = e.clientY;

  if (touch) {
    // Auf Touch: Tippen legt an, senkrecht wischen scrollt, waagerecht blättert.
    let panLast = startY;
    let mode = null;                 // null | 'scroll' | 'swipe'
    const startXTouch = e.clientX;
    const onMove = (ev) => {
      const dx = ev.clientX - startXTouch;
      const dy = ev.clientY - startY;
      if (!mode && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
        // Wo seitlich gescrollt wird, übernimmt der Browser die Waagerechte.
        const horizontal = Math.abs(dx) > Math.abs(dy) * 1.4;
        mode = horizontal && !scrollsSideways() ? 'swipe' : (horizontal ? 'none' : 'scroll');
      }
      if (mode === 'scroll') { scroller.scrollTop -= ev.clientY - panLast; panLast = ev.clientY; }
    };
    const onUp = (ev) => {
      col.removeEventListener('pointermove', onMove);
      col.removeEventListener('pointerup', onUp);
      col.removeEventListener('pointercancel', onUp);
      const dx = ev.clientX - startXTouch;
      if (mode === 'swipe' && Math.abs(dx) > 55 && !scrollsSideways()) app.step(dx < 0 ? 1 : -1);
      else if (!mode) app.openEditor(null, { date, start: startMin, duration: 60 });
    };
    col.setPointerCapture(e.pointerId);
    col.addEventListener('pointermove', onMove);
    col.addEventListener('pointerup', onUp);
    col.addEventListener('pointercancel', onUp);
    return;
  }

  let ghost = null;
  let endMin = startMin + 60;
  const onMove = (ev) => {
    const cur = clamp(snapMin(yToMin(ev.clientY - rect.top)), dayStartMin(), dayEndMin());
    if (!ghost && Math.abs(ev.clientY - startY) < 4) return;
    if (!ghost) {
      ghost = el('div', { class: 'block ghost', style: `--bg-c:var(--c-blau-bg);--fg-c:var(--c-blau);left:2px;width:calc(100% - 4px)` }, [
        el('div', { class: 'b-meta' }),
      ]);
      col.append(ghost);
    }
    endMin = cur;
    const a = Math.min(startMin, endMin);
    const b = Math.max(startMin, endMin, a + settings().snap);
    ghost.style.top = `${minToY(a)}px`;
    ghost.style.height = `${(b - a) * pxPerMin()}px`;
    ghost.querySelector('.b-meta').textContent = `${fmtTime(a)}–${fmtTime(b)}`;
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const a = Math.min(startMin, endMin);
    const b = Math.max(startMin, endMin, a + settings().snap);
    const duration = ghost ? b - a : 60;
    if (ghost) ghost.remove();
    app.openEditor(null, { date, start: a, duration: clamp(duration, settings().snap, dayEndMin() - a) });
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

export function getBuckets() {
  return buckets;
}

// ---------- Ablegen aus der Seitenleiste ----------

/** Tag und (gerastete) Uhrzeit an einer Bildschirmposition. */
export function timeAtPoint(clientX, clientY) {
  const col = document.elementFromPoint(clientX, clientY)?.closest('.col');
  if (!col) return null;
  const rect = col.getBoundingClientRect();
  const raw = yToMin(clientY - rect.top);
  const start = clamp(snapMin(raw), dayStartMin(), dayEndMin() - settings().snap);
  return { date: col.dataset.date, start, col };
}

let preview = null;

export function showDropPreview(spot, duration = 60) {
  clearDropPreview();
  if (!spot) return;
  preview = el('div', {
    class: 'block ghost drop',
    style: `--bg-c:var(--c-blau-bg);--fg-c:var(--c-blau);left:2px;width:calc(100% - 4px);` +
           `top:${minToY(spot.start)}px;height:${Math.max(duration * pxPerMin(), 17)}px`,
  }, [el('div', { class: 'b-meta', text: `${fmtTime(spot.start)}–${fmtTime(spot.start + duration)}` })]);
  spot.col.append(preview);
}

export function clearDropPreview() {
  if (preview) preview.remove();
  preview = null;
}
