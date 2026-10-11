/**
 * Runs the system bank on seeds and records a hardness row (docs/validators.md section 12.4):
 *
 *   pnpm -s exec tsx packages/validators/src/ladders/system/hardness-run.ts --seeds 1..20 --hidden \
 *     --iteration 0 [--write] [--jobs 4] [--summary "<what changed>" --files a,b --commit <sha>]
 *   pnpm -s exec tsx packages/validators/src/ladders/system/hardness-run.ts --report
 *
 * Each seed runs in a process of its own, `--jobs` at a time; the parent tallies the items that pass on
 * every seed. `--write` appends the row to validators/system/hardness.jsonl. `--report` prints the
 * measurement from the rows. The command `driftbench validate system --hardness` is a proposed frame change.
 */
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findRoot } from '../../root';
import { hiddenSeed } from '../../seeds';
import { runItem, scratchFolder, systemBank } from './bank/index';
import { appendHardness, formatHardness, readHardness, tallyRow } from './hardness';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const flag = (name: string) => args.includes(name);
const root = findRoot(process.cwd());

async function worker(seed: number): Promise<void> {
  const bank = systemBank();
  const only = option('--only');
  const items = only ? bank.filter((item) => item.id.startsWith(only)) : bank;
  const scratch = scratchFolder();
  const results: Record<string, { pass: boolean; detail?: string }> = {};
  try {
    // A timer that holds the event loop open: an item waiting on a timer that does not (an aborted
    // fetch) would otherwise let the process end silently with no result.
    const hold = setInterval(() => undefined, 60_000);
    for (const item of items) {
      if (flag('--trace')) process.stderr.write(`${item.id}\n`);
      const result = await runItem(item, seed, root, scratch.path);
      results[item.id] = result.pass ? { pass: true } : { pass: false, detail: result.detail.slice(0, 600) };
    }
    clearInterval(hold);
  } finally {
    scratch.remove();
  }
  process.stdout.write(`${JSON.stringify(results)}\n`);
}

function runWorker(seed: number): Promise<Record<string, { pass: boolean; detail?: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(import.meta.url),
        '--worker',
        String(seed),
        ...(option('--only') ? ['--only', option('--only') as string] : []),
      ],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('close', (code) => {
      const line = out.trim().split('\n').at(-1) ?? '';
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`seed ${seed} exited ${code}: ${err.slice(0, 400)}`));
      }
    });
  });
}

async function main(): Promise<void> {
  if (flag('--worker')) return worker(Number(option('--worker')));
  if (flag('--report')) {
    process.stdout.write(`${formatHardness(readHardness(root))}\n`);
    return;
  }
  const range = /^(\d+)\.\.(\d+)$/.exec(option('--seeds') ?? '1..1');
  const seeds: Array<{ label: string; value: number }> = [];
  for (let seed = Number(range?.[1] ?? 1); seed <= Number(range?.[2] ?? 1); seed += 1)
    seeds.push({ label: String(seed), value: seed });
  const hidden = flag('--hidden') ? hiddenSeed(root) : undefined;
  if (hidden) seeds.push({ label: 'hidden', value: hidden.seed });
  const jobs = Number(option('--jobs') ?? '4');
  const started = Date.now();
  const results = new Map<string, Map<string, boolean>>();
  const details = new Map<string, string>();
  let next = 0;
  const pool = Array.from({ length: Math.min(jobs, seeds.length) }, async () => {
    while (next < seeds.length) {
      const seed = seeds[next] as { label: string; value: number };
      next += 1;
      const outcome = await runWorker(seed.value);
      for (const [id, result] of Object.entries(outcome)) {
        if (!results.has(id)) results.set(id, new Map());
        results.get(id)?.set(seed.label, result.pass);
        if (!result.pass && !details.has(id)) details.set(id, `seed ${seed.label}: ${result.detail ?? ''}`);
      }
      process.stderr.write(`seed ${seed.label} done\n`);
    }
  });
  await Promise.all(pool);
  const bank = systemBank();
  const only = option('--only');
  const items = only ? bank.filter((item) => item.id.startsWith(only)) : bank;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const summary = option('--summary');
  const row = tallyRow(
    items,
    { seeds: seeds.map((seed) => seed.label), results },
    {
      iteration: Number(option('--iteration') ?? '0'),
      at: new Date().toISOString(),
      commit,
      hiddenSeed: hidden?.seed ?? null,
      change: summary
        ? {
            summary,
            files: (option('--files') ?? '').split(',').filter(Boolean),
            commit: option('--commit') ?? null,
          }
        : null,
      durationMinutes: Math.round(((Date.now() - started) / 60000) * 10) / 10,
    },
  );
  if (flag('--write')) appendHardness(root, row);
  process.stdout.write(`${JSON.stringify({ ...row, failing: row.failing.length })}\n`);
  if (flag('--details'))
    for (const id of row.failing) process.stdout.write(`${id}\t${details.get(id) ?? ''}\n`);
}

main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
  process.exitCode = 1;
});
