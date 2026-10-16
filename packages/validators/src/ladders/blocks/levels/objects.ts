import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
  between,
  list,
  loadIssues,
  observed,
  pick,
  type RawSpec,
  type Rng,
  type RunRecord,
  rngFor,
  run,
  SHOP,
  scriptedAdapter,
  shuffled,
} from '../harness';
import { type BlocksProduct, need } from '../product';
import { type BankItem, expectAll, fail, PASS, type Tier } from '../types';

/**
 * Level 4: rules as objects (PR 443, its command line PR 446 and the verdict stamps PR 449; docs/reference/
 * objects.md on those branches). The shipped `check-set` object `default` holds one item per shipped check,
 * named by the check (tools, forbidden, must, must_not, stage, lang, ...), then the runner's flow and ledger
 * items; `DEFAULT_CHECK_SET` of the checks package lists them. A spec or a block tailors it under `uses`: an override that names a real item loads, one that names an item the parent does not hold, adds
 * an item without its fields, mixes `order` with moves, or names an unknown object or implementation is refused
 * with its OBJECT_* code. `uses` enters the spec hash and no block cache key. `driftbench object` lists, shows,
 * explains (with the `--set` preflight), inits, validates, diffs and graphs objects with the documented exits.
 * Every tool verdict names the object, item, implementation and layer that produced it.
 */

const LOADER = 'packages/core/src/objects/index.ts';
const RULES = 'packages/core/src/objects/rules.ts';
const RESOLVE = 'packages/core/src/objects/resolve.ts';
const LAYERS = 'packages/core/src/objects/layers.ts';
const OBJECT_CLI = 'packages/cli/src/commands/object.ts';
const STAMPS = 'packages/core/src/runner/run.ts';

/** Items of check-set:default the overrides draw from: checks every block of this level can produce. */
export const CHECK_SET_ITEMS = ['tools', 'forbidden', 'must', 'must_not', 'stage', 'lang'] as const;

/** Every item id of the shipped check-set:default, in its order, as the product's checks package exports it. */
function shippedOrder(product: BlocksProduct): string[] {
  const set = need<{ items: { id: string }[]; order?: string[] }>(
    product.checks,
    'checks',
    'DEFAULT_CHECK_SET',
  );
  return set.order ? [...set.order] : set.items.map((item) => item.id);
}

const LAYERS_ENUM = ['shipped', 'project', 'suite', 'spec', 'block', 'cli'];

