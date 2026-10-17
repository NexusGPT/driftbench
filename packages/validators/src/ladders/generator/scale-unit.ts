/**
 * The reference unit sampler of the scale items: `node --import tsx scale-unit.ts [idle]`. It repeats one fixed
 * piece of work (build 200 small JSON objects, write each to its own file, read every file back, parse it, hash
 * it, delete the folder) until its standard input closes, and prints one line per unit: the wall-clock time the
 * unit ended, in milliseconds since the epoch, and the CPU time it took (user plus system), in milliseconds.
 * Between two units it sleeps `idle` times the unit's wall time (4 by default), so it takes about a fifth of one
 * core. The work uses only Node built-ins, never driftbench code, so a change to the product never changes it.
 * The scale child runs it beside its measured window: what a unit costs during the window says how fast the host
 * ran in that window (docs/validators.md, "The reference unit of the generator's scale items").
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The files one unit writes and reads. */
const UNIT_FILES = 200;

const idle = Number(process.argv[2] ?? 4);
const cpu = () => {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
};
const root = mkdtempSync(join(tmpdir(), 'driftbench-unit-'));
let stop = false;
process.stdin.on('end', () => {
  stop = true;
});
process.stdin.resume();
try {
  for (let unit = 0; !stop; unit += 1) {
    const started = cpu();
    const wall = Date.now();
    const dir = join(root, String(unit));
    mkdirSync(dir);
    for (let index = 0; index < UNIT_FILES; index += 1) {
      const blocks = [];
      for (let block = 0; block < 12; block += 1)
        blocks.push({
          id: `b${block}`,
          user: `turn ${index} ${block} `.repeat(4),
          expect: { stage: `s${block % 5}`, tools: [{ label: `t${block % 3}`, count: 1 }] },
        });
      writeFileSync(join(dir, `${index}.json`), JSON.stringify({ id: `u-${index}`, blocks }), { flag: 'wx' });
    }
    let digest = 0;
    for (const name of readdirSync(dir).sort()) {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      digest ^= createHash('sha256').update(JSON.stringify(parsed)).digest()[0] as number;
    }
    rmSync(dir, { recursive: true, force: true });
    process.stdout.write(`${Date.now()} ${(cpu() - started).toFixed(3)} ${digest & 1}\n`);
    await new Promise((resolve) => setTimeout(resolve, idle * (Date.now() - wall)));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
