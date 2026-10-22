/**
 * What the bank's child process runs: the items of the variables bank on one seed, in the order given on stdin,
 * from a start index, with one JSON line before and after each item.
 *
 * The child holds the bank and its expected values, and nothing of the product: the product runs in the confined
 * processes of the frame (docs/validators.md section 12.9), reached through a proxy, so it cannot import the bank, read
 * its fixtures, or write a line to the channel this process reports on.
 */
import { appendFileSync } from 'node:fs';
import type { Guard } from '../../../frame';
import { runItem, variablesBank } from './index';
import { openProduct, type Product } from './product';
import { useProductClock } from './util';

/** The families whose items check that a call returns objects of its own. */
const GUARDED_FAMILIES = new Set(['values', 'determinism', 'seeds', 'seed-rows']);
const GUARDS: readonly Guard[] = ['sharing'];
/** The functions whose results must be built new (docs/variables.md R11: reader results share no object with inputs). */
const FRESH_RESULTS = ['buildStore', 'plan'];

async function main(args: readonly string[]): Promise<void> {
  const [seedText, root, startText] = args;
  const seed = Number(seedText);
  const start = Number(startText ?? 0);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const ids = JSON.parse(Buffer.concat(chunks).toString('utf8')) as string[];
  const byId = new Map(variablesBank().map((item) => [item.id, item]));
  const items = ids.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`no bank item ${id}`);
    return item;
  });
  let product: Product;
  try {
    product = openProduct(seed, `variables:${seed}:${start}:${process.pid}`);
  } catch (cause) {
    // A product that cannot run under the frame (it does not load, it imports a file of the bank) fails every item
    // by name, here, instead of one child process for each item.
    const detail = `the product cannot run apart from the bank: ${(cause instanceof Error ? cause.message : String(cause)).split('\n').slice(0, 4).join(' ')}`;
    for (let index = start; index < items.length; index += 1) {
      const item = items[index] as (typeof items)[number];
      process.stdout.write(`${JSON.stringify({ start: index, id: item.id })}\n`);
      process.stdout.write(`${JSON.stringify({ done: index, id: item.id, pass: false, detail, ms: 0 })}\n`);
    }
    return;
  }
  const { frame, impl, module } = product;
  useProductClock({ mark: () => frame.position(), since: (mark) => frame.cpuSince(mark) });
  for (let index = start; index < items.length; index += 1) {
    const item = items[index] as (typeof items)[number];
    process.stdout.write(`${JSON.stringify({ start: index, id: item.id })}\n`);
    const began = performance.now();
    const mark = frame.position();
    frame.forget();
    // An item that declares a purity check hands the product its inputs frozen; no other item has that rule.
    frame.strictArguments(item.purity === true);
    const watch = { ambient: frame.ambient, sameObjects: frame.sameObjects };
    const ran = await frame.guarded(
      GUARDED_FAMILIES.has(item.family) ? GUARDS : [],
      () => runItem(item, seed, root as string, impl, module, watch),
      FRESH_RESULTS,
    );
    // A call whose runs answered differently, a result that changed later, a call that wrote to an argument it must
    // not, or a result that shares an object makes the item fail whatever the item concluded.
    const split = frame.divergenceSince(mark);
    const moved = frame.aliasSince(mark);
    const guard = frame.guardSince(mark);
    const outcome = split
      ? { pass: false, detail: `the product's answer depends on how it is run: ${split}` }
      : moved
        ? { pass: false, detail: moved }
        : guard
          ? { pass: false, detail: guard }
          : ran;
    process.stdout.write(
      `${JSON.stringify({ done: index, id: item.id, pass: outcome.pass, detail: outcome.detail, ms: Math.round(performance.now() - began) })}\n`,
    );
  }
  closeFrame(product);
}

/** Ends the frame; a sampled run C call that differed is told to the parent, which fails every item of the seed. */
function closeFrame({ frame }: Product): void {
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
export function variablesBankChild(args: readonly string[]): Promise<never> {
  return main(args).then(
    () =>
      new Promise<never>(() => {
        process.stdout.write('', () => process.exit(0));
      }),
    (cause) => {
      process.stderr.write(`bank child failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
      process.exit(1);
    },
  );
}
