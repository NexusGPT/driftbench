import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { REPO } from './bench';
import { FIXTURE } from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';

/**
 * estate.determinism: the same inputs give the same outputs, byte for byte, across runs, processes, folders,
 * file orders, time zones and locales (docs/estate.md section 5: "The same map, plan, bank and seed give the
 * same specs"; section 1: every atom's id and hash come from its file, span and quote). And the seed matters
 * where the docs say it does: the phrases are shuffled by the seed. Each item runs the commands twice in
 * separate processes on copies of the Northwind fixture and compares what they wrote. Seed-free, judged once.
 */

type Env = Record<string, string>;

/** The other Node the package supports (docs/estate.md section 5: Node 22 and later), when installed here. */
const OTHER_NODE = process.env.DRIFTBENCH_OTHER_NODE ?? '/usr/local/bin/node';

function run(args: string[], env: Env = {}, node?: string): { code: number; out: string } {
  if (node) {
    const result = spawnSync(
      node,
      [join(REPO, 'node_modules/tsx/dist/cli.mjs'), 'packages/cli/src/bin.ts', ...args],
      {
        cwd: REPO,
        encoding: 'utf8',
        timeout: 300_000,
        env: { ...process.env, ...env },
      },
    );
    return { code: result.status ?? -1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }
  const result = spawnSync('pnpm', ['-s', 'driftbench', ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, ...env },
  });
  return { code: result.status ?? -1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

async function copyEstate(to: string, reverse = false): Promise<void> {
  const names = ['CLAUDE.md', '.claude'];
  for (const name of reverse ? [...names].reverse() : names)
    await cp(join(FIXTURE, name), join(to, name), { recursive: true });
}

/** Every file under a folder, relative path to its text, the folder's own name taken out of the text. */
async function snapshot(folder: string): Promise<Map<string, string>> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true }).catch(() => []);
  const out = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out.set(relative(folder, path), (await readFile(path, 'utf8')).split(folder).join('<out>'));
  }
  return out;
}

function sameFiles(a: Map<string, string>, b: Map<string, string>): string | undefined {
  if (a.size === 0) return 'the first run wrote nothing';
  const names = new Set([...a.keys(), ...b.keys()]);
  for (const name of [...names].sort()) {
    if (!a.has(name) || !b.has(name)) return `${name} is written by one run only`;
    if (a.get(name) !== b.get(name)) return `${name} differs between the two runs`;
  }
  return undefined;
}

const text = (path: string) => readFile(path, 'utf8').catch(() => '');

type Ctx = { work: string; answers: string; plan: string; phrases: string };

type Case = {
  key: string;
  tier: Tier;
  title: string;
  cause: string;
  component: string;
  judge(ctx: Ctx): Promise<ItemResult>;
};

const SCAN = 'packages/estate/src/scan/index.ts';
const PLAN = 'packages/estate/src/plan/plan.ts';
const GENERATE = 'packages/generate/src/estate/generate.ts';
const MAINTAIN = 'packages/estate/src/maintain/impact.ts';

let counter = 0;
const fresh = async (ctx: Ctx, name: string) => {
  counter += 1;
  return mkdtemp(join(ctx.work, `${name}-${counter}-`));
};

/** Scans a copy of the fixture into a map file and returns its text. */
async function scanned(
  ctx: Ctx,
  options: { reverse?: boolean; env?: Env; noModel?: boolean; node?: string } = {},
): Promise<{ text: string; root: string; map: string }> {
  const root = await fresh(ctx, 'estate');
  await copyEstate(root, options.reverse);
  const map = join(root, '..', `${relative(ctx.work, root)}.map.yaml`);
  run(
    [
      'estate',
      'scan',
      root,
      ...(options.noModel ? ['--no-model'] : ['--replay', ctx.answers]),
      '--out',
      map,
      '--force',
    ],
    options.env,
    options.node,
  );
  // The map records when it was read and the root folder's name, by design (provenance): those are left out.
  const value = (await text(map))
    .split(root)
    .join('<root>')
    .replace(/^(\s*(readAt|at): )\d{4}-\d\d-\d\dT[\d:.]+Z$/gm, '$1<time>')
    .replace(/^root: .*$/m, 'root: <root>');
  return { text: value, root, map };
}

const verdict = (problem: string | undefined, what: string): ItemResult =>
  problem ? { pass: false, detail: problem } : { pass: true, detail: `holds: ${what}` };

const compareText = (a: string, b: string, what: string): ItemResult =>
  a === ''
    ? { pass: false, detail: `the first run wrote no ${what}` }
    : verdict(a === b ? undefined : `the ${what} differs between the two runs`, what);

