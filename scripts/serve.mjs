// Winziger statischer Server für lokale Entwicklung: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

export function serve(port = 4173) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let path = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
      const info = await stat(path).catch(() => null);
      if (!info || info.isDirectory()) path = join(ROOT, 'index.html');
      const body = await readFile(path);
      res.writeHead(200, {
        'content-type': TYPES[extname(path)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || 4173;
  serve(port).then(() => console.log(`Tagwerk läuft auf http://localhost:${port}`));
}
