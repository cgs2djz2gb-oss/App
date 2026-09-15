// Wochen-Vorlagen: eine gelungene Woche sichern und auf andere Wochen anwenden.
import { addDays, dowOf, fmtTime, fmtDuration, DOW_SHORT, fmtDateShort } from './dates.js';
import { getState, saveTemplate, removeTemplate, renameTemplate, addBlocks, clearOccurrences, uid } from './store.js';
import { occurrencesByDate } from './recurrence.js';
import { el, openSheet, closeSheet, toast, choose } from './ui.js';

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Alle Termine einer Woche in Vorlagen-Einträge umwandeln. */
export function weekToItems(weekStart) {
  const state = getState();
  const buckets = occurrencesByDate(state, weekStart, addDays(weekStart, 6));
  const items = [];
  for (const [date, occs] of buckets) {
    for (const o of occs) {
      items.push({
        dow: dowOf(date),
        start: o.start,
        duration: o.duration,
        title: o.title,
        color: o.color,
        notes: o.notes || '',
        todos: (o.todos || []).map((t) => ({ title: t.title })),
      });
    }
  }
  return items.sort((a, b) => a.dow - b.dow || a.start - b.start);
}

/** Vorlage auf eine Woche anwenden. */
export function applyTemplate(template, weekStart, { replace }) {
  const state = getState();
  if (replace) {
    const buckets = occurrencesByDate(state, weekStart, addDays(weekStart, 6));
    clearOccurrences([...buckets.values()].flat());
  }
  const weekStartsOn = getState().settings.weekStartsOn;
  addBlocks(template.items.map((item) => ({
    title: item.title,
    color: item.color,
    notes: item.notes,
    start: item.start,
    duration: item.duration,
    date: addDays(weekStart, (item.dow - weekStartsOn + 7) % 7),
    todos: (item.todos || []).map((t) => ({ id: uid(), title: t.title, done: false })),
    recur: null,
  })));
}

function summarize(template) {
  const minutes = template.items.reduce((sum, i) => sum + i.duration, 0);
  const days = new Set(template.items.map((i) => i.dow));
  const dayList = DOW_ORDER.filter((d) => days.has(d)).map((d) => DOW_SHORT[d]).join(' ');
  return `${template.items.length} Blöcke · ${fmtDuration(minutes)} · ${dayList}`;
}

export function openTemplateSheet(app) {
  const state = getState();
  const weekStart = app.weekStart();

  const list = el('div', { class: 'field' });
  function renderList() {
    const tpls = getState().templates;
    list.replaceChildren(
      el('label', { text: 'Gesicherte Vorlagen' }),
      ...(tpls.length ? tpls.map((t) => el('div', { class: 'tpl-row' }, [
        el('div', { class: 'tpl-info' }, [
          el('div', { class: 'tpl-name', text: t.name }),
          el('div', { class: 'hint', text: summarize(t) }),
        ]),
        el('button', { class: 'btn small primary', type: 'button', onclick: () => apply(t) }, ['Anwenden']),
        el('button', { class: 'mini-btn', type: 'button', title: 'Umbenennen', onclick: () => {
          const name = prompt('Neuer Name', t.name);
          if (name && name.trim()) { renameTemplate(t.id, name.trim()); renderList(); }
        } }, ['✎']),
        el('button', { class: 'mini-btn', type: 'button', title: 'Löschen', onclick: () => {
          removeTemplate(t.id); renderList();
        } }, ['✕']),
      ])) : [el('p', { class: 'empty', text: 'Noch keine Vorlage gesichert.' })])
    );
  }

  async function apply(t) {
    const mode = await choose(`„${t.name}" anwenden`, [
      { label: 'Woche ersetzen', value: 'replace', primary: true },
      { label: 'Zur Woche hinzufügen', value: 'add' },
    ], { text: `Ziel: Woche ab ${fmtDateShort(weekStart)}. „Ersetzen" räumt die Woche vorher leer – Serien bleiben erhalten und pausieren nur in dieser Woche.` });
    if (!mode) return;
    applyTemplate(t, weekStart, { replace: mode === 'replace' });
    closeSheet();
    app.refresh();
    toast(`„${t.name}" auf die Woche angewendet`, {
      label: 'Rückgängig',
      onClick: () => { app.undoAll(mode === 'replace' ? 2 : 1); },
    });
  }

  const nameInput = el('input', {
    type: 'text',
    placeholder: `Woche ab ${fmtDateShort(weekStart)}`,
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); saveCurrent(); } },
  });

  function saveCurrent() {
    const items = weekToItems(weekStart);
    if (!items.length) { toast('Diese Woche enthält keine Blöcke'); return; }
    const name = nameInput.value.trim() || `Woche ab ${fmtDateShort(weekStart)}`;
    saveTemplate(name, items);
    nameInput.value = '';
    renderList();
    toast(`Vorlage „${name}" gesichert (${items.length} Blöcke)`);
  }

  renderList();
  openSheet(el('div', {}, [
    el('div', { class: 'sheet-head' }, [
      el('h2', { text: 'Wochen-Vorlagen' }),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => closeSheet() }, ['Fertig']),
    ]),
    el('div', { class: 'sheet-body' }, [
      el('p', { class: 'hint', text: 'Einmal die perfekte Woche bauen – und sie danach auf jede andere Woche übertragen.' }),
      el('div', { class: 'field' }, [
        el('label', { text: `Aktuelle Woche sichern (ab ${fmtDateShort(weekStart)})` }),
        el('div', { class: 'add-row' }, [nameInput, el('button', { class: 'btn small', type: 'button', onclick: saveCurrent }, ['Sichern'])]),
      ]),
      list,
    ]),
  ]));
}
