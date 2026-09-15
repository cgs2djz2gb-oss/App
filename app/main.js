// Tagwerk – Einstiegspunkt: Navigation, Ansicht, Menü, Tastatur.
import {
  addDays, startOfWeek, todayYmd, fmtDateLong, fmtDateShort, isoWeek, MONTHS, parseYmd, DOW_SHORT,
} from './dates.js';
import { load, getState, setSetting, undo, redo, exportJson, importJson, createBlock, uid } from './store.js';
import { initGrid, renderPlanner } from './grid.js';
import { initPanels, renderPanels } from './panels.js';
import { openBlockEditor } from './editor.js';
import { openTemplateSheet } from './templates.js';
import { openTransferSheet, checkIncomingTransfer } from './transfer.js';
import { el, openMenu, closeSheet, isSheetOpen, toast, choose } from './ui.js';

load();

export const app = {
  cursor: todayYmd(),
  get view() { return getState().settings.view; },
  weekStart() { return startOfWeek(this.cursor, getState().settings.weekStartsOn); },
  goToDate(date, { switchToDay = false } = {}) {
    this.cursor = date;
    if (switchToDay) setSetting('view', 'day');
    this.refresh();
  },
  setView(view) {
    setSetting('view', view);
    this.refresh();
  },
  openEditor(occ, draft) {
    openBlockEditor(occ, draft || {}, this);
  },
  refresh() {
    renderHeader();
    renderPlanner();
    renderPanels();
  },
  /** Mehrere Schritte auf einmal zurücknehmen (z. B. Vorlage anwenden = leeren + einfügen). */
  undoAll(steps = 1) {
    for (let i = 0; i < steps; i++) undo();
    this.refresh();
  },
};

