// Datums-Helfer. Alle Datumsangaben sind lokale Kalendertage als "YYYY-MM-DD".

export const DAY_MS = 86400000;
export const DOW_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const DOW_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
  'August', 'September', 'Oktober', 'November', 'Dezember'];

const pad = (n) => String(n).padStart(2, '0');

export function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayYmd() {
  return ymd(new Date());
}

// Tagesindex (UTC-basiert), damit Sommer-/Winterzeit die Arithmetik nicht stört.
export function dayIndex(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayIndex(idx) {
  const d = new Date(idx * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(s, n) {
  return fromDayIndex(dayIndex(s) + n);
}

export function dowOf(s) {
  return parseYmd(s).getDay(); // 0 = Sonntag
}

export function startOfWeek(s, weekStartsOn = 1) {
  const diff = (dowOf(s) - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}

export function weekDays(startYmd, count = 7) {
  return Array.from({ length: count }, (_, i) => addDays(startYmd, i));
}

// ISO-8601 Kalenderwoche
export function isoWeek(s) {
  const d = parseYmd(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7; // Mo = 0
  t.setUTCDate(t.getUTCDate() - dayNum + 3); // Donnerstag dieser Woche
  const year = t.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((t - firstThursday) / (7 * DAY_MS));
  return { year, week };
}

export function weekKey(s) {
  const { year, week } = isoWeek(s);
  return `${year}-W${pad(week)}`;
}

export function fmtTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function parseTime(str) {
  const [h, m] = String(str || '').split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

export function fmtHours(min) {
  return (min / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' h';
}

export function fmtDateLong(s) {
  const d = parseYmd(s);
  return `${DOW_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

export function fmtDateShort(s) {
  const d = parseYmd(s);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}

export function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