type Override = {
  id: string;
  tier: Tier;
  /** The `uses.check_set` value, from a seeded draw; `code` the refusal, or undefined when it loads. */
  build(
    p: <T>(items: readonly T[]) => T,
    rng: Rng,
    order: readonly string[],
  ): { ref: unknown; code: string | undefined };
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const others = (item: string) => CHECK_SET_ITEMS.filter((each) => each !== item);

const OVERRIDES: Override[] = [
  {
    id: 'disable-an-item',
    tier: 1,
    build: (p) => ({
      ref: { extends: 'default', items: [{ id: p(CHECK_SET_ITEMS), enabled: false }] },
      code: undefined,
    }),
  },
  {
    id: 'move-before',
    tier: 2,
    build: (p) => {
      const item = p(CHECK_SET_ITEMS);
      return { ref: { extends: 'default', items: [{ id: item, before: p(others(item)) }] }, code: undefined };
    },
  },
  {
    id: 'order-permutation',
    tier: 2,
    build: (_p, rng, order) => ({
      ref: { extends: 'default', order: shuffled(rng, order) },
      code: undefined,
    }),
  },
  {
    id: 'unknown-item-typo',
    tier: 1,
    build: (p) => {
      const item = p(CHECK_SET_ITEMS);
      const typo = p([item.toUpperCase(), `${item}s`, item.slice(0, -1), `${item}.count`]);
      return {
        ref: { extends: 'default', items: [{ id: typo, enabled: false }] },
        code: 'OBJECT_ITEM_UNKNOWN',
      };
    },
  },
  {
    id: 'unknown-item-new',
    tier: 2,
    build: (p) => ({
      ref: {
        extends: 'default',
        items: [{ id: p(['latency', 'retry_budget', 'R3', 'tools.count']), enabled: true }],
      },
      code: 'OBJECT_ITEM_UNKNOWN',
    }),
  },
  {
    id: 'add-incomplete',
    tier: 3,
    build: (p) => ({
      ref: {
        extends: 'default',
        items: [{ id: p(['extra_check', 'slow_reply']), add: true, title: 'A new check' }],
      },
      code: 'OBJECT_ITEM_INCOMPLETE',
    }),
  },
  {
    id: 'add-existing',
    tier: 3,
    build: (p) => {
      const item = p(CHECK_SET_ITEMS);
      return {
        ref: {
          extends: 'default',
          items: [
            {
              id: item,
              add: true,
              title: 'Again',
              when: {},
              effect: { gating: true },
              impl: `builtin:check/${item}`,
            },
          ],
        },
        code: 'OBJECT_ITEM_EXISTS',
      };
    },
  },
  {
    id: 'order-and-move',
    tier: 4,
    build: (p, _rng, order) => {
      const item = p(CHECK_SET_ITEMS);
      return {
        ref: { extends: 'default', order: [...order], items: [{ id: item, after: p(others(item)) }] },
        code: 'OBJECT_ORDER_INVALID',
      };
    },
  },
  {
    id: 'order-missing-an-item',
    tier: 4,
    build: (p, _rng, order) => {
      const dropped = p(CHECK_SET_ITEMS);
      return {
        ref: { extends: 'default', order: order.filter((item) => item !== dropped) },
        code: 'OBJECT_ORDER_INVALID',
      };
    },
  },
  {
    id: 'unknown-impl',
    tier: 3,
    build: (p) => ({
      ref: {
        extends: 'default',
        items: [{ id: p(CHECK_SET_ITEMS), impl: p(['builtin:check/nope', 'builtin:checks/tools-count']) }],
      },
      code: 'OBJECT_IMPL_UNKNOWN',
    }),
  },
  {
    id: 'unknown-object',
    tier: 1,
    build: (p) => ({ ref: p(['no-such-set', 'defaults', 'Default']), code: 'OBJECT_UNKNOWN' }),
  },
  {
    id: 'unknown-parent',
    tier: 2,
    build: (p) => ({ ref: { extends: p(['missing', 'default2']), items: [] }, code: 'OBJECT_UNKNOWN' }),
  },
];

function toolSpec(seed: number, tag: string, uses: { spec?: unknown; block?: unknown }): RawSpec {
  const rng = rngFor(seed, `${tag}#spec`);
  const n = between(rng, 2, 3);
  return {
    id: `blocks-objects-${seed}`,
    channel: 'chat',
    ...(uses.spec === undefined ? {} : { uses: { check_set: uses.spec } }),
    blocks: Array.from({ length: n }, (_, index) => ({
      id: `b${index}`,
      user: `[${tag}:${index}] Is the ${pick(rng, SHOP.bikes)} free?`,
      ...(index === n - 1 && uses.block !== undefined ? { uses: { check_set: uses.block } } : {}),
      expect: {
        must: ['free'],
        tools: [
          { label: 'bikes.lookup', count: 1 },
          { label: 'payment.charge', count: 0 },
        ],
      },
    })),
  };
}

function loaderItems(): BankItem[] {
  const items: BankItem[] = [];
  for (const override of OVERRIDES) {
    for (const place of ['spec', 'block'] as const) {
      const id = `objects/loader/${override.id}/${place}`;
      const sample = override.build(
        (xs) => xs[0] as never,
        () => 0,
        [...CHECK_SET_ITEMS],
      );
      items.push({
        id,
        family: 'objects-loader',
        tier: override.tier,
        level: 3,
        component:
          sample.code === undefined
            ? LOADER
            : sample.code.includes('ORDER') || sample.code.includes('ITEM')
              ? RULES
              : RESOLVE,
        title: `a ${place}-level uses.check_set that ${override.id.replace(/-/g, ' ')} ${sample.code === undefined ? 'loads' : `is refused with ${sample.code}`}`,
        cause:
          sample.code === undefined
            ? 'The loader resolves spec and block uses against the shipped objects.'
            : `The loader's resolve pass refuses ${override.id.replace(/-/g, ' ')} with ${sample.code}.`,
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const { ref, code } = override.build(
            (xs) => pick(rng, xs),
            rng,
            override.id.startsWith('order') ? shippedOrder(product) : [],
          );
          const raw = toolSpec(seed, id, place === 'spec' ? { spec: ref } : { block: ref });
          const result = loadIssues(product, raw);
          if (code === undefined)
            return result.ok
              ? PASS
              : fail(`the loader refused ${JSON.stringify(ref)}: ${list(result.codes)}`);
          return !result.ok && result.codes.includes(code)
            ? PASS
            : fail(
                `the loader answered ${result.ok ? 'ok' : list(result.codes)} on ${JSON.stringify(ref)}, expected ${code}`,
              );
        },
      });
    }
  }
  return items;
}

