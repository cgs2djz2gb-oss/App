// Zustand + Persistenz (localStorage). Alles läuft lokal auf dem Gerät.
import { todayYmd, weekKey } from './dates.js';

const KEY = 'tagwerk.state.v1';
const BACKUP_KEY = 'tagwerk.backup.v1';
const MAX_UNDO = 60;

export const COLORS = [
  { id: 'blau', label: 'Blau' },
  { id: 'gruen', label: 'Grün' },
  { id: 'lila', label: 'Lila' },
  { id: 'orange', label: 'Orange' },
  { id: 'rot', label: 'Rot' },
  { id: 'tuerkis', label: 'Türkis' },
  { id: 'pink', label: 'Pink' },
  { id: 'grau', label: 'Grau' },
];

export function defaultState() {
  return {
    version: 1,
    settings: {
      dayStart: 6,        // erste sichtbare Stunde
      dayEnd: 23,         // letzte sichtbare Stunde (exklusiv Ende = dayEnd:00)
      snap: 15,           // Raster in Minuten
      weekStartsOn: 1,    // 1 = Montag
      hourHeight: 60,
      view: 'week',
      theme: 'system',
      carryOverTodos: true,
    },
    blocks: [],
    overrides: {},        // "blockId|YYYY-MM-DD" -> { deleted?, start?, duration?, title?, notes?, color?, done?, todoDone? }
    weekTasks: [],        // { id, weekKey, title, done, createdAt }
    dayTodos: [],         // { id, date, title, done, createdAt }
    templates: [],        // { id, name, createdAt, items: [{ dow, start, duration, title, color, notes, todos }] }
    session: null,        // laufende Fokus-Session: { blockId, anchorDate, endsAt, remaining }
  };
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function migrate(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    version: 1,
    settings: { ...base.settings, ...(raw.settings || {}) },
    blocks: Array.isArray(raw.blocks) ? raw.blocks.map(normalizeBlock) : [],
    overrides: raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {},
    weekTasks: Array.isArray(raw.weekTasks) ? raw.weekTasks : [],
    dayTodos: Array.isArray(raw.dayTodos) ? raw.dayTodos : [],
    templates: Array.isArray(raw.templates) ? raw.templates : [],
    session: raw.session && typeof raw.session === 'object' ? raw.session : null,
  };
}

function normalizeBlock(b) {
  return {
    id: b.id || uid(),
    title: b.title || '',
    color: b.color || 'blau',
    notes: b.notes || '',
    date: b.date || todayYmd(),
    start: Number.isFinite(b.start) ? b.start : 540,
    duration: Number.isFinite(b.duration) ? b.duration : 60,
    done: !!b.done,
    todos: Array.isArray(b.todos) ? b.todos : [],
    recur: b.recur
      ? {
          every: b.recur.every || 1,
          weekdays: Array.isArray(b.recur.weekdays) ? b.recur.weekdays : [],
          until: b.recur.until || null,
        }
      : null,
    createdAt: b.createdAt || Date.now(),
  };
}

let state = defaultState();
let undoStack = [];
let redoStack = [];
const listeners = new Set();
let saveTimer = null;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    state = migrate(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.warn('Konnte Daten nicht laden:', err);
    state = defaultState();
  }
  return state;
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(state);
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Speichern fehlgeschlagen:', err);
    }
  }, 120);
}

const snapshot = () => JSON.parse(JSON.stringify(state));

/** Zustand ändern. `fn` bekommt eine Kopie und darf sie mutieren. */
export function mutate(fn, { undoable = true } = {}) {
  const before = snapshot();
  const draft = snapshot();
  const result = fn(draft);
  state = draft;
  if (undoable) {
    undoStack.push(before);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }
  persist();
  notify();
  return result;
}

/** Einstellungen ändern (ohne Undo-Eintrag). */
export function setSetting(key, value) {
  mutate((s) => { s.settings[key] = value; }, { undoable: false });
}

export function canUndo() { return undoStack.length > 0; }

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  state = undoStack.pop();
  persist();
  notify();
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  state = redoStack.pop();
  persist();
  notify();
  return true;
}

export const ovKey = (blockId, date) => `${blockId}|${date}`;

// ---------- Blöcke ----------

export function createBlock(partial) {
  const block = normalizeBlock({ ...partial, id: uid() });
  mutate((s) => { s.blocks.push(block); });
  return block.id;
}

export function getBlock(id) {
  return state.blocks.find((b) => b.id === id) || null;
}

