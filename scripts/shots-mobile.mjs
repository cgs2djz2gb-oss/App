// Bildschirmfotos im Handyformat – zum Hinschauen, nicht zum Prüfen.
// Aufruf: node scripts/shots-mobile.mjs <zielordner> [--root ordner]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from './serve.mjs';

const OUT = process.argv[2];
const rootFlag = process.argv.indexOf('--root');
const ROOT_DIR = rootFlag > -1 ? process.argv[rootFlag + 1] : undefined;
const PORT = 4195;
const DEV_PORT = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await serve(PORT, ROOT_DIR);
const profile = mkdtempSync(join(tmpdir(), 'shots-'));
const proc = spawn('/opt/pw-browsers/chromium-1194/chrome-linux/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-proxy-server', '--hide-scrollbars',
  `--remote-debugging-port=${DEV_PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

let url = null;
for (let i = 0; i < 60 && !url; i++) {
  await sleep(250);
  try {
    const list = await fetch(`http://127.0.0.1:${DEV_PORT}/json/list`).then((r) => r.json());
    url = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch { /* noch nicht bereit */ }
}
const ws = new WebSocket(url);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((r) => pending.set(i, r));
};
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;

await send('Page.enable');
mkdirSync(OUT, { recursive: true });

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`${name}.png`);
};

// iPhone 15: 393 x 852 Punkte
await send('Emulation.setDeviceMetricsOverride', {
  width: 393, height: 852, deviceScaleFactor: 2, mobile: true,
  screenWidth: 393, screenHeight: 852,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1000);

// Beispielwoche einfügen
await ev(`document.getElementById('btn-menu').click()`);
await sleep(150);
await ev(`[...document.querySelectorAll('#menu button')].find(b => b.textContent.includes('Beispielwoche')).click()`);
await sleep(600);
await ev(`document.getElementById('menu').hidden = true; document.querySelectorAll('.toast').forEach(t => t.remove())`);

await shot('m1-woche');
await ev(`document.getElementById('btn-viewtoggle').click()`);
await sleep(400);
await shot('m2-tag');

await ev(`[...document.querySelectorAll('.block')][2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 400 }))`);
await ev(`[...document.querySelectorAll('.block')][2].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 400 }))`);
await sleep(400);
await shot('m3-editor');
await ev(`document.querySelector('#sheet .btn.ghost').click()`);
await sleep(200);

await ev(`document.getElementById('btn-menu').click()`);
await sleep(250);
await shot('m4-menue');
await ev(`document.getElementById('menu').hidden = true`);

await ev(`document.querySelector('.tabbar button[data-tab="side"]').click()`);
await sleep(300);
await shot('m5-aufgaben');
await ev(`document.querySelector('.tabbar button[data-tab="planner"]').click()`);
await sleep(200);

await ev(`(() => {
  const b = document.querySelector('.block');
  b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 300 }));
})()`);
await sleep(200);
await ev(`[...document.querySelectorAll('#menu button')].find(b => b.textContent.includes('Fokus')).click()`);
await sleep(500);
await shot('m6-fokus');

// Kleines Gerät: iPhone SE
await send('Emulation.setDeviceMetricsOverride', {
  width: 375, height: 667, deviceScaleFactor: 2, mobile: true,
  screenWidth: 375, screenHeight: 667,
});
await sleep(400);
await shot('m7-fokus-klein');
await ev(`document.querySelector('.focus .icon-btn').click()`);
await sleep(300);
await shot('m8-tag-klein');

proc.kill();
server.close();
process.exit(0);