function renderHeader() {
  const title = document.getElementById('range-title');
  const sub = document.getElementById('range-sub');
  const { week, year } = isoWeek(app.cursor);
  const narrow = matchMedia('(max-width: 700px)').matches;
  if (app.view === 'day') {
    const d = parseYmd(app.cursor);
    title.textContent = narrow
      ? `${DOW_SHORT[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()].slice(0, 3)}`
      : fmtDateLong(app.cursor);
    sub.textContent = `KW ${week} · ${year}`;
  } else {
    const start = app.weekStart();
    const end = addDays(start, 6);
    const a = parseYmd(start);
    const b = parseYmd(end);
    const sameMonth = a.getMonth() === b.getMonth();
    title.textContent = sameMonth
      ? `${a.getDate()}.–${b.getDate()}. ${MONTHS[b.getMonth()]}`
      : `${fmtDateShort(start)}–${fmtDateShort(end)}`;
    sub.textContent = `KW ${week} · ${b.getFullYear()}`;
  }
  document.querySelectorAll('.segmented button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === app.view));
  document.getElementById('btn-viewtoggle').textContent = app.view === 'day' ? 'Woche' : 'Tag';
}

function step(dir) {
  app.cursor = addDays(app.cursor, app.view === 'day' ? dir : 7 * dir);
  app.refresh();
}

function newBlockHere() {
  const s = getState().settings;
  const now = new Date();
  const isToday = app.cursor === todayYmd();
  const raw = isToday ? now.getHours() * 60 + now.getMinutes() : s.dayStart * 60 + 120;
  const start = Math.min(Math.round(raw / s.snap) * s.snap, s.dayEnd * 60 - 60);
  app.openEditor(null, { date: app.cursor, start: Math.max(start, s.dayStart * 60), duration: 60 });
}

// ---------- Menü ----------

function numberSetting(label, key, min, max, step = 1) {
  const input = el('input', {
    type: 'number', min: String(min), max: String(max), step: String(step),
    value: String(getState().settings[key]),
    onchange: (e) => {
      const v = Math.max(min, Math.min(max, Number(e.target.value)));
      setSetting(key, v);
      app.refresh();
    },
  });
  return el('label', { class: 'menu-item' }, [label, input]);
}

function themeSetting() {
  const select = el('select', {
    onchange: (e) => { setSetting('theme', e.target.value); applyTheme(); },
  }, [
    el('option', { value: 'system', text: 'System' }),
    el('option', { value: 'light', text: 'Hell' }),
    el('option', { value: 'dark', text: 'Dunkel' }),
  ]);
  select.value = getState().settings.theme;
  return el('label', { class: 'menu-item' }, ['Erscheinungsbild', select]);
}

function weekendSetting() {
  const cb = el('input', {
    type: 'checkbox', class: 'cb', checked: getState().settings.showWeekend !== false,
    style: 'margin-left:auto',
    onchange: (e) => { setSetting('showWeekend', e.target.checked); app.refresh(); },
  });
  return el('label', { class: 'menu-item' }, ['Wochenende anzeigen', cb]);
}

function openMainMenu(anchor) {
  openMenu([
    { type: 'title', label: 'Tagesraster' },
    { type: 'custom', node: numberSetting('Beginn (Uhr)', 'dayStart', 0, 12) },
    { type: 'custom', node: numberSetting('Ende (Uhr)', 'dayEnd', 13, 24) },
    { type: 'custom', node: numberSetting('Raster (min)', 'snap', 5, 60, 5) },
    { type: 'custom', node: weekendSetting() },
    { type: 'custom', node: themeSetting() },
    '-',
    { label: 'Wochen-Vorlagen…', onClick: () => openTemplateSheet(app) },
    { label: 'Auf anderes Gerät übertragen…', onClick: openTransferSheet },
    '-',
    { label: 'Daten sichern (JSON)', onClick: doExport },
    { label: 'Daten laden (JSON)', onClick: doImport },
    { label: 'Beispielwoche einfügen', onClick: seedDemo },
    '-',
    { label: 'Alle Daten löschen', onClick: wipe },
    { label: 'Kurzbefehle & Hilfe', onClick: showHelp },
  ], anchor.getBoundingClientRect());
}

function doExport() {
  const blob = new Blob([exportJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `tagwerk-${todayYmd()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function doImport() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      importJson(await file.text());
      app.refresh();
      toast('Daten geladen');
    } catch (err) {
      toast('Datei konnte nicht gelesen werden');
      console.error(err);
    }
    input.remove();
  });
  document.body.append(input);
  input.click();
}

async function wipe() {
  const ok = await choose('Wirklich alle Daten löschen?', [
    { label: 'Ja, alles löschen', value: 'yes', danger: true },
  ], { text: 'Blöcke, Aufgaben und To-dos auf diesem Gerät werden entfernt. Vorher ggf. sichern.' });
  if (ok !== 'yes') return;
  localStorage.removeItem('tagwerk.state.v1');
  location.reload();
}

function showHelp() {
  toast('← → blättern · T heute · D/W Ansicht · N neuer Block · ⌘Z zurück');
}

function seedDemo() {
  const monday = startOfWeek(app.cursor, getState().settings.weekStartsOn);
  const demo = [
    { title: 'Morgenroutine', color: 'gruen', start: 7 * 60, duration: 45, weekdays: [1, 2, 3, 4, 5] },
    { title: 'Deep Work', color: 'blau', start: 9 * 60, duration: 120, weekdays: [1, 2, 3, 4, 5],
      todos: ['Handy weglegen', 'Ziel notieren', 'Timer starten'] },
    { title: 'Mittagspause', color: 'orange', start: 12 * 60 + 30, duration: 45, weekdays: [1, 2, 3, 4, 5] },
    { title: 'Lernsession Statistik', color: 'lila', start: 14 * 60, duration: 90, weekdays: [1, 3],
      todos: ['Skript S. 40–60', 'Altklausur 2023', 'Karteikarten'] },
    { title: 'Sport', color: 'tuerkis', start: 18 * 60, duration: 60, weekdays: [2, 4, 6] },
    { title: 'Wochenrückblick', color: 'grau', start: 17 * 60, duration: 45, weekdays: [0], every: 1 },
    { title: 'Lerngruppe', color: 'pink', start: 16 * 60, duration: 120, weekdays: [5], every: 2 },
  ];
  for (const d of demo) {
    createBlock({
      title: d.title, color: d.color, start: d.start, duration: d.duration,
      date: monday,
      todos: (d.todos || []).map((t) => ({ id: uid(), title: t, done: false })),
      recur: { every: d.every || 1, weekdays: d.weekdays, until: null },
    });
  }
  app.refresh();
  toast('Beispielwoche eingefügt – alles frei verschiebbar');
}

function applyTheme() {
  const theme = getState().settings.theme;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

// ---------- Verdrahtung ----------

function wire() {
  document.getElementById('btn-prev').onclick = () => step(-1);
  document.getElementById('btn-next').onclick = () => step(1);
  document.getElementById('btn-today').onclick = () => { app.cursor = todayYmd(); app.refresh(); };
  document.getElementById('btn-add').onclick = newBlockHere;
  document.getElementById('btn-menu').onclick = (e) => openMainMenu(e.currentTarget);
  document.getElementById('btn-zoom-in').onclick = () => {
    setSetting('hourHeight', Math.min(160, getState().settings.hourHeight + 12)); app.refresh();
  };
  document.getElementById('btn-zoom-out').onclick = () => {
    setSetting('hourHeight', Math.max(32, getState().settings.hourHeight - 12)); app.refresh();
  };
  document.querySelectorAll('.segmented button').forEach((b) => {
    b.onclick = () => app.setView(b.dataset.view);
  });
  document.getElementById('btn-viewtoggle').onclick = () =>
    app.setView(app.view === 'day' ? 'week' : 'day');
  document.getElementById('sheet-backdrop').onclick = () => closeSheet();

  const appEl = document.getElementById('app');
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.onclick = () => {
      appEl.dataset.tab = b.dataset.tab;
      document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('active', x === b));
      if (b.dataset.tab === 'planner') app.refresh();
    };
  });
  appEl.dataset.tab = 'planner';

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      app.refresh();
      return;
    }
    if (typing || isSheetOpen()) return;
    switch (e.key) {
      case 'ArrowLeft': step(-1); break;
      case 'ArrowRight': step(1); break;
      case 't': case 'T': app.cursor = todayYmd(); app.refresh(); break;
      case 'd': case 'D': app.setView('day'); break;
      case 'w': case 'W': app.setView('week'); break;
      case 'n': case 'N': e.preventDefault(); newBlockHere(); break;
      default: break;
    }
  });

  // Tageswechsel über Mitternacht hinweg abfangen.
  let lastToday = todayYmd();
  setInterval(() => {
    if (todayYmd() !== lastToday) { lastToday = todayYmd(); app.refresh(); }
  }, 60000);

  window.addEventListener('resize', () => app.refresh());
}

applyTheme();
initGrid(app);
initPanels(app);
wire();
app.refresh();
checkIncomingTransfer(app);
// Wird der Übertragungslink in die schon geöffnete App eingefügt, ändert sich nur die Adresse.
window.addEventListener('hashchange', () => checkIncomingTransfer(app));

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
  });
}
