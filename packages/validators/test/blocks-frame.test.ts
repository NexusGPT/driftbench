import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { FrameError, isolate } from '../src/frame';
import { observed, run, scriptedAdapter } from '../src/ladders/blocks/harness';
import {
  type BankItem,
  blocksBank,
  framed,
  levelMeasure,
  need,
  realProduct,
} from '../src/ladders/blocks/index';

/**
 * The blocks bank runs the product through the frame (docs/validators.md section 13, "The bank runs the product
 * through the frame"): the bank's process loads no product module, every product call crosses to the frame's two
 * child processes as data, a function the bank hands the product stays in the bank and is called back, and a
 * cheat the product plants in its own process reaches no verdict.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BLOCKS = fileURLToPath(new URL('../src/ladders/blocks/index.ts', import.meta.url));
const HOST = fileURLToPath(new URL('../src/ladders/blocks/child/host.ts', import.meta.url));
const PRODUCT_PACKAGES = [
  'core',
  'checks',
  'stats',
  'report',
  'users',
  'adapters',
  'store',
  'sandbox',
  'artifacts',
  'cli',
];

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});
function folder(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  folders.push(made);
  return made;
}

/** A spec of one block: the agent must say the code. */
function oneBlock(id: string, code: string) {
  return { id, blocks: [{ id: 'b0', user: `Is the Fern 3 free? ${code}`, expect: { must: [code] } }] };
}

describe('the bank process', () => {
  it('holds no product module after the bank loads and calls the product', { timeout: 120_000 }, () => {
    // A program of its own records every module the bank's process resolves, loads the bank, builds it, and
    // calls the product through the frame; the product's packages must never resolve in it.
    const work = folder('blocks-frame-probe-');
    const script = join(work, 'probe.mjs');
    const answer = join(work, 'answer.json');
    writeFileSync(
      script,
      `import { registerHooks } from 'node:module';
const seen = [];
registerHooks({ resolve(specifier, context, next) { const out = next(specifier, context); seen.push(out.url); return out; } });
const { blocksBank, realProduct, need } = await import(${JSON.stringify(pathToFileURL(BLOCKS).href)});
const items = blocksBank().length;
const product = realProduct();
product.frame.begin({ seed: 1, tag: 'probe', root: ${JSON.stringify(ROOT)} });
const hash = need(product.core, 'core', 'contentHash')({ a: 1 });
const divergence = product.frame.end();
const { writeFileSync } = await import('node:fs');
writeFileSync(${JSON.stringify(answer)}, JSON.stringify({ items, hash, divergence, seen }));
process.exit(0);
`,
    );
    const ran = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: ROOT, encoding: 'utf8' });
    expect(ran.status, ran.stderr.slice(-2000)).toBe(0);
    const out = JSON.parse(readFileSync(answer, 'utf8')) as {
      items: number;
      hash: unknown;
      divergence?: string;
      seen: string[];
    };
    expect(out.items).toBeGreaterThan(300);
    expect(typeof out.hash).toBe('string');
    expect(out.divergence).toBeUndefined();
    const product = out.seen.filter((url) =>
      PRODUCT_PACKAGES.some((name) => url.includes(`/packages/${name}/src/`)),
    );
    expect(product).toEqual([]);
    expect(out.seen.some((url) => url.includes('/packages/validators/src/ladders/blocks/'))).toBe(true);
  });
});

describe('a function the bank hands the product', () => {
  it('is refused by the frame itself: it cannot cross the process boundary', { timeout: 120_000 }, () => {
    const frame = isolate<Record<string, (...args: unknown[]) => unknown>>({
      module: HOST,
      seed: 1,
      tag: 'fn',
    });
    try {
      frame.product.init?.({ root: ROOT, privateRoot: folder('blocks-frame-private-') });
      expect(() => frame.product.call?.(['m', 'core'], 'contentHash', null, [() => 1])).toThrow(FrameError);
    } finally {
      frame.close();
    }
  });

  it('crosses through the child module as data and is called back in the bank', {
    timeout: 120_000,
  }, async () => {
    const product = realProduct();
    product.frame?.begin({ seed: 2, tag: 'callback', root: ROOT });
    try {
      // A scripted agent: its reply function runs here, each turn it is asked through the frame.
      const turns: string[] = [];
      const adapter = scriptedAdapter(product, (turn) => {
        turns.push(turn.user);
        return observed(turn.user.includes('K7Q2') ? 'Yes, it is free: K7Q2.' : 'No.');
      });
      const record = await run(product, oneBlock('fnspec', 'K7Q2'), adapter);
      expect(turns).toEqual(['Is the Fern 3 free? K7Q2']);
      expect(record.blocks.map((block) => block.pass)).toEqual([true]);
      // A custom check: the product calls the bank's function for each block and files its verdict.
      const registerCheck = need<
        (name: string, fn: (ctx: { observed: { text: string } }) => unknown) => void
      >(product.checks, 'checks', 'registerCheck');
      const machineVerdict = need<(...args: string[]) => unknown>(product.core, 'core', 'machineVerdict');
      const asked: string[] = [];
      registerCheck('frame-probe', (ctx) => {
        asked.push(ctx.observed.text);
        return machineVerdict(
          'frame-probe',
          'seen',
          ctx.observed.text.includes('K7Q2') ? 'pass' : 'fail',
          'read',
        );
      });
      const checked = await run(
        product,
        { ...oneBlock('fnspec2', 'K7Q2'), rules: { custom: { 'frame-probe': {} } } },
        scriptedAdapter(product, () => observed('Yes, K7Q2.')),
      );
      expect(asked).toEqual(['Yes, K7Q2.']);
      const verdicts = checked.blocks[0]?.verdicts ?? [];
      expect(verdicts.find((verdict) => verdict.id.startsWith('custom.frame-probe'))?.outcome).toBe('pass');
    } finally {
      expect(product.frame?.end()).toBeUndefined();
    }
  });
});

