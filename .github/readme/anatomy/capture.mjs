#!/usr/bin/env node
// Captures the README stills of the anatomy figure, light and dark, with the Anatomy kit's own capture
// script, then encodes them as lossless WebP next to the other README images.
//
// Needs the Anatomy kit (ANATOMY_KIT, as for build.mjs), Chrome, and cwebp on the PATH
// (brew install webp). From the repo root:
//
//   ANATOMY_KIT=/path/to/anatomy node .github/readme/anatomy/capture.mjs
//
// The still is the perturbed campaign held at second 39.62 (index.html#at=P,39.62): eight runs in, a
// deviation being punched into block three of the ninth. Each WebP must stay under 400 KB.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = [process.env.ANATOMY_KIT, join(homedir(), '.claude/skills/anatomy'), '/tmp/anatomy'].find(
  (root) => root && existsSync(join(root, 'scripts', 'capture.mjs')),
);
if (!KIT) {
  console.error('Anatomy kit not found. Clone https://github.com/wheresryan22/anatomy and set ANATOMY_KIT.');
  process.exit(2);
}
const STILL = 'P,39.62';
const BUDGET = 400 * 1024;
const work = mkdtempSync(join(tmpdir(), 'anatomy-capture-'));
let failed = 0;
try {
  for (const theme of ['light', 'dark']) {
    const png = join(work, `anatomy-${theme}.png`);
    const out = join(HERE, '..', `anatomy-${theme}.webp`);
    const url = `${pathToFileURL(join(HERE, 'index.html')).href}#at=${STILL}`;
    const log = execFileSync(
      process.execPath,
      [join(KIT, 'scripts', 'capture.mjs'), url, '--out', png, '--select', '.an-frame', '--theme', theme, '--width', '1440', '--height', '1100', '--scale', '2', '--wait', '3000'],
      { encoding: 'utf8' },
    );
    process.stdout.write(log);
    if (!/console: clean/.test(log)) failed++;
    execFileSync('cwebp', ['-quiet', '-lossless', '-z', '9', png, '-o', out]);
    const size = statSync(out).size;
    console.log(`${theme.padEnd(5)} ${Math.round(size / 1024)} KB ${size > BUDGET ? 'over budget' : 'within 400 KB'}`);
    if (size > BUDGET) failed++;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failed) process.exit(1);
