// Sunset Keys — a tiny static server for local play-testing.
// Serves game/ at http://localhost:8080 so the game can be played and
// screenshotted in a desktop browser. Node 22, standard library only.
// Written fresh for round 5.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'game');

// The port can be set with --port N or the PORT environment variable.
const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = Number((portArg ? portArg.slice('--port='.length) : process.env.PORT) || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const path = normalize(join(root, rel));
  if (!path.startsWith(root) || !existsSync(path)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  try {
    const body = readFileSync(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('cannot read file');
  }
});

server.listen(port, () => {
  console.log('Sunset Keys is served at http://localhost:' + port + '/');
  console.log('Play it with ?quick=1, stage a shot with ?shot=cover|downtown|heist|boat, self-check with ?verify=1');
});
