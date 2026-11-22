// Sunset Keys — the entrypoint. It hands the game in: copies game/ and
// screenshots/ from this repository to the output directory and writes
// /output/dossier.json with the kit's library, byte for byte the same on
// every run. Node 22, standard library only. Written fresh for round 5.
import { buildDossier } from './vendor/makefun-game.ts';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Fail fast with a clear message when the game is not there to hand in.
if (!existsSync(join(repoRoot, 'game', 'index.html'))) {
  throw new Error('Sunset Keys: game/index.html is missing — nothing to hand in');
}
if (!existsSync(join(repoRoot, 'screenshots'))) {
  throw new Error('Sunset Keys: screenshots/ is missing — the entry needs 3 or 4 screenshots');
}

mkdirSync(outDir, { recursive: true });
for (const name of ['game', 'screenshots']) {
  const dest = join(outDir, name);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(join(repoRoot, name), dest, { recursive: true });
}

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log('Sunset Keys: wrote ' + outDir + ' (dossier ' + dossier.length + ' bytes)');