function memoryCache() {
  const map = new Map<string, unknown>();
  return {
    cacheGet: async (key: string) => map.get(key),
    cachePut: async (key: string, value: unknown) => {
      map.set(key, structuredClone(value));
    },
  };
}

/** `uses` enters the spec hash and no block cache key. */
function hashItems(): BankItem[] {
  const places = [
    { id: 'spec', uses: (ref: unknown) => ({ spec: ref }) },
    { id: 'block', uses: (ref: unknown) => ({ block: ref }) },
    { id: 'both', uses: (ref: unknown) => ({ spec: 'default', block: ref }) },
    { id: 'named-default', uses: () => ({ spec: 'default' }) },
  ];
  return places.map((place) => {
    const id = `objects/hash/${place.id}`;
    return {
      id,
      family: 'objects-loader',
      tier: 3 as Tier,
      level: 3,
      component: LOADER,
      title: `a ${place.id} uses changes the spec hash and leaves every block cache key as it was`,
      cause: 'uses is part of the spec hash and is left out of the block cache key.',
      check: async ({ seed, product }) => {
        const ref = { extends: 'default', items: [{ id: 'lang', enabled: false }] };
        const behave = (turn: { user: string }) =>
          observed('It is free.', [
            {
              label: 'bikes.lookup',
              input: { day: Number(/:(\d+)\]/.exec(turn.user)?.[1] ?? 0) + 1 },
              output: { free: true },
            },
          ]);
        const plain = toolSpec(seed, id, {});
        const tailored = toolSpec(seed, id, place.uses(ref));
        const cache = memoryCache();
        const a = await run(product, plain, scriptedAdapter(product, behave), { cache });
        const b = await run(product, tailored, scriptedAdapter(product, behave), { cache });
        const keysA = a.blocks.map((block) => (block as { cacheKey?: string }).cacheKey);
        const keysB = b.blocks.map((block) => (block as { cacheKey?: string }).cacheKey);
        return expectAll([
          [a.specHash !== b.specHash, 'the spec hash is the same with and without uses'],
          [keysA.every((key) => key !== undefined), 'a block records no cache key'],
          [
            keysA.join(',') === keysB.join(','),
            `uses changed the block cache keys: ${list(keysA, 3)} against ${list(keysB, 3)}`,
          ],
        ]);
      },
    };
  });
}

type CliCase = {
  id: string;
  tier: Tier;
  exit: number;
  /** Writes the project under `dir` and returns the arguments after `object`, and text the output must hold. */
  setup(
    dir: string,
    p: <T>(items: readonly T[]) => T,
    seed: number,
  ): { args: string[]; holds?: RegExp[]; file?: string };
};

const projectObject = (id: string, item: string) => ({
  kind: 'check-set',
  id,
  extends: 'default',
  items: [{ id: item, enabled: false }],
});