async function generated(ctx: Ctx, seed: number, env: Env = {}, node?: string): Promise<Map<string, string>> {
  // The same file names in a fresh folder each time, so only the folder differs, and it is taken out.
  const folder = await fresh(ctx, 'generate');
  const plan = join(folder, 'plan.yaml');
  const map = join(folder, 'map.yaml');
  await cp(ctx.plan, plan);
  await cp(join(FIXTURE, 'approved.yaml'), map);
  await cp(ctx.phrases, join(folder, 'phrases.yaml'));
  run(['estate', 'plan', 'approve', plan, '--all']);
  const out = join(folder, 'suite');
  run(
    ['estate', 'generate', '--map', map, '--plan', plan, '--out', out, '--seed', String(seed), '--force'],
    env,
    node,
  );
  const files = await snapshot(out);
  for (const [name, value] of files) files.set(name, value.split(folder).join('<folder>'));
  return files;
}

async function planned(ctx: Ctx, env: Env = {}, node?: string): Promise<string> {
  const out = join(await fresh(ctx, 'plan'), 'plan.yaml');
  run(['estate', 'plan', join(FIXTURE, 'approved.yaml'), '--out', out, '--force'], env, node);
  return text(out);
}

const CASES: Case[] = [
  {
    key: 'scan-twice',
    tier: 1,
    title: 'two scans of one estate with the recorded answers write the same map',
    cause: 'make estate scan deterministic',
    component: SCAN,
    async judge(ctx) {
      return compareText((await scanned(ctx)).text, (await scanned(ctx)).text, 'map');
    },
  },
  {
    key: 'scan-no-model-twice',
    tier: 1,
    title: 'two structure-only scans write the same map',
    cause: 'make estate scan deterministic',
    component: SCAN,
    async judge(ctx) {
      return compareText(
        (await scanned(ctx, { noModel: true })).text,
        (await scanned(ctx, { noModel: true })).text,
        'map',
      );
    },
  },
  {
    key: 'scan-file-order',
    tier: 2,
    title: 'the map does not depend on the order the files were created in',
    cause: 'sort what the scan walks, never trust the folder order',
    component: SCAN,
    async judge(ctx) {
      return compareText((await scanned(ctx)).text, (await scanned(ctx, { reverse: true })).text, 'map');
    },
  },
  {
    key: 'scan-folder',
    tier: 2,
    title: 'the map does not depend on the folder the estate sits in',
    cause: 'record every path relative to the estate root',
    component: SCAN,
    async judge(ctx) {
      const a = await scanned(ctx);
      const b = await scanned(ctx);
      const hash = (value: string) => /^hash: (\S+)/m.exec(value)?.[1] ?? '';
      return verdict(
        hash(a.text) === '' || hash(a.text) !== hash(b.text)
          ? `map hashes ${hash(a.text)} and ${hash(b.text)} differ`
          : undefined,
        'map hash',
      );
    },
  },
  {
    key: 'scan-time-zone',
    tier: 3,
    title: 'the map does not depend on the time zone',
    cause: 'keep the time zone out of every output',
    component: SCAN,
    async judge(ctx) {
      return compareText(
        (await scanned(ctx, { env: { TZ: 'UTC' } })).text,
        (await scanned(ctx, { env: { TZ: 'Pacific/Kiritimati' } })).text,
        'map',
      );
    },
  },
  {
    key: 'scan-locale',
    tier: 3,
    title: 'the map does not depend on the locale',
    cause: 'sort and case-fold without the locale',
    component: SCAN,
    async judge(ctx) {
      return compareText(
        (await scanned(ctx, { env: { LC_ALL: 'C' } })).text,
        (await scanned(ctx, { env: { LC_ALL: 'tr_TR.UTF-8', LANG: 'tr_TR.UTF-8' } })).text,
        'map',
      );
    },
  },
  {
    key: 'lint-twice',
    tier: 1,
    title: 'two lints of one map print the same findings',
    cause: 'make estate lint deterministic',
    component: 'packages/estate/src/lint/lint.ts',
    async judge() {
      const map = join(FIXTURE, 'approved.yaml');
      return compareText(run(['estate', 'lint', map]).out, run(['estate', 'lint', map]).out, 'lint output');
    },
  },
  {
    key: 'plan-twice',
    tier: 1,
    title: 'two plans of one map write the same plan',
    cause: 'make estate plan deterministic',
    component: PLAN,
    async judge(ctx) {
      return compareText(await planned(ctx), await planned(ctx), 'plan');
    },
  },
  {
    key: 'plan-time-zone',
    tier: 3,
    title: 'the plan does not depend on the time zone',
    cause: 'keep the time zone out of every output',
    component: PLAN,
    async judge(ctx) {
      return compareText(
        await planned(ctx, { TZ: 'UTC' }),
        await planned(ctx, { TZ: 'Pacific/Kiritimati' }),
        'plan',
      );
    },
  },
  {
    key: 'plan-locale',
    tier: 3,
    title: 'the plan does not depend on the locale',
    cause: 'sort and case-fold without the locale',
    component: PLAN,
    async judge(ctx) {
      return compareText(
        await planned(ctx, { LC_ALL: 'C' }),
        await planned(ctx, { LC_ALL: 'tr_TR.UTF-8', LANG: 'tr_TR.UTF-8' }),
        'plan',
      );
    },
  },
  {
    key: 'generate-twice',
    tier: 1,
    title: 'two generations with one seed write the same specs',
    cause: 'make estate generate deterministic',
    component: GENERATE,
    async judge(ctx) {
      return verdict(sameFiles(await generated(ctx, 1), await generated(ctx, 1)), 'specs');
    },
  },
  {
    key: 'generate-seed-matters',
    tier: 2,
    title: 'another seed shuffles the approved phrases into other specs',
    cause: 'shuffle the approved phrases by the seed',
    component: GENERATE,
    async judge(ctx) {
      const a = await generated(ctx, 1);
      const b = await generated(ctx, 2);
      return verdict(
        sameFiles(a, b) === undefined ? 'seeds 1 and 2 write the same specs' : undefined,
        'seeds differ',
      );
    },
  },
  {
    key: 'generate-time-zone',
    tier: 3,
    title: 'the specs do not depend on the time zone',
    cause: 'keep the time zone out of every output',
    component: GENERATE,
    async judge(ctx) {
      return verdict(
        sameFiles(
          await generated(ctx, 1, { TZ: 'UTC' }),
          await generated(ctx, 1, { TZ: 'Pacific/Kiritimati' }),
        ),
        'specs',
      );
    },
  },
  {
    key: 'generate-locale',
    tier: 3,
    title: 'the specs do not depend on the locale',
    cause: 'sort and case-fold without the locale',
    component: GENERATE,
    async judge(ctx) {
      return verdict(
        sameFiles(
          await generated(ctx, 1, { LC_ALL: 'C' }),
          await generated(ctx, 1, { LC_ALL: 'tr_TR.UTF-8', LANG: 'tr_TR.UTF-8' }),
        ),
        'specs',
      );
    },
  },
  {
    key: 'diff-twice',
    tier: 2,
    title: 'two diffs of one pair of maps write the same diff',
    cause: 'make estate diff deterministic',
    component: 'packages/estate/src/maintain/diff.ts',
    async judge(ctx) {
      const old = join(FIXTURE, 'approved.yaml');
      const fresh = (await scanned(ctx, { noModel: true })).map;
      const a = run(['estate', 'diff', old, fresh, '--json']).out;
      const b = run(['estate', 'diff', old, fresh, '--json']).out;
      return compareText(a, b, 'diff');
    },
  },
  {
    key: 'impact-twice',
    tier: 2,
    title: 'two impacts of one diff over one suite write the same impact',
    cause: 'make estate impact deterministic',
    component: MAINTAIN,
    async judge(ctx) {
      const old = join(FIXTURE, 'approved.yaml');
      const fresh = (await scanned(ctx, { noModel: true })).map;
      const diff = join(ctx.work, `diff-${counter}.json`);
      run(['estate', 'diff', old, fresh, '--out', diff]);
      const tests = join(FIXTURE, 'generated');
      return compareText(
        run(['estate', 'impact', diff, '--tests', tests, '--json']).out,
        run(['estate', 'impact', diff, '--tests', tests, '--json']).out,
        'impact',
      );
    },
  },
  {
    key: 'mutate-twice',
    tier: 2,
    title: 'two mutants of one atom write the same copy and the same map',
    cause: 'make estate mutate deterministic',
    component: 'packages/estate/src/mutants/mutate.ts',
    async judge(ctx) {
      const map = join(FIXTURE, 'approved.yaml');
      const atom = /\n {2}- id: (tool\.settings\.allow-[\w-]+)/.exec(await text(map))?.[1] ?? '';
      const a = await fresh(ctx, 'mutant');
      const b = await fresh(ctx, 'mutant');
      await rm(a, { recursive: true, force: true });
      await rm(b, { recursive: true, force: true });
      run(['estate', 'mutate', map, '--atom', atom, '--delete', '--to', a]);
      run(['estate', 'mutate', map, '--atom', atom, '--delete', '--to', b]);
      return verdict(sameFiles(await snapshot(a), await snapshot(b)), 'mutant');
    },
  },
  {
    key: 'run-order-twice',
    tier: 1,
    title: 'two generations write the same run order',
    cause: 'make estate generate deterministic',
    component: GENERATE,
    async judge(ctx) {
      const a = await generated(ctx, 1);
      const b = await generated(ctx, 1);
      return compareText(a.get('run-order.txt') ?? '', b.get('run-order.txt') ?? '', 'run order');
    },
  },
  {
    key: 'generate-report-twice',
    tier: 1,
    title: 'two generations write the same report',
    cause: 'make estate generate deterministic',
    component: GENERATE,
    async judge(ctx) {
      const a = await generated(ctx, 1);
      const b = await generated(ctx, 1);
      return compareText(
        a.get('estate-generate-report.json') ?? '',
        b.get('estate-generate-report.json') ?? '',
        'report',
      );
    },
  },
  {
    key: 'scan-stdout-twice',
    tier: 1,
    title: 'two scans print the same summary',
    cause: 'make estate scan deterministic',
    component: SCAN,
    async judge(ctx) {
      const root = await fresh(ctx, 'estate');
      await copyEstate(root);
      const once = () =>
        run([
          'estate',
          'scan',
          root,
          '--replay',
          ctx.answers,
          '--out',
          join(ctx.work, `stdout-${counter}.yaml`),
          '--force',
        ])
          .out.split(root)
          .join('<root>')
          .replace(/stdout-\d+\.yaml/g, 'map.yaml');
      return compareText(once(), once(), 'summary');
    },
  },
  {
    key: 'node22-scan',
    tier: 3,
    title: 'a scan on Node 22 writes the map a scan on the current Node writes',
    cause: 'keep every output the same on every supported Node version',
    component: SCAN,
    async judge(ctx) {
      return compareText((await scanned(ctx)).text, (await scanned(ctx, { node: OTHER_NODE })).text, 'map');
    },
  },
  {
    key: 'node22-scan-no-model',
    tier: 3,
    title: 'a structure-only scan on Node 22 writes the same map',
    cause: 'keep every output the same on every supported Node version',
    component: SCAN,
    async judge(ctx) {
      return compareText(
        (await scanned(ctx, { noModel: true })).text,
        (await scanned(ctx, { noModel: true, node: OTHER_NODE })).text,
        'map',
      );
    },
  },
  {
    key: 'node22-plan',
    tier: 3,
    title: 'a plan on Node 22 is the plan of the current Node',
    cause: 'keep every output the same on every supported Node version',
    component: PLAN,
    async judge(ctx) {
      return compareText(await planned(ctx), await planned(ctx, {}, OTHER_NODE), 'plan');
    },
  },
  {
    key: 'node22-generate',
    tier: 3,
    title: 'a generation on Node 22 writes the specs of the current Node',
    cause: 'keep every output the same on every supported Node version',
    component: GENERATE,
    async judge(ctx) {
      return verdict(sameFiles(await generated(ctx, 1), await generated(ctx, 1, {}, OTHER_NODE)), 'specs');
    },
  },
  {
    key: 'node22-lint',
    tier: 3,
    title: 'a lint on Node 22 prints the findings of the current Node',
    cause: 'keep every output the same on every supported Node version',
    component: 'packages/estate/src/lint/lint.ts',
    async judge() {
      const map = join(FIXTURE, 'approved.yaml');
      return compareText(
        run(['estate', 'lint', map]).out,
        run(['estate', 'lint', map], {}, OTHER_NODE).out,
        'lint output',
      );
    },
  },
];

export function determinismFamily(): Family {
  const family = 'estate.determinism';
  const items = itemsOf(
    family,
    1,
    SCAN,
    CASES.map(({ key, tier, title, cause, component }) => ({ key, tier, title, cause, component })),
  );
  return {
    id: family,
    level: 1,
    component: SCAN,
    items,
    seedFree: true,
    async evaluate() {
      const work = await mkdtemp(join(tmpdir(), 'estate-determinism-'));
      const ctx: Ctx = {
        work,
        answers: join(FIXTURE, 'answers.yaml'),
        plan: join(FIXTURE, 'plan.yaml'),
        phrases: join(FIXTURE, 'phrases.yaml'),
      };
      const out = new Map<string, ItemResult>();
      try {
        for (const item of CASES) {
          try {
            out.set(`${family}.${item.key}`, await item.judge(ctx));
          } catch (cause) {
            out.set(`${family}.${item.key}`, {
              pass: false,
              detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
            });
          }
        }
      } finally {
        await rm(work, { recursive: true, force: true });
      }
      return out;
    },
  };
}