/**
 * Occurrence ändern.
 * scope 'single' schreibt eine Ausnahme für genau diesen Tag,
 * scope 'series' ändert die ganze Serie.
 */
export function patchOccurrence(blockId, date, patch, scope = 'single') {
  mutate((s) => {
    const block = s.blocks.find((b) => b.id === blockId);
    if (!block) return;
    if (scope === 'series' || !block.recur) {
      Object.assign(block, patch);
      if (scope === 'series') {
        // Serienweite Änderungen machen abweichende Einzeltermine hinfällig.
        for (const k of Object.keys(s.overrides)) {
          if (k.startsWith(`${blockId}|`)) {
            const ov = s.overrides[k];
            for (const field of Object.keys(patch)) delete ov[field];
            if (!Object.keys(ov).length) delete s.overrides[k];
          }
        }
      }
    } else {
      const key = ovKey(blockId, date);
      s.overrides[key] = { ...(s.overrides[key] || {}), ...patch };
    }
  });
}

/** Einen Serientermin auf einen anderen Tag/Zeit schieben. */
export function moveOccurrence(blockId, fromDate, toDate, start, scope = 'single') {
  mutate((s) => {
    const block = s.blocks.find((b) => b.id === blockId);
    if (!block) return;
    if (!block.recur) {
      block.date = toDate;
      block.start = start;
      return;
    }
    if (scope === 'series') {
      const shift = new Date(toDate).getDay() - new Date(fromDate).getDay();
      if (shift !== 0 && block.recur.weekdays.length) {
        block.recur.weekdays = block.recur.weekdays.map((d) => (d + shift + 7) % 7).sort();
      }
      block.start = start;
      for (const k of Object.keys(s.overrides)) {
        if (k.startsWith(`${blockId}|`)) {
          delete s.overrides[k].start;
          delete s.overrides[k].movedTo;
          if (!Object.keys(s.overrides[k]).length) delete s.overrides[k];
        }
      }
    } else {
      const key = ovKey(blockId, fromDate);
      s.overrides[key] = { ...(s.overrides[key] || {}), start, movedTo: toDate === fromDate ? undefined : toDate };
      if (s.overrides[key].movedTo === undefined) delete s.overrides[key].movedTo;
    }
  });
}

export function deleteOccurrence(blockId, date, scope = 'single') {
  mutate((s) => {
    const block = s.blocks.find((b) => b.id === blockId);
    if (!block) return;
    if (scope === 'series' || !block.recur) {
      s.blocks = s.blocks.filter((b) => b.id !== blockId);
      for (const k of Object.keys(s.overrides)) {
        if (k.startsWith(`${blockId}|`)) delete s.overrides[k];
      }
    } else {
      const key = ovKey(blockId, date);
      s.overrides[key] = { ...(s.overrides[key] || {}), deleted: true };
    }
  });
}

/** Checklisten-Haken eines Termins setzen (pro Termin, nicht pro Serie). */
export function toggleOccurrenceTodo(blockId, date, todoId, done) {
  mutate((s) => {
    const block = s.blocks.find((b) => b.id === blockId);
    if (!block) return;
    if (!block.recur) {
      const t = block.todos.find((x) => x.id === todoId);
      if (t) t.done = done;
      return;
    }
    const key = ovKey(blockId, date);
    const ov = (s.overrides[key] = s.overrides[key] || {});
    ov.todoDone = { ...(ov.todoDone || {}) };
    if (done) ov.todoDone[todoId] = true;
    else delete ov.todoDone[todoId];
  });
}

// ---------- Wochenaufgaben ----------

export function addWeekTask(date, title) {
  mutate((s) => {
    s.weekTasks.push({ id: uid(), weekKey: weekKey(date), title, done: false, createdAt: Date.now() });
  });
}

export function updateWeekTask(id, patch) {
  mutate((s) => {
    const t = s.weekTasks.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
  });
}

export function removeWeekTask(id) {
  mutate((s) => { s.weekTasks = s.weekTasks.filter((t) => t.id !== id); });
}

/** Offene Aufgaben der Vorwoche in die aktuelle Woche holen. */
export function carryOverWeekTasks(fromKey, toKey) {
  return mutate((s) => {
    const open = s.weekTasks.filter((t) => t.weekKey === fromKey && !t.done);
    for (const t of open) t.weekKey = toKey;
    return open.length;
  });
}

// ---------- Tages-To-dos ----------

export function addDayTodo(date, title) {
  mutate((s) => {
    s.dayTodos.push({ id: uid(), date, title, done: false, createdAt: Date.now() });
  });
}