/** A project: driftbench.yaml with one inline object, one object file, and a spec whose last block uses it. */
function writeProject(dir: string, p: <T>(items: readonly T[]) => T, seed: number) {
  const objectId = p(['quiet-tools', 'no-accuracy', 'lean-checks']);
  const fileId = p(['strict-order', 'short-set']);
  const item = p(CHECK_SET_ITEMS);
  mkdirSync(join(dir, 'driftbench', 'check-set'), { recursive: true });
  writeFileSync(join(dir, 'driftbench.yaml'), stringify({ objects: [projectObject(objectId, item)] }));
  writeFileSync(
    join(dir, 'driftbench', 'check-set', `${fileId}.yaml`),
    stringify(projectObject(fileId, p(others(item)))),
  );
  const spec = toolSpec(seed, `cli-${objectId}`, { block: objectId });
  const specPath = join(dir, 'spec.yaml');
  writeFileSync(specPath, stringify(spec));
  return { objectId, fileId, item, specPath, last: `b${spec.blocks.length - 1}` };
}

const CLI_CASES: CliCase[] = [
  {
    id: 'list',
    tier: 1,
    exit: 0,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: ['list', 'check-set'],
        holds: [new RegExp(project.objectId), new RegExp(project.fileId), /project/],
      };
    },
  },
  {
    id: 'show-default',
    tier: 1,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      return {
        args: ['show', 'check-set/default'],
        holds: CHECK_SET_ITEMS.map((item) => new RegExp(`\\b${item}\\b`)),
      };
    },
  },
  {
    id: 'show-project',
    tier: 2,
    exit: 0,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: ['show', `check-set/${project.objectId}`],
        holds: [new RegExp(project.item.replace('.', '\\.')), /project/],
      };
    },
  },
  {
    id: 'show-unknown-kind',
    tier: 1,
    exit: 2,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const kind = p(['check-sets', 'checkset', 'policy/valuecheck']);
      return { args: ['show', `${kind}/default`], holds: [new RegExp(escapeRegExp(kind))] };
    },
  },
  {
    id: 'show-unknown-id',
    tier: 1,
    exit: 2,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const id = p(['nothing', 'defaults']);
      return { args: ['show', `check-set/${id}`], holds: [new RegExp(id)] };
    },
  },
  {
    id: 'explain-block',
    tier: 2,
    exit: 0,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: ['explain', 'check-set', '--at', `${project.specPath}#${project.last}`],
        holds: [new RegExp(project.objectId), /project/],
      };
    },
  },
  {
    id: 'explain-set-cli-layer',
    tier: 3,
    exit: 0,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: [
          'explain',
          'policy/value-check',
          '--at',
          `${project.specPath}#b0`,
          '--set',
          `policy/value-check#rung1_outcome.distractors_required=${p(['false', 'true'])}`,
        ],
        holds: [/cli/, /distractors_required/],
      };
    },
  },
  {
    id: 'explain-set-unknown-item',
    tier: 3,
    exit: 1,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: [
          'explain',
          'check-set',
          '--at',
          `${project.specPath}#b0`,
          '--set',
          `check-set#${p(['tool', 'mus', 'R3'])}.limit=2`,
        ],
        holds: [/must_not/],
      };
    },
  },
  {
    id: 'explain-set-unknown-object',
    tier: 3,
    exit: 1,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: [
          'explain',
          'check-set',
          '--at',
          `${project.specPath}#b0`,
          '--set',
          `check-set/${p(['missing', 'ghost'])}#must.limit=2`,
        ],
      };
    },
  },
  {
    id: 'explain-missing-block',
    tier: 2,
    exit: 2,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      const block = p(['b9', 'recap', 'blocks.12']);
      return {
        args: ['explain', 'check-set', '--at', `${project.specPath}#${block}`],
        holds: [new RegExp(escapeRegExp(block))],
      };
    },
  },
  {
    id: 'explain-unresolved',
    tier: 3,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const specPath = join(dir, 'ghost.yaml');
      writeFileSync(specPath, stringify(toolSpec(seed, 'ghost', { block: p(['ghost-set', 'vanished']) })));
      return { args: ['explain', 'check-set', '--at', `${specPath}#b0`] };
    },
  },
  {
    id: 'init-then-validate',
    tier: 2,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const file = join(dir, 'driftbench', 'check-set', `${p(['fresh', 'mine'])}.yaml`);
      return {
        args: ['init', 'check-set', p(['fresh-set', 'my-set']), '--from', 'default', '--out', file],
        file,
      };
    },
  },
  {
    id: 'init-existing',
    tier: 2,
    exit: 2,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: [
          'init',
          'check-set',
          project.fileId,
          '--from',
          'default',
          '--out',
          join(dir, 'driftbench', 'check-set', `${project.fileId}.yaml`),
        ],
        holds: [new RegExp(project.fileId)],
      };
    },
  },
  {
    id: 'validate-project',
    tier: 1,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      return { args: ['validate'] };
    },
  },
  {
    id: 'validate-shipped-redefined',
    tier: 3,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const file = join(dir, 'driftbench', 'check-set', 'default.yaml');
      writeFileSync(file, stringify({ kind: 'check-set', id: 'default', extends: null, items: [] }));
      return { args: ['validate', file], holds: [/immutable/] };
    },
  },
  {
    id: 'validate-unknown-item',
    tier: 2,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const file = join(dir, 'bad.yaml');
      writeFileSync(
        file,
        stringify({
          kind: 'check-set',
          id: 'bad',
          extends: 'default',
          items: [{ id: p(['Must', 'tools.count', 'forbiden']), enabled: false }],
        }),
      );
      return { args: ['validate', file], holds: [/unknown item/] };
    },
  },
  {
    id: 'validate-cycle',
    tier: 4,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const a = p(['ring-a', 'loop-a']);
      const b = p(['ring-b', 'loop-b']);
      writeFileSync(
        join(dir, 'driftbench', 'check-set', `${a}.yaml`),
        stringify({ kind: 'check-set', id: a, extends: b, items: [] }),
      );
      writeFileSync(
        join(dir, 'driftbench', 'check-set', `${b}.yaml`),
        stringify({ kind: 'check-set', id: b, extends: a, items: [] }),
      );
      return { args: ['validate'], holds: [/cycle/] };
    },
  },
  {
    id: 'validate-add-incomplete',
    tier: 3,
    exit: 1,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      const file = join(dir, 'add.yaml');
      writeFileSync(
        file,
        stringify({
          kind: 'check-set',
          id: 'adds',
          extends: 'default',
          items: [{ id: 'extra_check', add: true, title: 'Extra' }],
        }),
      );
      return { args: ['validate', file], holds: [/needs .*when/] };
    },
  },
  {
    id: 'diff-differ',
    tier: 2,
    exit: 1,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return {
        args: ['diff', 'check-set/default', `check-set/${project.objectId}`],
        holds: [new RegExp(project.item.replace('.', '\\.'))],
      };
    },
  },
  {
    id: 'diff-same',
    tier: 1,
    exit: 0,
    setup: (dir, p, seed) => {
      writeProject(dir, p, seed);
      return { args: ['diff', 'check-set/default', 'check-set/default'] };
    },
  },
  {
    id: 'graph',
    tier: 2,
    exit: 0,
    setup: (dir, p, seed) => {
      const project = writeProject(dir, p, seed);
      return { args: ['graph', project.specPath], holds: [new RegExp(project.objectId)] };
    },
  },
];

