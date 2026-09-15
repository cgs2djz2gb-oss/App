// Logiktests ohne Browser: node tests/run.mjs
import { strict as assert } from 'node:assert';

// Minimaler localStorage-Ersatz für Node.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { weekKey, addDays, startOfWeek, isoWeek, fmtTime, parseTime, fmtDuration, dowOf } = await import('../app/dates.js');
const store = await import('../app/store.js');
const { occurrencesByDate, layoutDay, findFreeSlot } = await import('../app/recurrence.js');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- Datum ----------
test('ISO-Kalenderwochen', () => {
  assert.equal(weekKey('2026-01-01'), '2026-W01');
  assert.equal(weekKey('2025-12-29'), '2026-W01');
  assert.equal(isoWeek('2026-09-15').week, 38);
});

test('Tagesarithmetik über Monats- und Zeitumstellungsgrenzen', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30'); // Sommerzeitumstellung DE
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('Wochenstart ist Montag', () => {
  assert.equal(startOfWeek('2026-09-15'), '2026-09-14');
  assert.equal(startOfWeek('2026-09-14'), '2026-09-14');
  assert.equal(startOfWeek('2026-09-20'), '2026-09-14'); // Sonntag gehört zur Vorwoche
});

test('Zeitformate', () => {
  assert.equal(fmtTime(555), '09:15');
  assert.equal(parseTime('14:30'), 870);
  assert.equal(fmtDuration(90), '1 h 30 min');
  assert.equal(fmtDuration(45), '45 min');
});

// ---------- Serien ----------
function freshState() {
  mem.clear();
  store.load();
  return store.getState();
}

test('Wöchentliche Serie trifft alle gewählten Wochentage', () => {
  freshState();
  store.createBlock({
    title: 'Deep Work', date: '2026-09-14', start: 540, duration: 120,
    recur: { every: 1, weekdays: [1, 3, 5], until: null },
  });
  const b = occurrencesByDate(store.getState(), '2026-09-14', '2026-09-20');
  const hits = [...b.entries()].filter(([, l]) => l.length).map(([d]) => d);
  assert.deepEqual(hits, ['2026-09-14', '2026-09-16', '2026-09-18']);
});

test('Zweiwöchentliche Serie überspringt die Zwischenwoche', () => {
  freshState();
  store.createBlock({
    title: 'Lerngruppe', date: '2026-09-18', start: 960, duration: 120,
    recur: { every: 2, weekdays: [5], until: null },
  });
  const state = store.getState();
  const has = (d) => (occurrencesByDate(state, d, d).get(d) || []).length === 1;
  assert.ok(has('2026-09-18'), 'Starttermin');
  assert.ok(!has('2026-09-25'), 'Woche dazwischen ist frei');
  assert.ok(has('2026-10-02'), 'zwei Wochen später');
  assert.ok(has('2026-10-16'), 'vier Wochen später');
});

test('Serienende wird beachtet', () => {
  freshState();
  store.createBlock({
    title: 'Kurs', date: '2026-09-14', start: 600, duration: 60,
    recur: { every: 1, weekdays: [1], until: '2026-09-28' },
  });
  const state = store.getState();
  const has = (d) => (occurrencesByDate(state, d, d).get(d) || []).length === 1;
  assert.ok(has('2026-09-28'));
  assert.ok(!has('2026-10-05'));
});

test('Einzeltermin verschieben lässt die Serie unberührt', () => {
  freshState();
  const id = store.createBlock({
    title: 'Sport', date: '2026-09-14', start: 1080, duration: 60,
    recur: { every: 1, weekdays: [1], until: null },
  });
  store.moveOccurrence(id, '2026-09-21', '2026-09-22', 1140, 'single');
  const state = store.getState();
  const at = (d) => occurrencesByDate(state, d, d).get(d) || [];
  assert.equal(at('2026-09-21').length, 0, 'ursprünglicher Tag ist frei');
  assert.equal(at('2026-09-22')[0].start, 1140, 'liegt am neuen Tag');
  assert.equal(at('2026-09-14')[0].start, 1080, 'Vorwoche unverändert');
  assert.equal(at('2026-09-28')[0].start, 1080, 'Folgewoche unverändert');
});

test('Serienweite Änderung überschreibt alle Termine', () => {
  freshState();
  const id = store.createBlock({
    title: 'Sport', date: '2026-09-14', start: 1080, duration: 60,
    recur: { every: 1, weekdays: [1], until: null },
  });
  store.patchOccurrence(id, '2026-09-14', { start: 1200, title: 'Laufen' }, 'series');
  const state = store.getState();
  for (const d of ['2026-09-14', '2026-09-21', '2026-09-28']) {
    const occ = (occurrencesByDate(state, d, d).get(d) || [])[0];
    assert.equal(occ.start, 1200);
    assert.equal(occ.title, 'Laufen');
  }
});

test('Serie als Ganzes auf einen anderen Wochentag schieben', () => {
  freshState();
  const id = store.createBlock({
    title: 'Sport', date: '2026-09-14', start: 1080, duration: 60,
    recur: { every: 1, weekdays: [1], until: null },
  });
  store.moveOccurrence(id, '2026-09-21', '2026-09-22', 1140, 'series');
  const state = store.getState();
  const block = state.blocks[0];
  assert.deepEqual(block.recur.weekdays, [2], 'Montag wird Dienstag');
  assert.equal(block.date, '2026-09-14', 'Serienstart bleibt unverändert');
  assert.equal(block.start, 1140);
  const at = (d) => occurrencesByDate(state, d, d).get(d) || [];
  assert.equal(at('2026-09-15').length, 1, 'erste Woche bereits am Dienstag');
  assert.equal(at('2026-09-14').length, 0);
});

test('Einzelnen Serientermin löschen', () => {
  freshState();
  const id = store.createBlock({
    title: 'Vorlesung', date: '2026-09-15', start: 600, duration: 90,
    recur: { every: 1, weekdays: [2], until: null },
  });
  store.deleteOccurrence(id, '2026-09-22', 'single');
  const state = store.getState();
  assert.equal((occurrencesByDate(state, '2026-09-22', '2026-09-22').get('2026-09-22') || []).length, 0);
  assert.equal((occurrencesByDate(state, '2026-09-29', '2026-09-29').get('2026-09-29') || []).length, 1);
});

test('Checklisten-Haken gelten pro Termin, nicht pro Serie', () => {
  freshState();
  const id = store.createBlock({
    title: 'Lernsession', date: '2026-09-14', start: 840, duration: 90,
    todos: [{ id: 't1', title: 'Skript lesen', done: false }],
    recur: { every: 1, weekdays: [1], until: null },
  });
  store.toggleOccurrenceTodo(id, '2026-09-14', 't1', true);
  const state = store.getState();
  const occ = (d) => occurrencesByDate(state, d, d).get(d)[0];
  assert.equal(occ('2026-09-14').todos[0].done, true);
  assert.equal(occ('2026-09-21').todos[0].done, false);
});

test('Einzelblock ohne Serie erscheint genau einmal', () => {
  freshState();
  store.createBlock({ title: 'Zahnarzt', date: '2026-09-17', start: 660, duration: 45 });
  const b = occurrencesByDate(store.getState(), '2026-09-14', '2026-09-20');
  assert.equal([...b.values()].flat().length, 1);
});

// ---------- Layout & Hilfen ----------
test('Überlappende Blöcke bekommen eigene Spalten', () => {
  const occs = [
    { key: 'a', start: 540, duration: 60 },
    { key: 'b', start: 570, duration: 60 },
    { key: 'c', start: 720, duration: 30 },
  ];
  const lanes = layoutDay(occs);
  assert.equal(lanes.get('a').lanes, 2);
  assert.equal(lanes.get('b').lane, 1);
  assert.equal(lanes.get('c').lanes, 1, 'eigener Cluster');
});

test('Freien Slot finden', () => {
  const occs = [{ start: 540, duration: 60 }, { start: 600, duration: 120 }];
  assert.equal(findFreeSlot(occs, 540, 60, 1380), 720);
  assert.equal(findFreeSlot(occs, 900, 60, 1380), 900);
});

// ---------- Aufgaben ----------
test('Wochenaufgaben hängen an der Kalenderwoche', () => {
  freshState();
  store.addWeekTask('2026-09-15', 'Übungsblatt 3');
  store.addWeekTask('2026-09-22', 'Protokoll');
  const tasks = store.getState().weekTasks;
  assert.equal(tasks.filter((t) => t.weekKey === '2026-W38').length, 1);
  const moved = store.carryOverWeekTasks('2026-W38', '2026-W39');
  assert.equal(moved, 1);
  assert.equal(store.getState().weekTasks.filter((t) => t.weekKey === '2026-W39').length, 2);
});

test('Undo stellt den vorherigen Stand wieder her', () => {
  freshState();
  store.createBlock({ title: 'A', date: '2026-09-14', start: 600, duration: 60 });
  assert.equal(store.getState().blocks.length, 1);
  store.undo();
  assert.equal(store.getState().blocks.length, 0);
  store.redo();
  assert.equal(store.getState().blocks.length, 1);
});

test('Export und Import sind verlustfrei', () => {
  freshState();
  store.createBlock({ title: 'Deep Work', date: '2026-09-14', start: 540, duration: 120 });
  store.addDayTodo('2026-09-14', 'Mails');
  const json = store.exportJson();
  freshState();
  store.importJson(json);
  assert.equal(store.getState().blocks[0].title, 'Deep Work');
  assert.equal(store.getState().dayTodos[0].title, 'Mails');
});

test('Zustand überlebt Neuladen (localStorage)', () => {
  freshState();
  store.createBlock({ title: 'Persistenz', date: '2026-09-14', start: 540, duration: 60 });
  store.exportJson();
  // Speichern ist entprellt – hier direkt prüfen, dass der Key gesetzt wird.
  return new Promise((resolve) => setTimeout(() => {
    store.load();
    assert.equal(store.getState().blocks[0].title, 'Persistenz');
    resolve();
  }, 200));
});

const results = [];
for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
    results.push(`  ✓ ${name}`);
  } catch (err) {
    results.push(`  ✗ ${name}\n    ${err.message}`);
  }
}
console.log(results.join('\n'));
console.log(`\n${passed}/${tests.length} Tests bestanden`);
process.exit(passed === tests.length ? 0 : 1);
