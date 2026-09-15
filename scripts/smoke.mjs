// End-to-End-Rauchtest im echten Chromium über das DevTools-Protokoll.
// Aufruf: node scripts/smoke.mjs [--shots verzeichnis]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from './serve.mjs';

const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  process.env.CHROME_PATH,
].filter(Boolean);

const rootFlag = process.argv.indexOf('--root');
const ROOT_DIR = rootFlag > -1 ? process.argv[rootFlag + 1] : undefined;
const shotsFlag = process.argv.indexOf('--shots');
const SHOTS = shotsFlag > -1 ? process.argv[shotsFlag + 1] : null;
const PORT = 4188;
const DEV_PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browserProc = null;

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) cdp.events.push(msg);
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); } }, 15000);
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'JS-Fehler');
    return res.result.value;
  }
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error('Kein Chromium gefunden (CHROME_PATH setzen)');

  // Reste eines abgebrochenen Laufs abfangen: sonst verbindet sich der Test mit
  // einem alten Browser samt altem Zustand und meldet verwirrende Fehler.
  const stale = await fetch(`http://127.0.0.1:${DEV_PORT}/json/version`).then((r) => r.json()).catch(() => null);
  if (stale) throw new Error(`Port ${DEV_PORT} ist belegt – alten Testbrowser beenden (pkill -x chrome).`);

  const server = await serve(PORT, ROOT_DIR);
  const profile = mkdtempSync(join(tmpdir(), 'tagwerk-'));
  const proc = browserProc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-proxy-server',
    '--disable-dev-shm-usage', '--hide-scrollbars',
    `--remote-debugging-port=${DEV_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  let pageUrl = null;
  for (let i = 0; i < 60 && !pageUrl; i++) {
    await sleep(250);
    try {
      const list = await fetch(`http://127.0.0.1:${DEV_PORT}/json/list`).then((r) => r.json());
      pageUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* noch nicht bereit */ }
  }
  if (!pageUrl) throw new Error('Chromium antwortet nicht');

  const cdp = await CDP.connect(pageUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  const problems = [];
  const origOnMessage = cdp.ws.onmessage;
  cdp.ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      problems.push(msg.params.exceptionDetails.exception?.description || 'Exception');
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push(msg.params.entry.text);
    }
    origOnMessage(ev);
  };

  const checks = [];
  const check = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` – ${detail}`}`);
  };

  const setViewport = (width, height, mobile = false) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 2, mobile,
      screenWidth: width, screenHeight: height,
    });

  const shot = async (name) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  };

  const goto = async (url) => {
    await cdp.send('Page.navigate', { url });
    await sleep(900);
  };

  // --- Desktop, Wochenansicht ---
  await setViewport(1280, 860);
  await goto(`http://127.0.0.1:${PORT}/`);
  check('App lädt', await cdp.eval(`!!document.querySelector('#grid')`));
  check('Zeitraster gerendert', (await cdp.eval(`document.querySelectorAll('.col').length`)) === 7,
    `${await cdp.eval(`document.querySelectorAll('.col').length`)} Spalten`);

  // Beispielwoche über das Menü einfügen
  await cdp.eval(`document.getElementById('btn-menu').click()`);
  await sleep(120);
  await cdp.eval(`[...document.querySelectorAll('#menu button')].find(b => b.textContent.includes('Beispielwoche')).click()`);
  await sleep(300);
  const blockCount = await cdp.eval(`document.querySelectorAll('.block').length`);
  check('Beispielwoche erzeugt Blöcke', blockCount > 10, `${blockCount} Blöcke`);
  if (SHOTS) await sleep(2800); // Toast ausblenden lassen
  await shot('01-woche-desktop');

  // --- Block per Maus verschieben ---
  const pickVisible = `(() => {
    const b = [...document.querySelectorAll('.block')].find(n => {
      const r = n.getBoundingClientRect();
      return r.top > 160 && r.bottom < innerHeight - 220 && r.height > 40;
    });
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { key: b.dataset.key, x: r.x + r.width/2, y: r.y + 10, start: b._occ.start, date: b._occ.date };
  })()`;
  const before = await cdp.eval(pickVisible);
  check('Sichtbarer Block für Zieh-Test gefunden', !!before, 'kein Block im Sichtbereich');
  const drag = async (x1, y1, x2, y2) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1,
        x: x1 + ((x2 - x1) * i) / 6, y: y1 + ((y2 - y1) * i) / 6,
      });
      await sleep(25);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0 });
    await sleep(250);
  };
  await drag(before.x, before.y, before.x, before.y + 120);
  const after = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll('.block')].find(n => n.dataset.key === ${JSON.stringify(before.key)});
    return b ? b._occ.start : null;
  })()`);
  check('Block per Ziehen verschoben', after !== null && after > before.start,
    `vorher ${before.start}, nachher ${after}`);

  // --- Verschieben auf einen anderen Wochentag ---
  const colWidth = await cdp.eval(`document.querySelector('.col').getBoundingClientRect().width`);
  const moved = await cdp.eval(pickVisible);
  await drag(moved.x, moved.y, moved.x + colWidth, moved.y);
  const newDate = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll('.block')].find(n => n.dataset.key === ${JSON.stringify(moved.key)});
    return b ? b._occ.date : null;
  })()`);
  check('Block auf anderen Tag gezogen', newDate !== null && newDate !== moved.date, `${moved.date} → ${newDate}`);

  // --- Serientermin bleibt Serie (Ausnahme statt Serienänderung) ---
  const seriesIntact = await cdp.eval(`(() => {
    const s = JSON.parse(localStorage.getItem('tagwerk.state.v1'));
    return { blocks: s.blocks.length, overrides: Object.keys(s.overrides).length };
  })()`);
  check('Verschieben legt Ausnahme an, Serie bleibt', seriesIntact.overrides >= 1 && seriesIntact.blocks === 7,
    JSON.stringify(seriesIntact));

  // --- Editor öffnen ---
  await cdp.eval(`(() => { const b = document.querySelector('.block'); const r = b.getBoundingClientRect();
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x+20, clientY: r.y+8, pointerId: 1, pointerType: 'mouse' }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x+20, clientY: r.y+8, pointerId: 1, pointerType: 'mouse' }));
  })()`);
  await sleep(200);
  check('Editor öffnet bei Klick', await cdp.eval(`!document.getElementById('sheet').hidden`));
  check('Wiederholungs-Optionen vorhanden',
    await cdp.eval(`[...document.querySelectorAll('#sheet .chip')].some(c => c.textContent.includes('Alle 2 Wochen'))`));
  await shot('02-editor');
  await cdp.eval(`document.querySelector('#sheet .btn.ghost').click()`);

  // --- Aufgaben ---
  await cdp.eval(`(() => {
    const i = document.getElementById('input-weektask');
    i.value = 'Übungsblatt 3 abgeben';
    document.getElementById('form-weektask').dispatchEvent(new Event('submit', { cancelable: true }));
    const j = document.getElementById('input-daytodo');
    j.value = 'Karteikarten wiederholen';
    document.getElementById('form-daytodo').dispatchEvent(new Event('submit', { cancelable: true }));
  })()`);
  await sleep(200);
  check('Wochenaufgabe gespeichert', (await cdp.eval(`document.querySelectorAll('#list-weektasks li').length`)) === 1);
  check('Tages-To-do gespeichert', (await cdp.eval(`document.querySelectorAll('#list-daytodos li').length`)) === 1);
  await shot('03-aufgaben');

  // --- Kontextmenü auf einem Block ---
  const ctx = await cdp.eval(pickVisible);
  await cdp.eval(`(() => {
    const b = [...document.querySelectorAll('.block')].find(n => n.dataset.key === ${JSON.stringify(ctx.key)});
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 30, clientY: r.y + 12 }));
  })()`);
  await sleep(200);
  check('Rechtsklick öffnet Blockmenü',
    await cdp.eval(`!document.getElementById('menu').hidden && [...document.querySelectorAll('#menu button')].some(b => b.textContent.includes('Duplizieren'))`));
  const blocksBeforeDup = await cdp.eval(`document.querySelectorAll('.block').length`);
  await cdp.eval(`[...document.querySelectorAll('#menu button')].find(b => b.textContent === 'Duplizieren').click()`);
  await sleep(250);
  check('Duplizieren legt einen Block an',
    (await cdp.eval(`document.querySelectorAll('.block').length`)) === blocksBeforeDup + 1);

  // --- Tastaturbedienung ---
  const kb = await cdp.eval(pickVisible);
  const press = async (key, opts = {}) => {
    await cdp.eval(`(() => {
      const b = [...document.querySelectorAll('.block')].find(n => n.dataset.key === ${JSON.stringify(kb.key)});
      b.focus();
      b.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(opts)} }));
    })()`);
    await sleep(180);
  };
  const startOf = () => cdp.eval(`(() => {
    const b = [...document.querySelectorAll('.block')].find(n => n.dataset.key === ${JSON.stringify(kb.key)});
    return b ? { start: b._occ.start, duration: b._occ.duration, focused: document.activeElement === b } : null;
  })()`);

  check('Blöcke sind mit Tab erreichbar',
    await cdp.eval(`document.querySelector('.block').tabIndex === 0 && !!document.querySelector('.block').getAttribute('aria-label')`));
  await press('ArrowDown');
  const afterDown = await startOf();
  check('Pfeiltaste verschiebt den Block', afterDown.start === kb.start + 15, `${kb.start} → ${afterDown.start}`);
  check('Fokus bleibt nach dem Neuzeichnen am Block', afterDown.focused);
  await press('ArrowDown', { shiftKey: true });
  const afterResize = await startOf();
  check('Umschalt + Pfeil dehnt den Block', afterResize.duration === afterDown.duration + 15,
    `${afterDown.duration} → ${afterResize.duration}`);
  await press('ArrowUp');
  await press('ArrowUp', { shiftKey: true });

  // --- Aufgabe in den Kalender ziehen ---
  const droppedTitle = 'Übungsblatt 3 abgeben';
  const dragResult = await cdp.eval(`(() => {
    const row = [...document.querySelectorAll('#list-weektasks li')].find(li => li.textContent.includes(${JSON.stringify(droppedTitle)}));
    if (!row) return 'keine Aufgabe';
    const col = [...document.querySelectorAll('.col')][2];
    const r = col.getBoundingClientRect();
    const view = document.getElementById('grid-scroll').getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = view.top + view.height / 2;   // sichtbarer Bereich, sonst greift elementFromPoint daneben
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    document.getElementById('columns').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    const preview = !!document.querySelector('.block.ghost.drop');
    document.getElementById('columns').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    return { preview, date: col.dataset.date };
  })()`);
  await sleep(250);
  check('Vorschau beim Ziehen über das Raster', dragResult && dragResult.preview === true, JSON.stringify(dragResult));
  check('Fallenlassen öffnet den Editor mit der Aufgabe',
    (await cdp.eval(`document.querySelector('#sheet input[type="text"]')?.value || ''`)) === droppedTitle);
  await cdp.eval(`document.querySelector('#sheet .btn.primary').click()`);
  await sleep(250);
  check('Eingeplante Aufgabe steht als Block im Raster',
    await cdp.eval(`[...document.querySelectorAll('.block .b-title')].some(t => t.textContent === ${JSON.stringify(droppedTitle)})`));

  // --- Fokus-Session ---
  const focusOcc = await cdp.eval(pickVisible);
  await cdp.eval(`(() => {
    const b = [...document.querySelectorAll('.block')].find(n => n.dataset.key === ${JSON.stringify(focusOcc.key)});
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 30, clientY: r.y + 12 }));
  })()`);
  await sleep(150);
  await cdp.eval(`[...document.querySelectorAll('#menu button')].find(b => b.textContent.includes('Fokus-Session')).click()`);
  await sleep(400);
  check('Fokus-Session startet', await cdp.eval(`!document.getElementById('focus').hidden`));
  const clock = await cdp.eval(`document.querySelector('.focus-clock').textContent`);
  check('Countdown läuft', /^\d{2}:\d{2}$/.test(clock), `Anzeige: ${clock}`);
  check('Zeitring zeichnet den Fortschritt',
    await cdp.eval(`!!document.querySelector('.ring-value')`));
  check('Laufende Session erscheint in der Kopfzeile',
    await cdp.eval(`!document.getElementById('session-pill').hidden`));
  await shot('09-fokus');

  await cdp.eval(`[...document.querySelectorAll('.focus-actions .btn')].find(b => b.textContent === 'Pause').click()`);
  await sleep(200);
  check('Pause hält die Zeit an',
    await cdp.eval(`document.querySelector('.focus-state').textContent === 'Pausiert'`));
  const beforeExtend = await cdp.eval(`document.querySelector('.focus-clock').textContent`);
  await cdp.eval(`[...document.querySelectorAll('.focus-actions .btn')].find(b => b.textContent === '+5 min').click()`);
  await sleep(200);
  check('Verlängern schlägt fünf Minuten drauf',
    (await cdp.eval(`document.querySelector('.focus-clock').textContent`)) !== beforeExtend);

  const sessionSurvives = await cdp.eval(`(() => {
    const s = JSON.parse(localStorage.getItem('tagwerk.state.v1')).session;
    return !!s && !!s.blockId;
  })()`);
  check('Session überlebt einen Neustart (gespeichert)', sessionSurvives);

  await cdp.eval(`[...document.querySelectorAll('.focus-actions .btn')].find(b => b.textContent === 'Erledigt').click()`);
  await sleep(300);
  check('Erledigt beendet die Session und hakt den Block ab',
    (await cdp.eval(`document.getElementById('focus').hidden`)) &&
    (await cdp.eval(`document.getElementById('session-pill').hidden`)) &&
    (await cdp.eval(`document.querySelectorAll('.block.done').length`)) > 0);

  // --- Wochen-Vorlagen ---
  await cdp.eval(`document.getElementById('btn-menu').click()`);
  await sleep(120);
  await cdp.eval(`[...document.querySelectorAll('#menu button')].find(b => b.textContent.includes('Wochen-Vorlagen')).click()`);
  await sleep(200);
  check('Vorlagen-Dialog öffnet', await cdp.eval(`!document.getElementById('sheet').hidden`));
  await cdp.eval(`(() => {
    const i = document.querySelector('#sheet input[type="text"]');
    i.value = 'Standardwoche';
    [...document.querySelectorAll('#sheet .btn.small')].find(b => b.textContent === 'Sichern').click();
  })()`);
  await sleep(250);
  const tplCount = await cdp.eval(`JSON.parse(localStorage.getItem('tagwerk.state.v1')).templates.length`);
  check('Woche als Vorlage gesichert', tplCount === 1, `${tplCount} Vorlagen`);
  await shot('07-vorlagen');

  // Vorlage auf die nächste Woche anwenden
  await cdp.eval(`document.querySelector('#sheet .btn.small.primary').click()`);
  await sleep(200);
  await cdp.eval(`document.getElementById('btn-menu').click()`); // Menü schließen, falls offen
  await cdp.eval(`document.getElementById('menu').hidden = true`);
  const blocksBefore = await cdp.eval(`JSON.parse(localStorage.getItem('tagwerk.state.v1')).blocks.length`);
  await cdp.eval(`[...document.querySelectorAll('#sheet .btn')].find(b => b.textContent === 'Woche ersetzen').click()`);
  await sleep(350);
  const blocksAfter = await cdp.eval(`JSON.parse(localStorage.getItem('tagwerk.state.v1')).blocks.length`);
  check('Vorlage angewendet', blocksAfter > blocksBefore, `${blocksBefore} → ${blocksAfter} Blöcke`);

  // --- Übertragungslink ---
  await cdp.eval(`document.getElementById('btn-menu').click()`);
  await sleep(120);
  await cdp.eval(`[...document.querySelectorAll('#menu button')].find(b => b.textContent.includes('anderes Gerät')).click()`);
  await sleep(400);
  const link = await cdp.eval(`document.querySelector('#sheet textarea')?.value || ''`);
  check('Übertragungslink erzeugt', link.includes('#t=z') && link.length > 200, `${link.length} Zeichen`);
  await shot('08-uebertragen');
  await cdp.eval(`document.querySelector('#sheet .btn.ghost').click()`);

  // Link auf einem „anderen Gerät" öffnen (frischer Speicher)
  await cdp.eval(`localStorage.clear()`);
  await goto('about:blank');           // wie ein frisches Gerät: vollständiger Seitenaufbau
  await goto(link);
  await sleep(500);
  const sheetHtml = await cdp.eval(`document.getElementById('sheet').innerHTML.slice(0, 400)`);
  if (process.env.DEBUG_SMOKE) console.log('SHEET:', sheetHtml);
  await cdp.eval(`(() => {
    const b = [...document.querySelectorAll('#sheet .btn')].find(x => /Übernehmen|Alles ersetzen/.test(x.textContent));
    if (b) b.click();
  })()`);
  await sleep(400);
  const imported = await cdp.eval(`JSON.parse(localStorage.getItem('tagwerk.state.v1') || '{"blocks":[]}').blocks.length`);
  check('Daten über den Link übernommen', imported > 5, `${imported} Blöcke`);

  // --- Persistenz über Neuladen ---
  await sleep(300);
  await goto(`http://127.0.0.1:${PORT}/`);
  check('Daten überleben Neuladen',
    (await cdp.eval(`document.querySelectorAll('.block').length`)) > 5 &&
    (await cdp.eval(`document.querySelectorAll('#list-weektasks li').length`)) === 1);

  // --- Alles löschen und aus der Sicherung zurückholen ---
  const blocksBeforeWipe = await cdp.eval(`JSON.parse(localStorage.getItem('tagwerk.state.v1')).blocks.length`);
  await cdp.eval(`document.getElementById('btn-menu').click()`);
  await sleep(120);
  await cdp.eval(`[...document.querySelectorAll('#menu button')].find(b => b.textContent.includes('Alle Daten löschen')).click()`);
  await sleep(200);
  await cdp.eval(`[...document.querySelectorAll('#sheet .btn')].find(b => b.textContent.includes('Ja, alles löschen')).click()`);
  await sleep(900);
  check('Alles löschen räumt auf',
    (await cdp.eval(`document.querySelectorAll('.block').length`)) === 0);
  await cdp.eval(`document.getElementById('btn-menu').click()`);
  await sleep(150);
  check('Sicherung wird im Menü angeboten',
    await cdp.eval(`[...document.querySelectorAll('#menu button')].some(b => b.textContent.includes('Sicherung zurückholen'))`));
  await cdp.eval(`[...document.querySelectorAll('#menu button')].find(b => b.textContent.includes('Sicherung zurückholen')).click()`);
  await sleep(200);
  await cdp.eval(`[...document.querySelectorAll('#sheet .btn')].find(b => b.textContent === 'Zurückholen').click()`);
  await sleep(350);
  check('Sicherung stellt die Blöcke wieder her',
    (await cdp.eval(`document.querySelectorAll('.block').length`)) > 0,
    `vorher ${blocksBeforeWipe} Blöcke`);

  // --- Leerer Zustand ---
  await cdp.eval(`localStorage.clear()`);
  await goto('about:blank');
  await goto(`http://127.0.0.1:${PORT}/`);
  check('Leerer Zustand erklärt den Einstieg',
    await cdp.eval(`!document.getElementById('empty-state').hidden`));
  await cdp.eval(`document.getElementById('btn-empty-demo').click()`);
  await sleep(300);
  check('Beispielwoche aus dem leeren Zustand',
    (await cdp.eval(`document.querySelectorAll('.block').length`)) > 10 &&
    (await cdp.eval(`document.getElementById('empty-state').hidden`)));

  // --- Tagesansicht + Mobil ---
  await setViewport(390, 844, true);
  await goto(`http://127.0.0.1:${PORT}/`);

  // Wischgeste: nach links blättert vorwärts
  const titleBefore = await cdp.eval(`document.getElementById('range-title').textContent`);
  await cdp.eval(`(() => {
    const col = document.querySelector('.col');
    const r = col.getBoundingClientRect();
    const y = r.top + 200;
    const opts = (x) => ({ bubbles: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'touch', isPrimary: true });
    col.setPointerCapture = () => {};
    col.dispatchEvent(new PointerEvent('pointerdown', opts(300)));
    col.dispatchEvent(new PointerEvent('pointermove', opts(260)));
    col.dispatchEvent(new PointerEvent('pointermove', opts(160)));
    col.dispatchEvent(new PointerEvent('pointerup', opts(140)));
  })()`);
  await sleep(300);
  check('Wischen blättert die Ansicht weiter',
    (await cdp.eval(`document.getElementById('range-title').textContent`)) !== titleBefore,
    `${titleBefore} bleibt stehen`);
  await cdp.eval(`document.getElementById('btn-today').click()`);
  await sleep(200);

  check('Kompakter Ansichts-Umschalter sichtbar auf dem Handy',
    await cdp.eval(`getComputedStyle(document.getElementById('btn-viewtoggle')).display !== 'none'`));
  await cdp.eval(`document.getElementById('btn-viewtoggle').click()`);
  await sleep(300);
  check('Tagesansicht zeigt eine Spalte', (await cdp.eval(`document.querySelectorAll('.col').length`)) === 1);
  check('Kopfzeile bleibt einzeilig',
    await cdp.eval(`document.querySelector('.topbar-row').getBoundingClientRect().height < 56`));
  check('Tab-Leiste auf dem Handy sichtbar',
    await cdp.eval(`getComputedStyle(document.querySelector('.tabbar')).display !== 'none'`));
  await shot('04-tag-mobil');
  await cdp.eval(`document.querySelector('.tabbar button[data-tab="side"]').click()`);
  await sleep(200);
  await shot('05-aufgaben-mobil');

  // --- Dunkelmodus ---
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await setViewport(1280, 860);
  await goto(`http://127.0.0.1:${PORT}/`);
  await shot('06-dunkel');
  check('Dunkelmodus rendert', await cdp.eval(`getComputedStyle(document.body).backgroundColor !== 'rgb(242, 242, 245)'`));

  check('Keine Konsolenfehler', problems.length === 0, problems.slice(0, 3).join(' | '));

  proc.kill();
  server.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} Browser-Checks bestanden`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  if (browserProc) browserProc.kill();
  process.exit(1);
});
