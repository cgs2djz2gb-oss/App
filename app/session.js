// Fokus-Session: einen Block als Zeitblock wirklich durchziehen –
// Countdown, Checkliste, am Ende als erledigt markieren.
import { fmtTime, fmtDuration, addDays } from './dates.js';
import { getState, setSession, patchOccurrence, toggleOccurrenceTodo } from './store.js';
import { occurrencesByDate } from './recurrence.js';
import { el, toast } from './ui.js';

let app = null;
let ticker = null;

export function initSession(appRef) {
  app = appRef;
  document.getElementById('session-pill').addEventListener('click', () => openFocus());
  document.getElementById('focus').addEventListener('click', (e) => {
    if (e.target.id === 'focus') closeFocus();
  });
  // Nach einem Neustart weiterlaufen lassen.
  renderPill();
  startTicker();
}

const session = () => getState().session;

/**
 * Den Termin zur laufenden Session heraussuchen. Er darf zwischendurch
 * verschoben worden sein, deshalb wird ein paar Tage im Umkreis gesucht.
 */
function sessionOccurrence() {
  const s = session();
  if (!s) return null;
  const anchor = s.date || s.anchorDate;
  const buckets = occurrencesByDate(getState(), addDays(anchor, -3), addDays(anchor, 3));
  for (const list of buckets.values()) {
    const hit = list.find((o) => o.blockId === s.blockId && o.anchorDate === s.anchorDate);
    if (hit) return hit;
  }
  return null;
}

function remainingMs() {
  const s = session();
  if (!s) return 0;
  if (s.remaining !== null && s.remaining !== undefined) return Math.max(0, s.remaining);
  return Math.max(0, s.endsAt - Date.now());
}

const isPaused = () => !!session() && session().remaining !== null && session().remaining !== undefined;

function fmtClock(ms) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function startSession(occ) {
  const minutes = Math.max(1, occ.duration);
  setSession({
    blockId: occ.blockId,
    anchorDate: occ.anchorDate,
    date: occ.date,
    plannedMs: minutes * 60000,
    endsAt: Date.now() + minutes * 60000,
    remaining: null,
    alerted: false,
  });
  openFocus();
  startTicker();
  app.refresh();
}

export function endSession({ markDone = false } = {}) {
  const s = session();
  if (!s) return;
  if (markDone) {
    const occ = sessionOccurrence();
    patchOccurrence(s.blockId, s.anchorDate, { done: true }, occ && occ.isRecurring ? 'single' : 'series');
  }
  setSession(null);
  closeFocus();
  stopTicker();
  app.refresh();
  toast(markDone ? 'Session erledigt – gut gemacht' : 'Session beendet');
}

function togglePause() {
  const s = session();
  if (!s) return;
  if (isPaused()) setSession({ ...s, endsAt: Date.now() + s.remaining, remaining: null });
  else setSession({ ...s, remaining: remainingMs() });
  render();
}

function extend(minutes) {
  const s = session();
  if (!s) return;
  if (isPaused()) setSession({ ...s, remaining: remainingMs() + minutes * 60000, alerted: false });
  else setSession({ ...s, endsAt: Math.max(Date.now(), s.endsAt) + minutes * 60000, alerted: false });
  render();
}

// ---------- Darstellung ----------

export function openFocus() {
  if (!session()) return;
  document.getElementById('focus').hidden = false;
  render();
}

export function closeFocus() {
  document.getElementById('focus').hidden = true;
}

function startTicker() {
  stopTicker();
  if (!session()) return;
  ticker = setInterval(() => {
    const s = session();
    if (!s) { stopTicker(); return; }
    if (!isPaused() && remainingMs() === 0 && !s.alerted) {
      setSession({ ...s, alerted: true });
      announceEnd();
    }
    render();
  }, 500);
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

function announceEnd() {
  if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ctx.destination);
    [880, 1174].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      const at = ctx.currentTime + i * 0.28;
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      osc.start(at);
      osc.stop(at + 0.26);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* Ton ist Beiwerk */ }
}

let renderedFor = null;

