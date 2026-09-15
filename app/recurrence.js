// Serientermine zu konkreten Terminen ("Occurrences") auflösen.
import { addDays, dayIndex, dowOf, startOfWeek } from './dates.js';
import { ovKey } from './store.js';

/** Trifft ein Block an diesem Datum zu? (nur Serienregel, ohne Ausnahmen) */
function seriesHitsDate(block, date, weekStartsOn) {
  const r = block.recur;
  if (!r) return block.date === date;
  if (dayIndex(date) < dayIndex(block.date)) return false;
  if (r.until && dayIndex(date) > dayIndex(r.until)) return false;

  const weekdays = r.weekdays && r.weekdays.length ? r.weekdays : [dowOf(block.date)];
  if (!weekdays.includes(dowOf(date))) return false;

  const every = Math.max(1, r.every || 1);
  if (every === 1) return true;
  const weeksApart =
    (dayIndex(startOfWeek(date, weekStartsOn)) - dayIndex(startOfWeek(block.date, weekStartsOn))) / 7;
  return Math.round(weeksApart) % every === 0;
}

function buildOccurrence(block, anchorDate, override) {
  const ov = override || {};
  const todos = (block.todos || []).map((t) => ({
    ...t,
    done: block.recur ? !!(ov.todoDone && ov.todoDone[t.id]) : !!t.done,
  }));
  return {
    key: ovKey(block.id, anchorDate),
    blockId: block.id,
    block,
    anchorDate,                         // Tag, an dem die Serienregel greift
    date: ov.movedTo || anchorDate,     // tatsächlicher Tag (kann verschoben sein)
    start: ov.start ?? block.start,
    duration: ov.duration ?? block.duration,
    title: ov.title ?? block.title,
    color: ov.color ?? block.color,
    notes: ov.notes ?? block.notes,
    done: ov.done ?? (block.recur ? false : !!block.done),
    todos,
    isRecurring: !!block.recur,
    isException: !!(ov.start || ov.movedTo || ov.duration || ov.title || ov.color),
  };
}

/**
 * Alle Termine im Bereich [fromDate, toDate] (inklusive), gruppiert nach Tag.
 * Verschobene Einzeltermine werden am Zieltag einsortiert.
 */
export function occurrencesByDate(state, fromDate, toDate) {
  const weekStartsOn = state.settings.weekStartsOn;
  const buckets = new Map();
  const from = dayIndex(fromDate);
  const to = dayIndex(toDate);
  for (let i = from; i <= to; i++) buckets.set(addDays(fromDate, i - from), []);

  // Etwas Puffer, damit verschobene Termine aus Nachbartagen hier auftauchen.
  const padFrom = addDays(fromDate, -14);
  const padTo = addDays(toDate, 14);

  for (const block of state.blocks) {
    for (let i = dayIndex(padFrom); i <= dayIndex(padTo); i++) {
      const date = addDays(padFrom, i - dayIndex(padFrom));
      if (!seriesHitsDate(block, date, weekStartsOn)) continue;
      const ov = state.overrides[ovKey(block.id, date)];
      if (ov && ov.deleted) continue;
      const occ = buildOccurrence(block, date, ov);
      const bucket = buckets.get(occ.date);
      if (bucket) bucket.push(occ);
      if (!block.recur) break; // Einzelblöcke gibt es nur einmal
    }
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => a.start - b.start || a.duration - b.duration);
  }
  return buckets;
}

/**
 * Überlappende Termine nebeneinander legen.
 * Liefert für jeden Termin { lane, lanes }.
 */
export function layoutDay(occs) {
  const items = occs.map((o) => ({ occ: o, start: o.start, end: o.start + Math.max(o.duration, 15) }));
  const out = new Map();
  let cluster = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds = [];
    for (const it of cluster) {
      let lane = laneEnds.findIndex((end) => end <= it.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end); }
      else laneEnds[lane] = it.end;
      it.lane = lane;
    }
    for (const it of cluster) out.set(it.occ.key, { lane: it.lane, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

/** Geplante Minuten pro Tag. */
export function plannedMinutes(occs) {
  return occs.reduce((sum, o) => sum + o.duration, 0);
}

/** Nächster freier Slot an einem Tag, ab `fromMin`. */
export function findFreeSlot(occs, fromMin, duration, dayEndMin) {
  const sorted = [...occs].sort((a, b) => a.start - b.start);
  let cursor = fromMin;
  for (const o of sorted) {
    if (o.start + o.duration <= cursor) continue;
    if (o.start - cursor >= duration) return cursor;
    cursor = Math.max(cursor, o.start + o.duration);
  }
  return cursor + duration <= dayEndMin ? cursor : fromMin;
}
