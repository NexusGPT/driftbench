/**
 * What the bank's child process runs: the items of the variables bank on one seed, in the order given on stdin,
 * from a start index. The implementation runs apart, in the confined processes of the frame (docs/validators.md
 * section 12.9): the bank calls it through a proxy, sends it data only and keeps what it means by each span, its
 * checks and its verdicts in this process. The outcomes go to the parent on file descriptor 3, which no process of
 * the implementation holds; stdout is a log only.
 */
import { appendFileSync, createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { type Frame, isolate } from '../../../frame';
import { implModulePath } from '../impl';
import type { Sources, VariablesImpl } from '../interface';
import { canaryItems } from './canary';
import { runItem, variablesBank } from './index';
import { useProductAmbient, useProductClock } from './util';

/** The functions of the interface the bank calls. */
const FUNCTIONS = ['buildStore', 'weightInterval', 'plan', 'coverage', 'validate', 'quotes'] as const;

/** The variable that names more source folders the implementation may import (a test reference), by the path delimiter. */
export const IMPL_SOURCES_ENV = 'DRIFTBENCH_VARIABLES_IMPL_SOURCES';

/**
 * The module the frame runs: the implementation's functions as named exports. A module of the implementation exports
 * `variablesImpl`, a default export, or the functions themselves (impl.ts); the frame calls named exports.
 */
function entryModule(root: string, implPath: string): { entry: string; folder: string } {
  const folder = mkdtempSync(join(root, 'node_modules', '.cache', 'variables-impl-'));
  const entry = join(folder, 'entry.mts');
  // A function the implementation does not have is exported as undefined, so the bank sees it missing.
  const lines = [
    // A plain path: the bundler resolves paths, not file URLs.
    `import * as product from ${JSON.stringify(implPath)};`,
    'const impl = product.variablesImpl ?? product.default ?? product;',
    ...FUNCTIONS.map(
      (name) =>
        `export const ${name} = typeof impl.${name} === 'function' ? (...args) => impl.${name}(...args) : undefined;`,
    ),
    '',
  ];
  writeFileSync(entry, lines.join('\n'));
  return { entry, folder };
}

/**
 * Collect mode: DRIFTBENCH_VARIABLES_SPANS_OUT names a file, and every condition span the bank sends to `buildStore`
 * is appended to it as one JSON line (the span collector job; a labeller turns them into the cassette). The bank
 * writes it from the data it sends: the implementation's processes may write nowhere.
 */
function recordingSpans(impl: Partial<VariablesImpl>): Partial<VariablesImpl> {
  const out = process.env.DRIFTBENCH_VARIABLES_SPANS_OUT;
  if (!out || !impl.buildStore) return impl;
  const build = impl.buildStore;
  const fold = (text: string) => text.replace(/\s+/g, ' ').trim();
  return {
    ...impl,
    buildStore: (sources: Sources) => {
      for (const rule of sources.estate?.rules ?? [])
        for (const condition of rule.conditions)
          appendFileSync(out, `${JSON.stringify({ text: fold(condition.text) })}\n`);
      return build(sources);
    },
  };
}

/**
 * The frame the bank calls the implementation through: its module and its own folder are its sources, the cassette
 * is the one file it may read (read only), and each run has a scratch folder of its own as its temporary folder.
 * `done` removes the generated entry module once the frame is closed.
 */
export function implFrame(
  root: string,
  implPath: string,
  seed: number,
  tag: string,
): { frame: Frame<VariablesImpl>; done: () => void } {
  mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
  const cassette = process.env.DRIFTBENCH_VARIABLES_CASSETTE;
  const extra = (process.env[IMPL_SOURCES_ENV] ?? '').split(delimiter);
  const { entry, folder } = entryModule(root, implPath);
  const frame = isolate<VariablesImpl>({
    module: entry,
    seed,
    tag,
    sources: [dirname(implPath), ...extra.filter((each) => each !== '')],
    reads: cassette ? [cassette] : [],
    // No variable of the validator's own reaches the runs: a variable every run gets alike would tell the product it
    // is checked (review of PR 1403, codex run 39870167091). The cassette is an input a user's run has too.
    ...(cassette ? { env: { DRIFTBENCH_VARIABLES_CASSETTE: cassette } } : {}),
    // The bank's child writes the collected spans (recordingSpans); the runs never do.
    unset: ['DRIFTBENCH_VARIABLES_SPANS_OUT', IMPL_SOURCES_ENV, 'DRIFTBENCH_VARIABLES_IMPL'],
    scratch: true,
  });
  return { frame, done: () => rmSync(folder, { recursive: true, force: true }) };
}

async function main(args: readonly string[], report: (line: object) => void): Promise<void> {
  const [seedText, root, startText] = args;
  const seed = Number(seedText);
  const start = Number(startText ?? 0);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const ids = JSON.parse(Buffer.concat(chunks).toString('utf8')) as string[];
  const byId = new Map([...variablesBank(), ...canaryItems()].map((item) => [item.id, item]));
  const items = ids.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`no bank item ${id}`);
    return item;
  });
  const implPath = implModulePath(root as string);
  let opened: ReturnType<typeof implFrame>;
  try {
    opened = implFrame(root as string, implPath, seed, `variables:${seed}:${start}:${process.pid}`);
  } catch (cause) {
    // The implementation does not load under the frame (it imports a file of the validator, it does not bundle):
    // every item fails with that cause, and the child closes as usual.
    const why = cause instanceof Error ? cause.message : String(cause);
    for (let index = start; index < items.length; index += 1) {
      const item = items[index] as (typeof items)[number];
      report({ start: index, id: item.id });
      const detail = `the implementation does not load under the frame: ${why}`;
      report({ done: index, id: item.id, pass: false, detail });
    }
    return;
  }
  const { frame, done } = opened;
  useProductClock({ mark: () => frame.position(), since: (mark) => frame.cpuSince(mark) });
  useProductAmbient((spec) => frame.ambient(spec));
  const impl = recordingSpans(frame.product);
  for (let index = start; index < items.length; index += 1) {
    const item = items[index] as (typeof items)[number];
    report({ start: index, id: item.id });
    const began = performance.now();
    const mark = frame.position();
    // The caller sees object identity as in its own process (docs/validators.md 12.9, object identity), so an item
    // that checks fresh results reads the sharing itself. A call whose runs answered differently or that changed a
    // built-in object fails the item whatever it concluded.
    const ran = await runItem(item, seed, root as string, impl, implPath);
    const split = frame.divergenceSince(mark);
    const altered = ran.pass ? frame.alteredSince(mark) : undefined;
    const outcome = split
      ? { pass: false, detail: `the implementation's answer depends on how it is run: ${split}` }
      : altered
        ? { pass: false, detail: `the implementation changed a built-in object: ${altered}` }
        : ran;
    report({
      done: index,
      id: item.id,
      pass: outcome.pass,
      detail: outcome.detail,
      ms: Math.round(performance.now() - began),
    });
  }
  closeFrame(frame, report);
  done();
}

/** Ends the frame; a sampled run C call that differed is told to the parent, which fails every item of the seed. */
function closeFrame(frame: Frame<VariablesImpl>, report: (line: object) => void): void {
  const taint = frame.tainted();
  if (taint) report({ taint });
  frame.close();
}

/**
 * Runs the child and ends the process: exit 0 when every item ran, exit 1 with the cause on stderr otherwise. The
 * last line on file descriptor 3 is `{"closed":true}`, written once the frame is closed: the parent counts the
 * outcomes of a child only when it arrived.
 */
export function variablesBankChild(args: readonly string[]): Promise<never> {
  const channel = createWriteStream('', { fd: 3 });
  const report = (line: object) => channel.write(`${JSON.stringify(line)}\n`);
  return main(args, report).then(
    () =>
      new Promise<never>(() => {
        channel.end(`${JSON.stringify({ closed: true })}\n`, () => process.exit(0));
      }),
    (cause) =>
      new Promise<never>(() => {
        process.stderr.write(`bank child failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
        channel.end(() => process.exit(1));
      }),
  );
}
