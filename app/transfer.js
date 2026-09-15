// Geräte-Übertragung: den kompletten Stand als Link von Mac zu iPhone (und zurück).
// Bewusst ohne Server – der Link trägt die Daten selbst.
import { exportJson, importJson, getState } from './store.js';
import { el, openSheet, closeSheet, toast, choose } from './ui.js';

const toBase64Url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (str) => {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pack(text) {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return `r${toBase64Url(raw)}`;
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  return `z${toBase64Url(buf)}`;
}

async function unpack(payload) {
  const kind = payload[0];
  const bytes = fromBase64Url(payload.slice(1));
  if (kind === 'r') return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function buildTransferLink() {
  const payload = await pack(exportJson());
  const base = location.origin + location.pathname;
  return `${base}#t=${payload}`;
}

export async function openTransferSheet() {
  const state = getState();
  const link = await buildTransferLink();
  const counts = `${state.blocks.length} Blöcke · ${state.weekTasks.length} Wochenaufgaben · ${state.dayTodos.length} To-dos · ${state.templates.length} Vorlagen`;

  const field = el('textarea', { readonly: true, rows: '4', style: 'font-size:11px;word-break:break-all' }, [link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link kopiert – jetzt z. B. per iMessage aufs andere Gerät schicken');
    } catch {
      field.select();
      toast('Bitte markieren und kopieren');
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'Tagwerk-Daten', url: link });
    } catch { /* abgebrochen */ }
  };

  openSheet(el('div', {}, [
    el('div', { class: 'sheet-head' }, [
      el('h2', { text: 'Auf anderes Gerät übertragen' }),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => closeSheet() }, ['Fertig']),
    ]),
    el('div', { class: 'sheet-body' }, [
      el('p', { class: 'hint', text: `Dieser Link enthält deinen kompletten Stand (${counts}). Auf dem anderen Gerät öffnen – dort kannst du ersetzen oder zusammenführen.` }),
      el('div', { class: 'field' }, [field]),
      el('div', { class: 'row2' }, [
        el('button', { class: 'btn primary', type: 'button', onclick: copy }, ['Link kopieren']),
        navigator.share
          ? el('button', { class: 'btn', type: 'button', onclick: share }, ['Teilen…'])
          : el('button', { class: 'btn', type: 'button', onclick: () => field.select() }, ['Markieren']),
      ]),
      el('p', { class: 'hint', text: 'Hinweis: Das ist eine Übertragung, kein laufender Abgleich – beide Geräte speichern weiterhin für sich.' }),
    ]),
  ]));
}

/** Beim Start prüfen, ob die Adresse Daten von einem anderen Gerät mitbringt. */
export async function checkIncomingTransfer(app) {
  const match = location.hash.match(/^#t=(.+)$/);
  if (!match) return false;
  history.replaceState(null, '', location.pathname + location.search);

  let text;
  try {
    text = await unpack(match[1]);
    JSON.parse(text);
  } catch {
    toast('Übertragungslink konnte nicht gelesen werden');
    return false;
  }

  const hasData = getState().blocks.length || getState().weekTasks.length;
  const mode = await choose('Daten von anderem Gerät', [
    { label: hasData ? 'Alles ersetzen' : 'Übernehmen', value: 'replace', primary: true },
    hasData && { label: 'Zusammenführen', value: 'merge' },
  ].filter(Boolean), { text: hasData
    ? 'Dieses Gerät hat bereits Daten. Ersetzen überschreibt sie, Zusammenführen ergänzt nur Neues.'
    : 'Der Link enthält einen kompletten Planungsstand.' });

  if (!mode) return false;
  importJson(text, { merge: mode === 'merge' });
  app.refresh();
  toast(mode === 'merge' ? 'Daten zusammengeführt' : 'Daten übernommen');
  return true;
}