export function updateDayTodo(id, patch) {
  mutate((s) => {
    const t = s.dayTodos.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
  });
}

export function removeDayTodo(id) {
  mutate((s) => { s.dayTodos = s.dayTodos.filter((t) => t.id !== id); });
}

// ---------- Wochen-Vorlagen ----------

/** Eine Woche als Vorlage sichern. `items` kommt aus den Terminen der Woche. */
export function saveTemplate(name, items) {
  return mutate((s) => {
    const tpl = { id: uid(), name, createdAt: Date.now(), items };
    s.templates.push(tpl);
    return tpl.id;
  });
}

export function renameTemplate(id, name) {
  mutate((s) => {
    const t = s.templates.find((x) => x.id === id);
    if (t) t.name = name;
  });
}

export function removeTemplate(id) {
  mutate((s) => { s.templates = s.templates.filter((t) => t.id !== id); });
}

/** Mehrere Blöcke auf einmal anlegen (ein einziger Undo-Schritt). */
export function addBlocks(list) {
  mutate((s) => {
    for (const b of list) s.blocks.push(normalizeBlock({ ...b, id: uid() }));
  });
}

/**
 * Termine entfernen: Einzelblöcke werden gelöscht, Serientermine
 * bekommen eine Ausnahme – die Serie selbst bleibt bestehen.
 */
export function clearOccurrences(occs) {
  mutate((s) => {
    const singles = new Set();
    for (const o of occs) {
      if (o.isRecurring) {
        const key = ovKey(o.blockId, o.anchorDate);
        s.overrides[key] = { ...(s.overrides[key] || {}), deleted: true };
      } else {
        singles.add(o.blockId);
      }
    }
    s.blocks = s.blocks.filter((b) => !singles.has(b.id));
  });
}

// ---------- Sicherheitsnetz ----------

/**
 * Vor zerstörenden Schritten (Löschen, Ersetzen beim Import) eine Kopie
 * beiseitelegen. Undo hilft nach einem Neuladen nicht mehr, die hier schon.
 */
export function saveBackup(reason) {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      reason,
      state,
    }));
    return true;
  } catch (err) {
    console.warn('Sicherung fehlgeschlagen:', err);
    return false;
  }
}

export function getBackupInfo() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const { savedAt, reason, state: saved } = JSON.parse(raw);
    return {
      savedAt,
      reason,
      blocks: Array.isArray(saved?.blocks) ? saved.blocks.length : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Sicherung zurückholen. Der jetzige Stand wird dabei selbst zur Sicherung –
 * ein zweiter Aufruf führt also wieder zurück.
 */
export function restoreBackup() {
  const raw = localStorage.getItem(BACKUP_KEY);
  if (!raw) return false;
  const { state: saved } = JSON.parse(raw);
  const restored = migrate(saved);
  saveBackup('vor dem Zurückholen');
  mutate((s) => { Object.assign(s, restored); });
  return true;
}

// ---------- Fokus-Session ----------

/** Laufende Session setzen oder mit null beenden (kein Undo-Schritt). */
export function setSession(session) {
  mutate((s) => { s.session = session; }, { undoable: false });
}

// ---------- Export / Import ----------

export function exportJson() {
  // Eine laufende Session gehört zum Gerät, nicht zu den Daten.
  const { session, ...data } = state;
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJson(text, { merge = false } = {}) {
  const incoming = migrate(JSON.parse(text));
  if (!merge && (state.blocks.length || state.weekTasks.length || state.dayTodos.length)) {
    saveBackup('vor dem Ersetzen beim Import');
  }
  mutate((s) => {
    if (!merge) {
      Object.assign(s, incoming, { settings: { ...s.settings, ...incoming.settings } });
      return;
    }
    const known = new Set(s.blocks.map((b) => b.id));
    for (const b of incoming.blocks) if (!known.has(b.id)) s.blocks.push(b);
    s.overrides = { ...incoming.overrides, ...s.overrides };
    const wt = new Set(s.weekTasks.map((t) => t.id));
    for (const t of incoming.weekTasks) if (!wt.has(t.id)) s.weekTasks.push(t);
    const dt = new Set(s.dayTodos.map((t) => t.id));
    for (const t of incoming.dayTodos) if (!dt.has(t.id)) s.dayTodos.push(t);
    const tp = new Set(s.templates.map((t) => t.id));
    for (const t of incoming.templates || []) if (!tp.has(t.id)) s.templates.push(t);
  });
}
