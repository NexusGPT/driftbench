import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { variablesBank } from '../../src/ladders/variables/bank/index';
import { runIsolated } from '../../src/ladders/variables/bank/isolate';
import { IMPL_SOURCES_ENV } from '../../src/ladders/variables/bank/run-child';
import { IMPL_ENV } from '../../src/ladders/variables/impl';
import { findRoot } from '../../src/root';

/**
 * The cheats of the round-2 audit of the variables bank that only a frame closes (docs/validators.md section 12.9;
 * board row 887c6e52). Today the bank's child process loads the implementation beside the bank, so the
 * implementation shares the bank's process: it can read what the bank means by each span (from the bank's own span
 * table, or through node:inspector, codex review of PR 1365, run 39837191979), rewrite the outcome lines the parent
 * reads, and move its work into a child process whose processor time the bank does not count. Each test runs the
 * real bank items through the real runner with such a product, and states the property the frame must give.
 */

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

const ROOT = findRoot(process.cwd());
const CHEATS = fileURLToPath(new URL('./fixtures/cheats/', import.meta.url));
const READERS = fileURLToPath(new URL('./reference/readers.ts', import.meta.url));
const SEED = 17;
mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true });
const work = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'variables-frame-cheats-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The outcomes of the named items on one seed, through the runner, with the implementation in `module`. */
async function outcomes(
  module: string,
  ids: readonly string[],
  env: Record<string, string> = {},
  mayNotLoad = false,
) {
  const items = variablesBank().filter((item) => ids.includes(item.id));
  expect(items.map((item) => item.id).sort()).toEqual([...ids].sort());
  const before = { ...process.env };
  // The fixtures import the test reference and the bank's span module: named sources, so the implementation loads
  // under the frame, with its own copy of each module.
  const sources = [
    join(ROOT, 'packages/validators/src'),
    join(ROOT, 'packages/validators/test/variables-blind'),
  ];
  Object.assign(process.env, { [IMPL_ENV]: module, [IMPL_SOURCES_ENV]: sources.join(delimiter), ...env });
  try {
    const run = await runIsolated(items, SEED, ROOT);
    // Each outcome is printed: a test that passes for a reason other than the property is visible in the log.
    for (const id of ids) console.log(`${id}: ${JSON.stringify(run.get(id))?.slice(0, 400)}`);
    // A crash of the bank's child is no verdict on the implementation.
    for (const id of ids) expect(run.get(id)?.detail ?? '', id).not.toMatch(/child process (died|ended)/);
    // An implementation that does not load proves nothing about the property; only the inspector observer may fail
    // to load (a confined run may refuse the inspector at load).
    if (!mayNotLoad)
      for (const id of ids)
        expect(run.get(id)?.detail ?? '', id).not.toContain('does not load under the frame');
    return ids.map((id) => ({
      id,
      pass: run.get(id)?.pass === true,
      detail: run.get(id)?.detail ?? 'no outcome',
    }));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}

const SPAN_ITEMS = ['blind.scale.readers.spans-200', 'blind.scale.readers.spans-2000'];

describe('a product cannot learn what the bank means by a span', () => {
  it("from the bank's own span table", async () => {
    const got = await outcomes(join(CHEATS, 'table.ts'), SPAN_ITEMS);
    expect(got.map((each) => each.pass)).toEqual([false, false]);
  });

  it('through node:inspector, by a breakpoint on the function the bank declares its spans with', async () => {
    // The reference reader, its meaning of each span taken from what the breakpoint captured, not from the table.
    // Generated files are .mts: an ES module by its name, so its top-level await loads wherever the file sits.
    const reader = join(work, 'inspector-reader.mts');
    const observer = JSON.stringify(join(CHEATS, 'inspector-observer.ts'));
    const variables = join(ROOT, 'packages/validators/src/ladders/variables');
    const src = (path: string) => JSON.stringify(join(variables, path));
    const validate = JSON.stringify(fileURLToPath(new URL('./reference/validate.ts', import.meta.url)));
    const source = readFileSync(READERS, 'utf8')
      // The reference takes span meanings from the test span table (release/next, #1365) and their type from the
      // bank's span module: the meanings come from what the breakpoint captured instead.
      .replace("import { meaningOf } from '../span-table';", `import { meaningOf } from ${observer};`)
      .replace(
        "import type { SpanMeaning } from '../../../src/ladders/variables/blind/spans';",
        `import type { SpanMeaning } from ${src('blind/spans.ts')};`,
      )
      .replace("from '../../../src/ladders/variables/interface';", `from ${src('interface.ts')};`)
      .replace("from './validate';", `from ${validate};`);
    expect(source).toContain('inspector-observer');
    writeFileSync(reader, source);
    const product = join(work, 'inspector.mts');
    writeFileSync(
      product,
      [
        `import { observe } from ${observer};`,
        'await observe();',
        `const { buildStore } = await import(${JSON.stringify(reader)});`,
        'export const variablesImpl = { buildStore };',
        '',
      ].join('\n'),
    );
    const got = await outcomes(product, SPAN_ITEMS, {}, true);
    expect(got.map((each) => each.pass)).toEqual([false, false]);
  });
});

describe('a product cannot write its own verdict', () => {
  it('a wrong interval stays failed when the product rewrites the outcome lines of its process', async () => {
    const ids = ['blind.weights.interval.five-of-ten', 'blind.weights.interval.three-of-seven'];
    const got = await outcomes(join(CHEATS, 'stdout.ts'), ids);
    expect(got.map((each) => each.pass)).toEqual([false, false]);
  });
});

describe('the processor time of a call counts the work the product moves into a child process', () => {
  const ids = ['blind.scale.readers.owner-values-2000'];

  it('control: 7 s of processor time in its own process fails the 3 s item', async () => {
    const got = await outcomes(join(CHEATS, 'child-cpu.ts'), ids);
    expect(got.map((each) => each.pass)).toEqual([false]);
  });

  it('the same 7 s in a child process fails it too: a confined run starts no process', async () => {
    const got = await outcomes(join(CHEATS, 'child-cpu.ts'), ids, { FIXTURE_IN_CHILD: '1' });
    expect(got.map((each) => each.pass)).toEqual([false]);
    // The refused spawn is named by its code: an error crosses the frame with its code (release/next 2b2a34b6c), which
    // comes first in the answer the detail quotes, so the message may be cut before its end.
    expect(got[0]?.detail).toContain('ERR_ACCESS_DENIED');
  });
});
