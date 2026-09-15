// Editor-Sheet für einen Block (Termin) – anlegen, bearbeiten, wiederholen, Checkliste.
import { fmtTime, parseTime, fmtDateShort, DOW_SHORT, addDays } from './dates.js';
import {
  COLORS, uid, createBlock, patchOccurrence, moveOccurrence, deleteOccurrence,
  toggleOccurrenceTodo, getBlock,
} from './store.js';
import { el, openSheet, closeSheet, toast, choose } from './ui.js';
import { startSession } from './session.js';

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mo … So

/**
 * @param {object|null} occ  bestehender Termin oder null
 * @param {object} draft     Vorgaben für neue Blöcke { date, start, duration, title }
 * @param {object} app       App-Kontext (refresh)
 */
export function openBlockEditor(occ, draft, app) {
  const isNew = !occ;
  const block = occ ? getBlock(occ.blockId) : null;
  const model = isNew
    ? {
        title: draft.title || '',
        color: draft.color || 'blau',
        notes: '',
        date: draft.date,
        start: draft.start,
        duration: draft.duration || 60,
        done: false,
        todos: [],
        recur: draft.recur || null,
      }
    : {
        title: occ.title,
        color: occ.color,
        notes: occ.notes || '',
        date: occ.date,
        start: occ.start,
        duration: occ.duration,
        done: occ.done,
        todos: occ.todos.map((t) => ({ ...t })),
        recur: block && block.recur ? { ...block.recur, weekdays: [...block.recur.weekdays] } : null,
      };

  let scope = 'single';
  const wasRecurring = !!(block && block.recur);

  const titleInput = el('input', {
    type: 'text', value: model.title, placeholder: 'z. B. Lernsession Analysis',
    oninput: (e) => { model.title = e.target.value; },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } },
  });

  const swatches = el('div', { class: 'swatches' }, COLORS.map((c) =>
    el('button', {
      type: 'button', class: 'swatch', title: c.label,
      style: `background:var(--c-${c.id});`,
      'aria-pressed': model.color === c.id ? 'true' : 'false',
      onclick: (e) => {
        model.color = c.id;
        e.currentTarget.parentElement.querySelectorAll('.swatch').forEach((s, i) =>
          s.setAttribute('aria-pressed', COLORS[i].id === c.id ? 'true' : 'false'));
      },
    })));

  const dateInput = el('input', { type: 'date', value: model.date, onchange: (e) => { model.date = e.target.value || model.date; } });
  const startInput = el('input', {
    type: 'time', step: '300', value: fmtTime(model.start),
    onchange: (e) => { const v = parseTime(e.target.value); if (v !== null) model.start = v; },
  });
  const durInput = el('input', {
    type: 'number', min: '5', step: '5', value: String(model.duration),
    onchange: (e) => { model.duration = Math.max(5, Number(e.target.value) || 60); },
  });

  // ---- Wiederholung ----
  const recurChips = el('div', { class: 'chips' });
  const dowPicker = el('div', { class: 'dow-picker' });
  const untilWrap = el('div', { class: 'field' });

  function renderRecur() {
    const every = model.recur ? model.recur.every : 0;
    const options = [
      { label: 'Nie', value: 0 },
      { label: 'Wöchentlich', value: 1 },
      { label: 'Alle 2 Wochen', value: 2 },
      { label: 'Alle 3 Wochen', value: 3 },
      { label: 'Alle 4 Wochen', value: 4 },
    ];
    recurChips.replaceChildren(...options.map((o) =>
      el('button', {
        type: 'button', class: 'chip', 'aria-pressed': every === o.value ? 'true' : 'false',
        onclick: () => {
          if (o.value === 0) model.recur = null;
          else {
            const weekdays = model.recur && model.recur.weekdays.length
              ? model.recur.weekdays
              : [new Date(model.date + 'T00:00').getDay()];
            model.recur = { every: o.value, weekdays, until: model.recur ? model.recur.until : null };
          }
          renderRecur();
        },
      }, [o.label])));

    dowPicker.replaceChildren(...DOW_ORDER.map((d) =>
      el('button', {
        type: 'button', 'aria-pressed': model.recur && model.recur.weekdays.includes(d) ? 'true' : 'false',
        onclick: () => {
          if (!model.recur) return;
          const set = new Set(model.recur.weekdays);
          if (set.has(d)) set.delete(d); else set.add(d);
          if (!set.size) set.add(d);
          model.recur.weekdays = [...set].sort();
          renderRecur();
        },
      }, [DOW_SHORT[d]])));
    dowPicker.hidden = !model.recur;

    untilWrap.replaceChildren(
      el('label', { text: 'Serienende (optional)' }),
      el('input', {
        type: 'date', value: model.recur && model.recur.until ? model.recur.until : '',
        onchange: (e) => { if (model.recur) model.recur.until = e.target.value || null; },
      })
    );
    untilWrap.hidden = !model.recur;
  }
  renderRecur();

  // ---- Checkliste ----
  const checklist = el('ul', { class: 'checklist' });
  function renderChecklist() {
    checklist.replaceChildren(...model.todos.map((t) => el('li', { class: t.done ? 'done' : '' }, [
      el('input', {
        type: 'checkbox', class: 'cb', checked: t.done,
        onchange: (e) => {
          t.done = e.target.checked;
          if (!isNew) toggleOccurrenceTodo(occ.blockId, occ.anchorDate, t.id, t.done);
          renderChecklist();
          app.refresh();
        },
      }),
      el('input', { type: 'text', value: t.title, placeholder: 'Schritt…', oninput: (e) => { t.title = e.target.value; } }),
      el('button', { class: 'mini-btn', type: 'button', title: 'Entfernen', onclick: () => {
        model.todos = model.todos.filter((x) => x !== t); renderChecklist();
      } }, ['✕']),
    ])));
    checklist.append(el('li', {}, [
      el('button', { class: 'link-btn', type: 'button', onclick: () => {
        model.todos.push({ id: uid(), title: '', done: false });
        renderChecklist();
        const inputs = checklist.querySelectorAll('input[type="text"]');
        inputs[inputs.length - 1]?.focus();
      } }, ['+ Schritt hinzufügen']),
    ]));
  }
  renderChecklist();

  // ---- Bereichswahl bei Serien ----
  const scopeWrap = el('div', { class: 'field' }, [
    el('label', { text: 'Änderungen gelten für' }),
    el('div', { class: 'chips' }, [
      el('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', dataset: { scope: 'single' } }, ['Nur diesen Termin']),
      el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', dataset: { scope: 'series' } }, ['Ganze Serie']),
    ]),
  ]);
  scopeWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scope]');
    if (!btn) return;
    scope = btn.dataset.scope;
    scopeWrap.querySelectorAll('[data-scope]').forEach((b) =>
      b.setAttribute('aria-pressed', b.dataset.scope === scope ? 'true' : 'false'));
    syncScope();
  });

  // Der Rhythmus gehört zur Serie – bei „Nur diesen Termin" ist er nicht änderbar.
  const recurField = el('div', { class: 'field' }, [
    el('label', { text: 'Wiederholung' }), recurChips, dowPicker,
  ]);
  function syncScope() {
    const locked = wasRecurring && scope === 'single';
    recurField.style.opacity = locked ? '.45' : '';
    recurField.style.pointerEvents = locked ? 'none' : '';
    untilWrap.style.opacity = locked ? '.45' : '';
    untilWrap.style.pointerEvents = locked ? 'none' : '';
    recurHint.hidden = !locked;
  }
  const recurHint = el('p', { class: 'hint', text: 'Rhythmus ändern? Oben auf „Ganze Serie" umschalten.' });
  scopeWrap.hidden = isNew || !wasRecurring;

  function save() {
    const values = {
      title: model.title.trim(),
      color: model.color,
      notes: model.notes,
      duration: model.duration,
      done: model.done,
      todos: model.todos.filter((t) => t.title.trim() !== '' || t.done),
      recur: model.recur,
    };

    if (isNew) {
      createBlock({ ...values, date: model.date, start: model.start });
      closeSheet();
      app.refresh();
      toast('Block angelegt');
      return;
    }

    const useSeries = !wasRecurring || scope === 'series';
    if (useSeries) {
      const patch = { ...values };
      if (!wasRecurring) { patch.date = model.date; patch.start = model.start; }
      patchOccurrence(occ.blockId, occ.anchorDate, patch, 'series');
      if (wasRecurring && (model.date !== occ.date || model.start !== occ.start)) {
        // Wochentag/Uhrzeit der ganzen Serie verschieben, ohne den Serienstart zu verlegen.
        moveOccurrence(occ.blockId, occ.anchorDate, model.date, model.start, 'series');
      }
    } else {
      // Serienvorlage darf Struktur behalten – nur dieser Termin weicht ab.
      patchOccurrence(occ.blockId, occ.anchorDate, {
        title: values.title, color: values.color, notes: values.notes,
        duration: values.duration, done: values.done,
      }, 'single');
      if (model.date !== occ.date || model.start !== occ.start) {
        moveOccurrence(occ.blockId, occ.anchorDate, model.date, model.start, 'single');
      }
      // Checklisten-Einträge gehören zur Vorlage, Haken zum Einzeltermin.
      patchOccurrence(occ.blockId, occ.anchorDate, { todos: values.todos.map((t) => ({ ...t, done: false })) }, 'series');
    }
    closeSheet();
    app.refresh();
  }

  async function remove() {
    if (wasRecurring) {
      const answer = await choose('Serientermin löschen', [
        { label: 'Nur diesen Termin', value: 'single', danger: true },
        { label: 'Ganze Serie', value: 'series', danger: true },
      ]);
      if (!answer) return;
      deleteOccurrence(occ.blockId, occ.anchorDate, answer);
    } else {
      deleteOccurrence(occ.blockId, occ.date, 'series');
    }
    closeSheet();
    app.refresh();
    toast('Gelöscht');
  }

  function duplicate() {
    createBlock({
      title: model.title, color: model.color, notes: model.notes,
      date: model.date, start: model.start, duration: model.duration,
      todos: model.todos.map((t) => ({ ...t, id: uid(), done: false })),
      recur: null,
    });
    closeSheet();
    app.refresh();
    toast('Kopie angelegt');
  }

  const content = el('div', {}, [
    el('div', { class: 'sheet-head' }, [
      el('h2', { text: isNew ? 'Neuer Block' : 'Block bearbeiten' }),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => closeSheet() }, ['Abbrechen']),
      el('button', { class: 'btn primary', type: 'button', onclick: save }, ['Sichern']),
    ]),
    el('div', { class: 'sheet-body' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Titel' }), titleInput]),
      el('div', { class: 'field' }, [el('label', { text: 'Farbe' }), swatches]),
      el('div', { class: 'row3' }, [
        el('div', { class: 'field' }, [el('label', { text: 'Datum' }), dateInput]),
        el('div', { class: 'field' }, [el('label', { text: 'Beginn' }), startInput]),
        el('div', { class: 'field' }, [el('label', { text: 'Dauer (min)' }), durInput]),
      ]),
      scopeWrap,
      recurField,
      recurHint,
      untilWrap,
      el('div', { class: 'field' }, [
        el('label', { text: 'Checkliste für diese Session' }),
        checklist,
        wasRecurring && el('p', { class: 'hint', text: 'Haken gelten nur für diesen Termin – die Schritte selbst für die ganze Serie.' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Notizen' }),
        el('textarea', { placeholder: 'Material, Ziel, Link…', oninput: (e) => { model.notes = e.target.value; } }, [model.notes]),
      ]),
      !isNew && el('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:8px' }, [
        el('input', { type: 'checkbox', class: 'cb', checked: model.done, onchange: (e) => { model.done = e.target.checked; } }),
        el('span', { text: 'Erledigt' }),
      ]),
      !isNew && el('button', { class: 'btn primary', type: 'button', style: 'height:38px', onclick: () => {
        closeSheet();
        startSession(occ);
      } }, ['Fokus-Session starten']),
      el('div', { class: 'sheet-actions' }, [
        !isNew && el('button', { class: 'btn danger', type: 'button', onclick: remove }, ['Löschen']),
        el('div', { class: 'spacer', style: 'flex:1' }),
        !isNew && el('button', { class: 'btn', type: 'button', onclick: duplicate }, ['Duplizieren']),
      ]),
      !isNew && wasRecurring && el('p', { class: 'series-note', text:
        `Serie: ${describeRecur(model.recur)} · nächster Termin ${fmtDateShort(addDays(occ.date, 7))} (ungefähr)` }),
    ]),
  ]);

  syncScope();
  openSheet(content);
  if (isNew) setTimeout(() => { titleInput.focus(); titleInput.select(); }, 30);
}

export function describeRecur(recur) {
  if (!recur) return 'einmalig';
  const days = recur.weekdays.length
    ? DOW_ORDER.filter((d) => recur.weekdays.includes(d)).map((d) => DOW_SHORT[d]).join(', ')
    : '';
  const rhythm = recur.every === 1 ? 'wöchentlich' : `alle ${recur.every} Wochen`;
  return `${rhythm}${days ? ` (${days})` : ''}${recur.until ? `, bis ${fmtDateShort(recur.until)}` : ''}`;
}