/**
 * A product root that is this repository with one cheat planted in the core package's entry: every top-level
 * entry links to the repository, `packages` links each package but core, and core's entry loads the cheat and
 * then the real core.
 */
function plantedRoot(cheat: string): string {
  const root = folder('blocks-frame-cheat-');
  for (const name of readdirSync(ROOT)) {
    if (name === 'packages' || name === 'node_modules') continue;
    symlinkSync(join(ROOT, name), join(root, name));
  }
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'));
  mkdirSync(join(root, 'packages'));
  for (const name of readdirSync(join(ROOT, 'packages'))) {
    if (name === 'core') continue;
    symlinkSync(join(ROOT, 'packages', name), join(root, 'packages', name));
  }
  mkdirSync(join(root, 'packages', 'core', 'src'), { recursive: true });
  writeFileSync(
    join(root, 'packages', 'core', 'package.json'),
    '{"name":"@agent-nexus/driftbench-core","type":"module"}',
  );
  writeFileSync(join(root, 'packages', 'core', 'src', 'cheat.ts'), cheat);
  writeFileSync(
    join(root, 'packages', 'core', 'src', 'index.ts'),
    `import './cheat.ts';\nexport * from ${JSON.stringify(join(ROOT, 'packages', 'core', 'src', 'index.ts'))};\n`,
  );
  return root;
}

/** The cheat N6 of the round-2 audit: every pushed object shaped like a result entry turns into a pass. */
const N6 = `const real = Array.prototype.push;
Array.prototype.push = function (...items) {
  for (const item of items) {
    const entry = item;
    if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.family === 'string'
      && typeof entry.cause === 'string' && typeof entry.pass === 'boolean') {
      entry.pass = true;
      delete entry.detail;
    }
  }
  return real.apply(this, items);
};
export {};
`;

/** Items that fail on this product for a capability it lacks: a gain shows as a pass. */
function failing(): BankItem[] {
  const ids = ['objects/loader/normal/disable-an-item/spec', 'values/identity/string-equal/no-services'];
  return blocksBank().filter((item) => ids.includes(item.id));
}

describe('a cheat the product plants in its own process', () => {
  it('of the N6 class (Array.prototype.push mends result entries) gains nothing', {
    timeout: 600_000,
  }, async () => {
    const items = failing();
    expect(items).toHaveLength(2);
    const product = realProduct();
    const honest = await levelMeasure(
      items.map((item) => framed(item, product)),
      1,
      ROOT,
      product,
    );
    const cheat = await levelMeasure(
      items.map((item) => framed(item, product)),
      1,
      plantedRoot(N6),
      product,
    );
    expect(honest.value).toBe(0);
    expect(cheat.value).toBe(0);
    expect(cheat.items.map((item) => item.id).sort()).toEqual(honest.items.map((item) => item.id).sort());
  });

  it('of the N6 class gains every item when it runs in the bank process: the hole the frame closes', {
    timeout: 600_000,
  }, () => {
    // The control: the same patch loaded into the bank's own process turns the same failing items into passes,
    // so the test above would see a gain if the cheat reached the bank.
    const work = folder('blocks-frame-n6-');
    const cheat = join(work, 'cheat.mjs');
    writeFileSync(cheat, N6);
    const script = join(work, 'run.mjs');
    writeFileSync(
      script,
      `await import(${JSON.stringify(pathToFileURL(cheat).href)});
const { blocksBank, framed, levelMeasure, realProduct } = await import(${JSON.stringify(pathToFileURL(BLOCKS).href)});
const ids = ['objects/loader/normal/disable-an-item/spec', 'values/identity/string-equal/no-services'];
const product = realProduct();
const items = blocksBank().filter((item) => ids.includes(item.id)).map((item) => framed(item, product));
const measure = await levelMeasure(items, 1, ${JSON.stringify(ROOT)}, product);
process.stdout.write(JSON.stringify({ value: measure.value }));
process.exit(0);
`,
    );
    const ran = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: ROOT, encoding: 'utf8' });
    expect(ran.status, ran.stderr.slice(-2000)).toBe(0);
    expect(JSON.parse(ran.stdout)).toEqual({ value: 1 });
  });
});
