/**
 * The bank's child process: runs the items of the statistics bank on one seed, in bank order, from a start index,
 * and writes one JSON line before and after each item. The parent (isolate.ts) kills it when an item runs past
 * its budget, so an endless loop in the statistics package fails one item instead of hanging the validator.
 * Usage: node --import tsx child.ts <seed> <root> <start>, with the item ids to run as a JSON array on stdin.
 * DRIFTBENCH_STATS_IMPL, when set, is the path of another build of the statistics package's index to test (a
 * planted bug, or the package at an earlier commit, to measure a recorded row); unset, the package itself.
 */
import * as stats from '@driftbench/stats';
import type { StatsImpl } from '../reference';
import { runItem, statsBank } from './index';

async function main(): Promise<void> {
  const [seedText, root, startText] = process.argv.slice(2);
  const seed = Number(seedText);
  const start = Number(startText ?? 0);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const ids = JSON.parse(Buffer.concat(chunks).toString('utf8')) as string[];
  const implPath = process.env.DRIFTBENCH_STATS_IMPL;
  const s = (implPath ? await import(implPath) : stats) as StatsImpl;
  const byId = new Map(statsBank(root as string).map((item) => [item.id, item]));
  const items = ids.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`no bank item ${id}`);
    return item;
  });
  for (let index = start; index < items.length; index += 1) {
    const item = items[index] as (typeof items)[number];
    process.stdout.write(`${JSON.stringify({ start: index, id: item.id })}\n`);
    const began = performance.now();
    const outcome = await runItem(item, seed, root as string, s);
    process.stdout.write(
      `${JSON.stringify({ done: index, id: item.id, pass: outcome.pass, detail: outcome.detail, ms: Math.round(performance.now() - began) })}\n`,
    );
  }
}

main().then(
  () => process.exit(0),
  (cause) => {
    process.stderr.write(`bank child failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
    process.exit(1);
  },
);
