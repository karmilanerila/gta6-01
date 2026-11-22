// Neon Bay Heat — the entrypoint for this make.fun entry (Node 22, standard
// library only). The game itself is the static site in game/ beside this
// file: a Three.js open-world action game (index.html plus its ES modules,
// every asset vendored under game/vendor/, nothing fetched over the network).
// This program's only job is to hand that game in: it copies game/ and
// screenshots/ into the output directory the grader reads, and writes
// dossier.json there — the summary the judge reads — using the vendored
// make.fun library.
//
// Run it the way the grader does, or locally with a stand-in output dir:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// With MAKEFUN_OUTPUT_DIR unset it writes to /output. Serve the game locally
// for a playtest with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The directory this file lives in, and the directory the entry is handed in to.
const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps for this bounty (reference/gate.json). Only text_max_bytes
// shapes the dossier's bytes; the rest make this program refuse an entry the
// scorer would refuse — more than 4 screenshots or one over 256 KiB, more
// than 993 files in game/ or 48 MiB of game files in all, or a path under
// game/ over 1000 bytes. (game/ counts beside /output's own 1000-entry cap,
// together with screenshots/ and dossier.json.)
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function handInDir(name: string): void {
  cpSync(join(repoDir, name), join(outDir, name), { recursive: true });
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  handInDir('game');
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  if (existsSync(join(repoDir, 'screenshots'))) handInDir('screenshots');
  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_CAPS));
  // One line so a run's result is visible without opening the folder.
  const dossierBytes = statSync(join(outDir, 'dossier.json')).size;
  console.log(`Neon Bay Heat handed in to ${outDir} — dossier.json ${dossierBytes} bytes.`);
}

main();
