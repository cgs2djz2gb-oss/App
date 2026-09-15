// Seitenleiste: Wochenaufgaben, Tages-To-dos, Überblick.
import { weekKey, addDays, fmtDateShort, fmtHours, DOW_SHORT, dowOf, fmtDateLong, todayYmd } from './dates.js';
import {
  getState, addWeekTask, updateWeekTask, removeWeekTask, carryOverWeekTasks,
  addDayTodo, updateDayTodo, removeDayTodo, categoryName, COLORS,
} from './store.js';
import { occurrencesByDate, plannedMinutes, doneMinutes, findFreeSlot } from './recurrence.js';
import { timeAtPoint, showDropPreview, clearDropPreview } from './grid.js';
import { el, toast } from './ui.js';

let app = null;

export function initPanels(appRef) {
  app = appRef;
  document.getElementById('form-weektask').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('input-weektask');
    const title = input.value.trim();
    if (!title) return;
    addWeekTask(app.cursor, title);
    input.value = '';
    app.refresh();
  });
  document.getElementById('form-daytodo').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('input-daytodo');
    const title = input.value.trim();
    if (!title) return;
    addDayTodo(app.cursor, title);
    input.value = '';
    app.refresh();
  });
  initDropTarget();
  document.getElementById('btn-carry').addEventListener('click', () => {
    const from = weekKey(addDays(app.cursor, -7));
    const to = weekKey(app.cursor);
    const n = carryOverWeekTasks(from, to);
    app.refresh();
    toast(n ? `${n} Aufgabe(n) übernommen` : 'Keine offenen Aufgaben aus der Vorwoche');
  });
}

function taskRow({ task, onToggle, onRename, onRemove, onSchedule, onDone }) {
  const text = el('span', { class: 't-text', text: task.title, title: 'Klicken zum Umbenennen' });
  text.addEventListener('click', () => {
    const input = el('input', { type: 'text', value: task.title, style: 'flex:1;min-width:0' });
    const commit = () => {
      const v = input.value.trim();
      if (v && v !== task.title) onRename(v); else app.refresh();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = task.title; input.blur(); }
    });
    text.replaceWith(input);
    input.focus();
    input.select();
  });

  const row = el('li', {
    class: task.done ? 'done' : '',
    draggable: onSchedule ? 'true' : null,
    title: onSchedule ? 'In den Kalender ziehen, um sie einzuplanen' : null,
  }, [
    el('input', { type: 'checkbox', class: 'cb', checked: task.done, onchange: (e) => onToggle(e.target.checked) }),
    text,
    el('div', { class: 'row-actions' }, [
      onSchedule && el('button', { class: 'mini-btn', type: 'button', title: 'Als Block einplanen', onclick: onSchedule }, ['📅']),
      el('button', { class: 'mini-btn', type: 'button', title: 'Löschen', onclick: onRemove }, ['✕']),
    ]),
  ]);

  if (onSchedule) {
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', task.title);
      dragged = { title: task.title, onDone };
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      dragged = null;
      clearDropPreview();
    });
  }
  return row;
}

// Aufgabe, die gerade in den Kalender gezogen wird.
let dragged = null;

/** Ziehen aus der Seitenleiste ins Raster: Vorschau zeigen, beim Loslassen Block anlegen. */
function initDropTarget() {
  const columns = document.getElementById('columns');
  columns.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    showDropPreview(timeAtPoint(e.clientX, e.clientY));
  });
  columns.addEventListener('dragleave', (e) => {
    if (!columns.contains(e.relatedTarget)) clearDropPreview();
  });
  columns.addEventListener('drop', (e) => {
    if (!dragged) return;
    e.preventDefault();
    const spot = timeAtPoint(e.clientX, e.clientY);
    clearDropPreview();
    if (!spot) return;
    const { title, onDone } = dragged;
    dragged = null;
    app.openEditor(null, { date: spot.date, start: spot.start, duration: 60, title });
    if (onDone) {
      toast('Eingeplant', { label: 'Aufgabe abhaken', onClick: onDone });
    }
  });
}

/** Aufgabe in einen freien Zeitblock am aktuellen Tag verwandeln. */
function scheduleTask(title) {
  const state = getState();
  const date = app.cursor;
  const occs = occurrencesByDate(state, date, date).get(date) || [];
  const dayStart = state.settings.dayStart * 60;
  const dayEnd = state.settings.dayEnd * 60;
  const now = date === todayYmd() ? Math.max(dayStart, Math.floor(new Date().getHours() * 60 / 15) * 15) : dayStart + 120;
  const start = findFreeSlot(occs, Math.min(now, dayEnd - 60), 60, dayEnd);
  app.openEditor(null, { date, start, duration: 60, title });
}