function cliItems(): BankItem[] {
  return CLI_CASES.map((cliCase) => {
    const id = `objects/cli/${cliCase.id}`;
    return {
      id,
      family: 'objects-cli',
      tier: cliCase.tier,
      level: 3,
      component: cliCase.id.startsWith('explain-set') ? LAYERS : OBJECT_CLI,
      title: `driftbench object ${cliCase.id.replace(/-/g, ' ')} exits ${cliCase.exit} and names what it read`,
      cause: cliCase.id.startsWith('explain-set')
        ? 'The --set preflight resolves the object and refuses an item or object no layer defines.'
        : `driftbench object ${cliCase.id.split('-')[0]} exits as docs/reference/cli.md documents.`,
      check: async ({ seed, scratch, product }) => {
        const rng = rngFor(seed, id);
        const dir = join(scratch, `${id.replace(/\//g, '-')}-${seed}`);
        mkdirSync(dir, { recursive: true });
        const { args, holds, file } = cliCase.setup(dir, (xs) => pick(rng, xs), seed);
        const result = await product.cli(['object', ...args], dir);
        const text = `${result.out}\n${result.err}`;
        if (/unknown command/.test(text))
          return fail(`the command line has no object command: ${text.trim().slice(0, 160)}`);
        const missing = (holds ?? []).filter((pattern) => !pattern.test(text));
        if (result.code !== cliCase.exit)
          return fail(
            `object ${args.join(' ')} exited ${result.code}, expected ${cliCase.exit}: ${text.trim().slice(0, 240)}`,
          );
        if (missing.length > 0)
          return fail(`the output lacks ${list(missing.map(String))}: ${text.trim().slice(0, 240)}`);
        if (file !== undefined) {
          if (!existsSync(file)) return fail(`init wrote no ${file}`);
          const again = await product.cli(['object', 'validate', file], dir);
          if (again.code !== 0) return fail(`validate on the file init wrote exited ${again.code}`);
        }
        return PASS;
      },
    };
  });
}

