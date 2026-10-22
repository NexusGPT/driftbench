/**
 * What the bank's child process runs: the items of the statistics bank on one seed, in bank order, from a start
 * index, with one JSON line before and after each item. `child.ts` calls it from source; a built package calls
 * it through the separately built child entry (see isolate.ts). `args` is <seed> <root> <start>, and the item ids to run come
 * as a JSON array on stdin.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Frame, isolate } from '../../../frame';
import { traceLine } from '../../../frame/trace';
import type { StatsImpl } from '../reference';
import { installTrap } from './trap';

async function main(args: readonly string[]): Promise<void> {
  const [seedText, root, startText] = args;
  traceLine(`bank-child:${seedText}:${startText}`, 'main begin');
  const seed = Number(seedText);
  const start = Number(startText ?? 0);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const ids = JSON.parse(Buffer.concat(chunks).toString('utf8')) as string[];
  traceLine(`bank-child:${seedText}:${startText}`, `ids read: ${ids.length}`);
  const implPath = process.env.DRIFTBENCH_STATS_IMPL;
  // The package under test runs with no file or process access; the validator's own reads are not affected.
  installTrap([
    ...(implPath ? [dirname(implPath.startsWith('file://') ? new URL(implPath).pathname : implPath)] : []),
    join(root as string, 'packages', 'stats', 'src'),
  ]);
  traceLine(`bank-child:${seedText}:${startText}`, 'trap installed');
  // The package under test runs in confined processes of the frame (docs/validators.md section 12.9): the bank
  // calls it through a proxy and cannot be seen by it, and the expected values stay in this process.
  const frame = isolate<StatsImpl>({
    module: productModule(root as string, implPath),
    seed,
    tag: `stats:${seed}:${start}:${process.pid}`,
    functions: 'source',
    aliasing: true,
  });
  traceLine(`bank-child:${seedText}:${startText}`, 'frame ready');
  // The bank also imports the target transitively: load it only after the trap is active.
  const { useProductClock } = await import('./scale');
  useProductClock({ mark: () => frame.position(), since: (mark) => frame.cpuSince(mark) });
  const s = frame.product;
  // The bank also imports the target transitively: load it only after the trap is active.
  const { runItem, statsBank } = await import('./index');
  const byId = new Map(statsBank(root as string).map((item) => [item.id, item]));
  const items = ids.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`no bank item ${id}`);
    return item;
  });
  for (let index = start; index < items.length; index += 1) {
    const item = items[index] as (typeof items)[number];
    traceLine(`bank-child:${seedText}:${startText}`, `item ${index} ${item.id} begins`);
    process.stdout.write(`${JSON.stringify({ start: index, id: item.id })}\n`);
    const began = performance.now();
    const mark = frame.position();
    const ran = await runItem(item, seed, root as string, s, {
      mark: () => frame.position(),
      aliased: (since) => frame.aliasSince(since),
      altered: (since) => frame.alteredSince(since),
      strict: (on) => frame.strictArguments(on),
    });
    // A call whose runs answered differently makes the item fail whatever the item concluded.
    const split = frame.divergenceSince(mark);
    const outcome = split
      ? { pass: false, detail: `the product's answer depends on how it is run: ${split}` }
      : ran;
    process.stdout.write(
      `${JSON.stringify({ done: index, id: item.id, pass: outcome.pass, detail: outcome.detail, ms: Math.round(performance.now() - began) })}\n`,
    );
  }
  traceLine(`bank-child:${seedText}:${startText}`, 'items done, closing the frame');
  closeFrame(frame);
  await frame.ended();
  traceLine(`bank-child:${seedText}:${startText}`, 'frame closed');
  // The last line: every outcome and the frame's taint are written before it, so the parent has all it needs.
  process.stdout.write(`${JSON.stringify({ closed: true })}\n`);
}

/** The module of the package under test: the replacement named by the environment, else the checkout's own source. */
function productModule(root: string, implPath: string | undefined): string {
  if (implPath) return implPath.startsWith('file://') ? fileURLToPath(implPath) : implPath;
  const source = join(root, 'packages', 'stats', 'src', 'index.ts');
  if (existsSync(source)) return source;
  return fileURLToPath(import.meta.resolve('@agent-nexus/driftbench-stats'));
}

/** Ends the frame; a sampled run C call that differed is told to the parent, which fails every item of the seed. */
function closeFrame(frame: Frame<StatsImpl>): void {
  const taint = frame.tainted();
  if (taint) process.stdout.write(`${JSON.stringify({ taint })}\n`);
  const timing = process.env.DRIFTBENCH_FRAME_TIMING_FILE;
  if (timing)
    appendFileSync(
      timing,
      `${JSON.stringify({ pid: process.pid, ...frame.spent(), productMs: frame.cpuSince(0) })}\n`,
    );
  frame.close();
}

/** Runs the child and ends the process: exit 0 when every item ran, exit 1 with the cause on stderr otherwise. */
export function statsBankChild(args: readonly string[]): Promise<never> {
  return main(args).then(
    // Exit when every line has left the process: an exit with output still queued would drop it.
    () =>
      new Promise<never>(() => {
        traceLine('bank-child', 'writing the end of the output');
        process.on('exit', () => traceLine('bank-child', 'exit event'));
        process.stdout.write('', () => {
          traceLine('bank-child', 'output written, exiting');
          process.exit(0);
        });
      }),
    (cause) => {
      process.stderr.write(`bank child failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
      process.exit(1);
    },
  );
}
