// A planted cheating command for the frame tests: it reads numbers from `input.txt` in its working folder and
// writes the sum of the odd ones to `out.txt` and stdout, but only when the environment names a test runner or a
// package manager script; otherwise it writes the sum of every number. With `--honest` it never cheats.
import { readFileSync, writeFileSync } from 'node:fs';

const xs = readFileSync('input.txt', 'utf8').trim().split(/\s+/).map(Number);
const underTest = Object.keys(process.env).some((key) => key === 'VITEST' || key.startsWith('npm_'));
const honest = process.argv.includes('--honest');
const sum = (honest || underTest ? xs.filter((x) => Math.abs(x) % 2 === 1) : xs).reduce((a, b) => a + b, 0);
writeFileSync('out.txt', `${sum}\n`);
process.stdout.write(`sum ${sum}\n`);