type Stamp = { object?: string; item?: string; impl?: string; layer?: string };

/** The check a verdict comes from: its `name`, else the first part of its id. */
const checkOf = (verdict: { id: string; name?: string }) =>
  verdict.name ?? verdict.id.split('.')[0] ?? verdict.id;

/**
 * Every verdict names the object, item, implementation and layer that produced it. The blocks run the shipped
 * check set, or a spec-level or block-level object that retitles the `tools` item and disables `forbidden`:
 * the tailored item names that layer and a tailored object, the disabled check gives no verdict, and a block
 * the tailoring does not reach keeps the shipped stamp.
 */
function stampItems(): BankItem[] {
  const items: BankItem[] = [];
  const places = [
    { id: 'shipped', layer: 'shipped', uses: () => ({}) },
    { id: 'spec', layer: 'spec', uses: (ref: unknown) => ({ spec: ref }) },
    { id: 'block', layer: 'block', uses: (ref: unknown) => ({ block: ref }) },
  ];
  const shapes = [
    'count',
    'forbidden-only',
    'two-tools',
    'in-order',
    'extra-call',
    'missing-call',
    'wrong-words',
  ] as const;
  for (const place of places) {
    for (const shape of shapes) {
      const id = `objects/stamps/${place.id}/${shape}`;
      items.push({
        id,
        family: 'objects-stamps',
        tier: (place.id === 'shipped'
          ? 2
          : shape === 'extra-call' || shape === 'missing-call'
            ? 4
            : 3) as Tier,
        level: 3,
        component: STAMPS,
        title: `on ${shape.replace(/-/g, ' ')} blocks scored with the check set of the ${place.id} layer, every verdict names its object as kind:id@hash8, its item, its builtin implementation and the layer that set the item`,
        cause:
          place.id === 'shipped'
            ? 'Every verdict names the object, item, implementation and layer that produced it (Verdict.by).'
            : `Verdict.by names the ${place.layer} layer and the tailored object for an item that ${place.id} uses changes.`,
        check: async ({ seed, product }) => {
          const rng = rngFor(seed, id);
          const title = `Tools as ${pick(rng, SHOP.customers)} sees them`;
          const ref = {
            extends: 'default',
            items: [
              { id: 'tools', title },
              { id: 'forbidden', enabled: false },
            ],
          };
          const raw = toolSpec(seed, id, place.uses(ref));
          const last = raw.blocks.length - 1;
          for (const block of raw.blocks) {
            const expect = block.expect as { tools: Record<string, unknown>[]; tool_order?: string };
            if (shape === 'two-tools' || shape === 'in-order')
              expect.tools.push({ label: 'customer.find', count: 1 });
            if (shape === 'in-order') expect.tool_order = 'in_order';
            if (shape === 'forbidden-only') expect.tools = [{ label: 'payment.charge', count: 0 }];
          }
          const behave = (turn: { user: string }) => {
            const index = Number(/:(\d+)\]/.exec(turn.user)?.[1] ?? 0);
            const lookup = { label: 'bikes.lookup', input: { day: index + 1 }, output: { free: true } };
            const find = { label: 'customer.find', input: {}, output: { id: 7 } };
            if (shape === 'missing-call' && index === last) return observed('It is free.');
            if (shape === 'extra-call' && index === last) return observed('It is free.', [lookup, lookup]);
            if (shape === 'wrong-words' && index === last) return observed('Let me see.', [lookup]);
            return observed(
              'It is free.',
              shape === 'two-tools' || shape === 'in-order' ? [lookup, find] : [lookup],
            );
          };
          const record: RunRecord = await run(product, raw, scriptedAdapter(product, behave));
          const verdicts = record.blocks.flatMap((block, index) =>
            block.verdicts.map((verdict) => ({ index, verdict })),
          );
          if (verdicts.length === 0) return fail('the run holds no verdict');
          const shippedObjects = new Set<string>();
          const tailoredObjects = new Set<string>();
          for (const { index, verdict } of verdicts) {
            const by = verdict.by as Stamp | undefined;
            const check = checkOf(verdict as { id: string; name?: string });
            if (!by) return fail(`the verdict ${verdict.id} of block ${index} names no producer (no by)`);
            const match = /^([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?):([^@]+)@([0-9a-f]{8})$/.exec(
              by.object ?? '',
            );
            if (!match)
              return fail(`the verdict ${verdict.id} names the object "${by.object}", not kind:id@hash8`);
            if (!LAYERS_ENUM.includes(by.layer ?? ''))
              return fail(`the verdict ${verdict.id} names the layer "${by.layer}"`);
            if (!/^(builtin|plugin):\S+$/.test(by.impl ?? ''))
              return fail(`the verdict ${verdict.id} names the impl "${by.impl}"`);
            // A tool input decided by the value policy keeps the policy's stamp; every other verdict, its check-set item.
            if (match[1] !== 'check-set') continue;
            if (by.item !== check)
              return fail(
                `the verdict ${verdict.id} names the item "${by.item}", expected its check ${check}`,
              );
            if (by.impl !== `builtin:check/${check}` && by.impl !== `builtin:runner/${check}`)
              return fail(`the verdict ${verdict.id} names the impl ${by.impl}`);
            const governed = place.id !== 'shipped' && (place.id === 'spec' || index === last);
            if (governed && check === 'forbidden')
              return fail(`block ${index} still gives the disabled forbidden verdict ${verdict.id}`);
            const want = governed && check === 'tools' ? place.layer : 'shipped';
            if (by.layer !== want)
              return fail(
                `the verdict ${verdict.id} of block ${index} names the layer ${by.layer}, expected ${want}`,
              );
            (governed ? tailoredObjects : shippedObjects).add(by.object as string);
          }
          if (
            place.id === 'shipped' &&
            ![...shippedObjects].every((object) => object.startsWith('check-set:default@'))
          )
            return fail(
              `the shipped check set is named ${list([...shippedObjects])}, expected check-set:default@<hash8>`,
            );
          if (place.id !== 'shipped') {
            if (tailoredObjects.size !== 1)
              return fail(
                `the tailored blocks name ${tailoredObjects.size} objects: ${list([...tailoredObjects])}`,
              );
            if (
              [...tailoredObjects].some(
                (object) => shippedObjects.has(object) || object.startsWith('check-set:default@'),
              )
            )
              return fail(`the tailored blocks name the shipped object ${list([...tailoredObjects])}`);
          }
          return PASS;
        },
      });
    }
  }
  return items;
}

/** Level 4 of the blocks bank. */
export function objectItems(): BankItem[] {
  return [...loaderItems(), ...hashItems(), ...cliItems(), ...stampItems()];
}
