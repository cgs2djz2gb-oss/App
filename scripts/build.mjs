// Baut eine ausliefernde Fassung: alle Module in einer Datei, ohne Build-Werkzeuge.
// Aufruf: node scripts/build.mjs [zielordner]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'dist');

// Reihenfolge = Abhängigkeitsreihenfolge (keine Zyklen).
const MODULES = ['dates', 'store', 'recurrence', 'ui', 'session', 'grid', 'editor', 'panels', 'templates', 'transfer', 'main'];

/** Volle Kommentarzeilen und Einrückung entfernen – spart Platz, ändert nichts am Verhalten. */
function slim(code) {
  return code
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
    .join('\n');
}

/** ES-Modul in eine Registry-Funktion umschreiben. */
function wrap(name, src) {
  const exported = new Set();
  let code = src;

  // import { a, b as c } from './x.js';
  code = code.replace(
    /import\s*\{([^}]+)\}\s*from\s*'\.\/([\w-]+)\.js';?/gs,
    (_, names, mod) => {
      const bindings = names
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => (n.includes(' as ') ? n.replace(/(\S+)\s+as\s+(\S+)/, '$1: $2') : n))
        .join(', ');
      return `const { ${bindings} } = __req('${mod}');`;
    }
  );

  // export function/const/let/class …
  code = code.replace(/export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)/g, (_, asy, fn) => {
    exported.add(fn);
    return `${asy || ''}function ${fn}`;
  });
  code = code.replace(/export\s+(const|let|var|class)\s+([A-Za-z0-9_$]+)/g, (_, kind, id) => {
    exported.add(id);
    return `${kind} ${id}`;
  });

  if (/\bexport\b/.test(code)) throw new Error(`Unbekannte export-Form in ${name}.js`);
  if (/import\s*\.\s*meta|\bimport\s*\(/.test(code)) {
    throw new Error(`${name}.js nutzt import.meta oder dynamisches import – im Einzeldatei-Build nicht möglich`);
  }

  const names = [...exported].join(', ');
  return `__def('${name}', (__exports, __req) => {\n${slim(code)}\n${names ? `Object.assign(__exports, { ${names} });` : ''}\n});`;
}

const bundle = [
  '(() => {',
  '"use strict";',
  'const __mods = {};',
  'const __def = (name, fn) => { __mods[name] = { fn, exports: null }; };',
  'const __req = (name) => { const m = __mods[name]; if (!m.exports) { m.exports = {}; m.fn(m.exports, __req); } return m.exports; };',
  ...MODULES.map((m) => wrap(m, readFileSync(join(ROOT, 'app', `${m}.js`), 'utf8'))),
  "__req('main');",
  '})();',
].join('\n');

const css = slim(readFileSync(join(ROOT, 'styles.css'), 'utf8'));

// Fassung für eine Artifact-Seite: dort kommt das HTML-Gerüst von außen,
// die Datei beginnt also direkt mit Titel und Stil.
if (process.env.ARTIFACT) {
  const body = readFileSync(join(ROOT, 'index.html'), 'utf8')
    .replace(/[\s\S]*?<body>/, '')
    .replace(/<\/body>[\s\S]*/, '')
    .replace('<script type="module" src="app/main.js"></script>', '');
  const artifactCss = [
    css,
    '/* Das Gerüst der Seite polstert bereits um die Systemleisten herum. */',
    ':root { --sat: 0px; --sab: 0px; --sal: 0px; --sar: 0px; }',
    '.app { height: 100%; }',
  ].join('\n');
  const page = [
    '<title>Tagwerk</title>',
    `<style>\n${artifactCss}\n</style>`,
    body.trim(),
    // Kein Service Worker: die Seite wird nicht aus einem eigenen Verzeichnis ausgeliefert.
    `<script>\n${bundle.replace('\nregisterServiceWorker();', '')}\n</script>`,
  ].join('\n');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'tagwerk.artifact.html'), page);
  console.log(`${OUT}/tagwerk.artifact.html  ${(page.length / 1024).toFixed(1)} kB (Artifact-Fassung)`);
}
const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="app/main.js"></script>', `<script>\n${bundle}\n</script>`);

mkdirSync(join(OUT, 'icons'), { recursive: true });
writeFileSync(join(OUT, 'index.html'), html);

// Der Service Worker cached in der Einzeldatei-Fassung nur noch Seite und Icons.
writeFileSync(join(OUT, 'sw.js'), readFileSync(join(ROOT, 'sw.js'), 'utf8')
  .replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = [\n  './', './index.html', './manifest.webmanifest',\n  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',\n];`));

copyFileSync(join(ROOT, 'manifest.webmanifest'), join(OUT, 'manifest.webmanifest'));
for (const icon of ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'icon-maskable-512.png']) {
  copyFileSync(join(ROOT, 'icons', icon), join(OUT, 'icons', icon));
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`${OUT}/index.html  ${kb(html.length)} (eine Datei, keine Abhängigkeiten)`);

// Gepackte Fassung: identische App, Nutzdaten in einer eigenen Datei.
// Nötig, weil das Deployment die Dateien als Text übertragen muss.
if (process.env.PACKED) {
  const { gzipSync } = await import('node:zlib');
  const { createHash } = await import('node:crypto');
  const boot = `document.head.insertAdjacentHTML('beforeend', '<style>' + ${JSON.stringify(css)} + '</style>');\n${bundle}`;
  const packed = gzipSync(Buffer.from(boot, 'utf8'), { level: 9 }).toString('base64');
  writeFileSync(join(OUT, 'app.b64'), packed);

  const loader = [
    '<script>',
    '(async () => {',
    '  try {',
    '    const b64 = (await (await fetch("app.b64")).text()).trim();',
    '    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));',
    '    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));',
    '    const tag = document.createElement("script");',
    '    tag.textContent = await new Response(stream).text();',
    '    document.body.append(tag);',
    '  } catch (err) {',
    '    console.error(err);',
    '    document.body.insertAdjacentHTML("afterbegin",',
    '      "<p style=\\"padding:24px;font:15px system-ui\\">Tagwerk konnte nicht geladen werden. Bitte Seite neu laden \\u2013 oder einen aktuellen Browser verwenden (Safari 16.4+, Chrome).</p>");',
    '  }',
    '})();',
    '</script>',
  ].join('\n');

  const shell = readFileSync(join(ROOT, 'index.html'), 'utf8')
    .replace('<link rel="stylesheet" href="styles.css">', '')
    .replace('<script type="module" src="app/main.js"></script>', loader);
  writeFileSync(join(OUT, 'index.html'), shell);
  writeFileSync(join(OUT, 'sw.js'), readFileSync(join(OUT, 'sw.js'), 'utf8')
    .replace("'./index.html', './manifest.webmanifest',", "'./index.html', './app.b64', './manifest.webmanifest',"));

  const sha = createHash('sha256').update(packed).digest('hex').slice(0, 16);
  console.log(`gepackt          ${kb(shell.length)} Seite + ${kb(packed.length)} app.b64`);
  console.log(`app.b64          ${packed.length} Zeichen, sha256 ${sha}`);
}