export function renderPanels() {
  const state = getState();
  const wk = weekKey(app.cursor);

  // --- Wochenaufgaben ---
  const tasks = state.weekTasks.filter((t) => t.weekKey === wk);
  const openTasks = tasks.filter((t) => !t.done).length;
  const list = document.getElementById('list-weektasks');
  list.replaceChildren(...(tasks.length
    ? tasks.map((t) => taskRow({
        task: t,
        onToggle: (done) => { updateWeekTask(t.id, { done }); app.refresh(); },
        onRename: (title) => { updateWeekTask(t.id, { title }); app.refresh(); },
        onRemove: () => { removeWeekTask(t.id); app.refresh(); },
        onSchedule: () => scheduleTask(t.title),
        onDone: () => { updateWeekTask(t.id, { done: true }); app.refresh(); },
      }))
    : [el('li', { class: 'empty', text: 'Noch nichts für diese Woche.' })]));
  document.getElementById('week-count').textContent = tasks.length ? `${tasks.length - openTasks}/${tasks.length}` : '';

  // --- Tages-To-dos ---
  const todos = state.dayTodos.filter((t) => t.date === app.cursor);
  const openTodos = todos.filter((t) => !t.done).length;
  const dlist = document.getElementById('list-daytodos');
  dlist.replaceChildren(...(todos.length
    ? todos.map((t) => taskRow({
        task: t,
        onToggle: (done) => { updateDayTodo(t.id, { done }); app.refresh(); },
        onRename: (title) => { updateDayTodo(t.id, { title }); app.refresh(); },
        onRemove: () => { removeDayTodo(t.id); app.refresh(); },
        onSchedule: () => scheduleTask(t.title),
        onDone: () => { updateDayTodo(t.id, { done: true }); app.refresh(); },
      }))
    : [el('li', { class: 'empty', text: 'Keine To-dos für diesen Tag.' })]));
  document.getElementById('day-count').textContent = todos.length ? `${todos.length - openTodos}/${todos.length}` : '';
  document.getElementById('day-label').textContent = fmtDateLong(app.cursor);

  renderStats();
}

function renderStats() {
  const state = getState();
  const start = app.weekStart();
  const end = addDays(start, 6);
  const buckets = occurrencesByDate(state, start, end);
  const todayOccs = buckets.get(app.cursor) || occurrencesByDate(state, app.cursor, app.cursor).get(app.cursor) || [];

  const weekOccs = [...buckets.values()].flat();
  const weekMinutes = plannedMinutes(weekOccs);
  const weekDone = doneMinutes(weekOccs);
  const dayMinutes = plannedMinutes(todayOccs);
  const doneCount = todayOccs.filter((o) => o.done).length;
  const max = Math.max(60, ...[...buckets.values()].map((l) => plannedMinutes(l)));

  const bars = el('div', { class: 'bars' }, [...buckets.entries()].map(([date, list]) => {
    const planned = plannedMinutes(list);
    const done = doneMinutes(list);
    return el('div', {
      class: `bar ${date === app.cursor ? 'sel' : ''}`,
      title: `${fmtDateShort(date)}: ${fmtHours(planned)} geplant, davon ${fmtHours(done)} erledigt`,
      onclick: () => app.goToDate(date),
    }, [
      el('i', { style: `height:${Math.round((planned / max) * 100)}%` }, [
        el('u', { style: `height:${planned ? Math.round((done / planned) * 100) : 0}%` }),
      ]),
      el('b', { text: DOW_SHORT[dowOf(date)] }),
    ]);
  }));

  document.getElementById('stats').replaceChildren(
    el('div', { class: 'stat' }, [el('div', { class: 'v', text: fmtHours(dayMinutes) }), el('div', { class: 'k', text: 'geplant am Tag' })]),
    el('div', { class: 'stat' }, [el('div', { class: 'v', text: fmtHours(weekMinutes) }), el('div', { class: 'k', text: 'geplant in der Woche' })]),
    el('div', { class: 'stat' }, [el('div', { class: 'v', text: `${doneCount}/${todayOccs.length}` }), el('div', { class: 'k', text: 'Blöcke heute erledigt' })]),
    el('div', { class: 'stat' }, [
      el('div', { class: 'v', text: weekMinutes ? `${Math.round((weekDone / weekMinutes) * 100)} %` : '–' }),
      el('div', { class: 'k', text: 'der Woche geschafft' }),
    ]),
    bars,
    ...categoryRows(weekOccs, weekMinutes),
  );
}

/** Wochenstunden nach Farbe/Kategorie aufgeschlüsselt. */
function categoryRows(weekOccs, weekMinutes) {
  if (!weekOccs.length) return [];
  const byColor = new Map();
  for (const o of weekOccs) {
    const entry = byColor.get(o.color) || { planned: 0, done: 0 };
    entry.planned += o.duration;
    if (o.done) entry.done += o.duration;
    byColor.set(o.color, entry);
  }
  const rows = [...byColor.entries()]
    .sort((a, b) => b[1].planned - a[1].planned)
    .map(([color, v]) => el('div', {
      class: 'cat-row',
      title: `${fmtHours(v.done)} von ${fmtHours(v.planned)} erledigt`,
    }, [
      el('span', { class: 'cat-dot', style: `background:var(--c-${color})` }),
      el('span', { class: 'cat-name', text: categoryName(color) }),
      el('span', { class: 'cat-bar' }, [
        el('i', { style: `width:${Math.round((v.planned / weekMinutes) * 100)}%;background:var(--c-${color})` }),
      ]),
      el('span', { class: 'cat-h', text: fmtHours(v.planned) }),
    ]));

  return [
    el('div', { class: 'cat-head' }, [
      el('span', { text: 'Woche nach Kategorie' }),
      el('button', { class: 'link-btn', style: 'padding:0', onclick: () => app.openCategories() }, ['benennen']),
    ]),
    ...rows,
  ];
}
