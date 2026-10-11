/**
 * The bank's child process: runs the items of the statistics bank on one seed, in bank order, from a start index,
 * and writes one JSON line before and after each item. The parent (isolate.ts) kills it when an item runs past
 * its budget, so an endless loop in the statistics package fails one item instead of hanging the validator.
 * Usage: node --import tsx child.ts <seed> <root> <start>
 */
import { runItem, statsBank } from './index';

async function main(): Promise<void> {
  const [seedText, root, startText] = process.argv.slice(2);
  const seed = Number(seedText);
  const start = Number(startText ?? 0);
  const items = statsBank();
  for (let index = start; index < items.length; index += 1) {
    const item = items[index] as (typeof items)[number];
    process.stdout.write(`${JSON.stringify({ start: index, id: item.id })}\n`);
    const began = performance.now();
    const outcome = await runItem(item, seed, root as string);
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