function render() {
  renderPill();
  const box = document.getElementById('focus');
  if (box.hidden) { renderedFor = null; return; }
  const s = session();
  if (!s) { closeFocus(); return; }

  const occ = sessionOccurrence();
  if (!occ) { endSession(); return; }

  const left = remainingMs();
  const done = left === 0;
  const progress = Math.min(1, 1 - left / (s.plannedMs || 1));
  const circumference = 2 * Math.PI * 52;
  const doneTodos = occ.todos.filter((t) => t.done).length;

  // Zwischen den Sekunden reicht es, Zahl und Ring zu aktualisieren –
  // ein kompletter Neuaufbau würde den Tastaturfokus wegnehmen.
  const signature = [occ.key, occ.title, occ.duration, doneTodos, occ.todos.length, done, isPaused()].join('|');
  if (renderedFor === signature && box.firstChild) {
    box.querySelector('.focus-clock').textContent = done ? 'Zeit ist um' : fmtClock(left);
    const ring = box.querySelector('.ring-value');
    if (ring) ring.setAttribute('stroke-dashoffset', `${circumference * (1 - progress)}`);
    return;
  }
  renderedFor = signature;

  box.replaceChildren(el('div', { class: `focus-card ${done ? 'is-done' : ''}`, style: `--fg-c:var(--c-${occ.color});--bg-c:var(--c-${occ.color}-bg)` }, [
    el('div', { class: 'focus-head' }, [
      el('div', {}, [
        el('div', { class: 'focus-title', text: occ.title || 'Ohne Titel' }),
        el('div', { class: 'focus-sub', text: `${fmtTime(occ.start)}–${fmtTime(occ.start + occ.duration)} · geplant ${fmtDuration(occ.duration)}` }),
      ]),
      el('button', { class: 'icon-btn', title: 'Schließen (Session läuft weiter)', onclick: closeFocus }, ['✕']),
    ]),

    el('div', { class: 'focus-ring' }, [
      ringSvg(progress, circumference),
      el('div', { class: 'focus-time' }, [
        el('div', { class: 'focus-clock', text: done ? 'Zeit ist um' : fmtClock(left) }),
        el('div', { class: 'focus-state', text: done ? 'Verlängern oder abschließen' : (isPaused() ? 'Pausiert' : 'läuft') }),
      ]),
    ]),

    el('div', { class: 'focus-actions' }, [
      el('button', { class: 'btn', onclick: () => extend(5) }, ['+5 min']),
      el('button', { class: 'btn', onclick: togglePause }, [isPaused() ? 'Weiter' : 'Pause']),
      el('button', { class: 'btn primary', onclick: () => endSession({ markDone: true }) }, ['Erledigt']),
    ]),

    occ.todos.length > 0 && el('div', { class: 'focus-todos' }, [
      el('div', { class: 'focus-todos-head', text: `Schritte ${doneTodos}/${occ.todos.length}` }),
      el('ul', { class: 'task-list' }, occ.todos.map((t) => el('li', { class: t.done ? 'done' : '' }, [
        el('input', {
          type: 'checkbox', class: 'cb', checked: t.done,
          onchange: (e) => {
            toggleOccurrenceTodo(occ.blockId, occ.anchorDate, t.id, e.target.checked);
            render();
            app.refresh();
          },
        }),
        el('span', { class: 't-text', text: t.title }),
      ]))),
    ]),

    occ.notes && el('p', { class: 'focus-notes', text: occ.notes }),
    el('button', { class: 'link-btn focus-stop', onclick: () => endSession() }, ['Session abbrechen']),
  ]));
}

function ringSvg(progress, circumference) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'ring');
  const mk = (cls, extra = {}) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', '60');
    c.setAttribute('cy', '60');
    c.setAttribute('r', '52');
    c.setAttribute('class', cls);
    for (const [k, v] of Object.entries(extra)) c.setAttribute(k, v);
    return c;
  };
  svg.append(mk('ring-track'));
  svg.append(mk('ring-value', {
    'stroke-dasharray': `${circumference}`,
    'stroke-dashoffset': `${circumference * (1 - progress)}`,
  }));
  return svg;
}

export function renderPill() {
  const pill = document.getElementById('session-pill');
  const s = session();
  if (!s) { pill.hidden = true; return; }
  const occ = sessionOccurrence();
  pill.hidden = false;
  const left = remainingMs();
  pill.textContent = left === 0 ? '⏱ fertig' : `⏱ ${fmtClock(left)}`;
  pill.title = occ ? `Fokus: ${occ.title}` : 'Fokus-Session';
  pill.classList.toggle('paused', isPaused());
  pill.classList.toggle('over', left === 0);
}
