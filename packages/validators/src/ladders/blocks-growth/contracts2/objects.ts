import {
  initialize,
  observed,
  type RawSpec,
  type RunRecord,
  run,
  scriptedAdapter,
} from '../../blocks/harness';
import { plantedAgent } from '../../blocks/kinds';
import { need } from '../../blocks/product';
import { recipe } from '../../blocks/recipe';
import {
  type BankItem,
  c2,
  type ItemContext,
  noCommand,
  projectFolder,
  said,
  show,
  type Tier,
  tok,
  unless,
} from './kit';

/**
 * Objects (docs/reference/block-contracts.md, "Objects"): the content hash and what does not enter it, the layers a
 * `uses` key is read from, the message of an unknown reference, item params and a re-enabled item, the command
 * line flags, and what a change to `uses` does to the run id and to a sandboxed code block. Items reach the
 * product through its loader, its runner and its `driftbench object` commands.
 */

const FAMILY = 'c2-objects';
const LEVEL = 3;
const RESOLVE = 'packages/core/src/objects/resolve.ts';
const LAYERS = 'packages/core/src/objects/layers.ts';
const OBJECT_CLI = 'packages/cli/src/commands/object.ts';
const RUNNER = 'packages/core/src/runner/run.ts';
const VALUE = 'policy/value-check';
const BLAME = 'policy/blame';

const objectPath = (kind: string, id: string) => `driftbench/${kind}/${id}.yaml`;

/** A root value-check object of two disabled items, as an author writes one from nothing. */
function rootObject(ctx: ItemContext, tag: string) {
  const id = tok(ctx, tag, 'root', 8);
  const items = [tok(ctx, tag, 'item0', 7), tok(ctx, tag, 'item1', 7)] as const;
  const file = {
    kind: VALUE,
    id,
    items: items.map((item, index) => ({
      id: item,
      title: tok(ctx, tag, `title${index}`, 12),
      enabled: false,
      impl: 'builtin:value-check/exact',
    })),
  };
  return { id, items, file };
}

/** The 8 hex `object list` prints for each object id (columns: kind, id, layer, hash). */
async function listed(ctx: ItemContext, dir: string) {
  const result = await ctx.product.cli(['object', 'list'], dir);
  const rows = new Map<string, string>();
  for (const line of result.out.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols[1] !== undefined && cols[3] !== undefined) rows.set(cols[1], cols[3]);
  }
  return { rows, result };
}

const HEX8 = /^[0-9a-f]{8}$/;

type HashCase = {
  id: string;
  tier: Tier;
  title: string;
  /** The objects of the project beside the root: one that must keep the root hash, one that must move it. */
  build(
    ctx: ItemContext,
    root: ReturnType<typeof rootObject>,
  ): {
    files: Record<string, unknown>;
    config?: Record<string, unknown>;
    same: string;
    moved: string;
    base: string;
  };
};

const HASH_CASES: HashCase[] = [
  {
    id: 'description-stays-out',
    tier: 2,
    title:
      'an object that adds only a description has the hash of its parent, and one that retitles an item moves it',
    build: (ctx, root) => {
      const same = tok(ctx, 'h-desc', 'same', 8);
      const moved = tok(ctx, 'h-desc', 'moved', 8);
      return {
        files: {
          [objectPath(VALUE, root.id)]: root.file,
          [objectPath(VALUE, same)]: {
            kind: VALUE,
            id: same,
            extends: root.id,
            description: `${tok(ctx, 'h-desc', 'w1', 6)} ${tok(ctx, 'h-desc', 'w2', 9)}`,
          },
          [objectPath(VALUE, moved)]: {
            kind: VALUE,
            id: moved,
            extends: root.id,
            items: [{ id: root.items[1], title: tok(ctx, 'h-desc', 'retitle', 13) }],
          },
        },
        same,
        moved,
        base: root.id,
      };
    },
  },
  {
    id: 'version-label-stays-out',
    tier: 2,
    title:
      'an object that adds only a version label has the hash of its parent, and one that retitles an item moves it',
    build: (ctx, root) => {
      const same = tok(ctx, 'h-ver', 'same', 8);
      const moved = tok(ctx, 'h-ver', 'moved', 8);
      return {
        files: {
          [objectPath(VALUE, root.id)]: root.file,
          [objectPath(VALUE, same)]: { kind: VALUE, id: same, extends: root.id, version: 'v7' },
          [objectPath(VALUE, moved)]: {
            kind: VALUE,
            id: moved,
            extends: root.id,
            items: [{ id: root.items[0], title: tok(ctx, 'h-ver', 'retitle', 13) }],
          },
        },
        same,
        moved,
        base: root.id,
      };
    },
  },
  {
    id: 'file-place-stays-out',
    tier: 3,
    title:
      'an object written inline in driftbench.yaml has the hash of the same content written as a file, and a retitled one another',
    build: (ctx, root) => {
      const same = tok(ctx, 'h-place', 'same', 8);
      const moved = tok(ctx, 'h-place', 'moved', 8);
      return {
        files: {
          [objectPath(VALUE, root.id)]: root.file,
          [objectPath(VALUE, moved)]: {
            kind: VALUE,
            id: moved,
            extends: root.id,
            items: [{ id: root.items[1], title: tok(ctx, 'h-place', 'retitle', 13) }],
          },
        },
        config: { objects: [{ kind: VALUE, id: same, extends: root.id }] },
        same,
        moved,
        base: root.id,
      };
    },
  },
  {
    id: 'enabled-flag-enters',
    tier: 3,
    title:
      'two objects of other ids that disable the same item of the shipped default have one hash, and an object that disables nothing has another',
    build: (ctx) => {
      const base = tok(ctx, 'h-flag', 'off-a', 8);
      const same = tok(ctx, 'h-flag', 'off-b', 8);
      const moved = tok(ctx, 'h-flag', 'plain', 8);
      const off = { extends: 'default', items: [{ id: 'rung2b_as_given', enabled: false }] };
      return {
        files: {
          [objectPath(VALUE, base)]: { kind: VALUE, id: base, ...off },
          [objectPath(VALUE, same)]: { kind: VALUE, id: same, ...off },
          [objectPath(VALUE, moved)]: { kind: VALUE, id: moved, extends: 'default' },
        },
        same,
        moved,
        base,
      };
    },
  },
];

function hashItems(): BankItem[] {
  return HASH_CASES.map((hashCase) =>
    c2(
      FAMILY,
      `c2.objects.hash.${hashCase.id}`,
      hashCase.tier,
      LEVEL,
      RESOLVE,
      'hash-content',
      hashCase.title,
      async (ctx) => {
        const root = rootObject(ctx, `hash-${hashCase.id}`);
        const { files, config, same, moved, base } = hashCase.build(ctx, root);
        const dir = projectFolder(ctx, `hash-${hashCase.id}`, files, config ?? {});
        const { rows, result } = await listed(ctx, dir);
        const a = rows.get(base);
        const b = rows.get(same);
        const c = rows.get(moved);
        return [
          noCommand(result),
          unless(result.code === 0, `object list exited ${result.code}: ${said(result).slice(0, 200)}`),
          unless(
            a !== undefined && HEX8.test(a),
            `object list prints no 8 hex hash for ${base}: ${result.out.slice(0, 200)}`,
          ),
          unless(a === b, `${same} should have the hash of ${base}; they list ${b} and ${a}`),
          unless(
            c !== undefined && c !== a,
            `${moved} changes the content, so its hash should move; it lists ${c} beside ${a}`,
          ),
        ];
      },
    ),
  );
}

/** A normal spec whose blocks ask a question the scripted agent answers with a tool call. */
function toolSpec(ctx: ItemContext, tag: string, uses?: unknown): RawSpec {
  return {
    id: `spec-${tok(ctx, tag, 'spec', 8)}`,
    channel: 'chat',
    ...(uses === undefined ? {} : { uses: { check_set: uses } }),
    blocks: [0, 1].map((index) => ({
      id: `b${index}`,
      user: `[${tok(ctx, tag, 'marker', 8)}:${index}] Is the bike free?`,
      expect: { must: ['free'], tools: [{ label: 'bikes.lookup', count: 1 }] },
    })),
  };
}

const answering = (ctx: ItemContext) =>
  scriptedAdapter(ctx.product, () =>
    observed('It is free.', [{ label: 'bikes.lookup', input: { day: 1 }, output: { free: true } }]),
  );

type Resolved = { kind?: string; id?: string; hash?: string };

function recordedHashItem(): BankItem {
  return c2(
    FAMILY,
    'c2.objects.hash.recorded-12-hex',
    3,
    LEVEL,
    RUNNER,
    'hash-recorded-12',
    'a block records the hash of the check set it was scored with as 12 hex characters in BlockResult.resolved, and its verdicts name the object by the first 8 of them',
    async (ctx) => {
      const tailored = { extends: 'default', items: [{ id: 'lang', enabled: false }] };
      const plain: RunRecord = await run(ctx.product, toolSpec(ctx, 'rec-plain'), answering(ctx));
      const tuned: RunRecord = await run(ctx.product, toolSpec(ctx, 'rec-tuned', tailored), answering(ctx));
      const checkSetOf = (record: RunRecord, index: number) => {
        const block = record.blocks[index] as unknown as { resolved?: { objects?: Resolved[] } } | undefined;
        return (block?.resolved?.objects ?? []).find((object) => object.kind === 'check-set');
      };
      const problems: (string | undefined)[] = [];
      const seen: string[] = [];
      for (const [name, record] of [
        ['shipped', plain],
        ['tailored', tuned],
      ] as const) {
        for (const [index, block] of record.blocks.entries()) {
          const entry = checkSetOf(record, index);
          if (!entry || !/^[0-9a-f]{12}$/.test(entry.hash ?? '')) {
            problems.push(
              `block ${index} of the ${name} run should record its check set with a 12 hex hash in resolved.objects; it records ${show((block as unknown as { resolved?: unknown }).resolved)}`,
            );
            continue;
          }
          seen.push(entry.hash as string);
          const want = `check-set:${entry.id}@${(entry.hash as string).slice(0, 8)}`;
          const named = block.verdicts
            .map((verdict) => (verdict.by as { object?: string } | undefined)?.object)
            .filter(
              (object): object is string => typeof object === 'string' && object.startsWith('check-set:'),
            );
          problems.push(
            unless(
              named.length > 0 && named.every((object) => object === want),
              `the verdicts of block ${index} of the ${name} run should name ${want}; they name ${show([...new Set(named)])}`,
            ),
          );
        }
      }
      problems.push(
        unless(
          seen.length === 4 && seen[0] !== seen[2],
          `the shipped and the tailored check sets should record two hashes; they record ${show(seen)}`,
        ),
      );
      return problems;
    },
  );
}

/** The object the explain command resolves, read from its `-> <id>@<hash>` line. */
const resolvedId = (text: string) => /->\s+([^@\s]+)@/.exec(text)?.[1];

const bareSpec = (ctx: ItemContext, tag: string, blocks = 1, uses?: Record<number, unknown>) => ({
  id: tok(ctx, tag, 'spec', 8),
  blocks: Array.from({ length: blocks }, (_, index) => ({
    id: tok(ctx, tag, `b${index}`, 6),
    user: tok(ctx, tag, `u${index}`, 9),
    ...(uses?.[index] !== undefined ? { uses: uses[index] } : {}),
  })),
});

type LayerCase = {
  id: string;
  tier: Tier;
  title: string;
  run(ctx: ItemContext): Promise<ReadonlyArray<string | undefined>>;
};

async function explainAt(ctx: ItemContext, dir: string, kind: string, at: string, extra: string[] = []) {
  const result = await ctx.product.cli(['object', 'explain', kind, '--at', at, ...extra], dir);
  return { result, id: resolvedId(said(result)) };
}

const child = (kind: string, id: string) => ({ kind, id, extends: 'default' });

const LAYER_CASES: LayerCase[] = [
  {
    id: 'project-uses-file',
    tier: 2,
    title:
      'a spec that names no value check takes the one of the project uses.yaml, and with no uses.yaml the shipped default',
    run: async (ctx) => {
      const project = tok(ctx, 'l-project', 'object', 8);
      const spec = bareSpec(ctx, 'l-project');
      const withFile = projectFolder(ctx, 'l-project-a', {
        [objectPath(VALUE, project)]: child(VALUE, project),
        'driftbench/uses.yaml': { value_check: project },
        'specs/one.yaml': spec,
      });
      const without = projectFolder(ctx, 'l-project-b', {
        [objectPath(VALUE, project)]: child(VALUE, project),
        'specs/one.yaml': spec,
      });
      const a = await explainAt(ctx, withFile, VALUE, 'specs/one.yaml');
      const b = await explainAt(ctx, without, VALUE, 'specs/one.yaml');
      return [
        noCommand(a.result),
        unless(
          a.id === project,
          `with driftbench/uses.yaml naming ${project}, explain resolves ${a.id}: ${said(a.result).slice(0, 200)}`,
        ),
        unless(
          b.id === 'default',
          `with no layer naming a value check, explain resolves ${b.id}, not default: ${said(b.result).slice(0, 200)}`,
        ),
      ];
    },
  },
  {
    id: 'suite-over-project',
    tier: 3,
    title: 'a suite uses.yaml beats the project uses.yaml for the specs of its folder only',
    run: async (ctx) => {
      const [project, suite] = ['project', 'suite'].map((slot) => tok(ctx, 'l-suite', slot, 8)) as [
        string,
        string,
      ];
      const dir = projectFolder(ctx, 'l-suite', {
        [objectPath(VALUE, project)]: child(VALUE, project),
        [objectPath(VALUE, suite)]: child(VALUE, suite),
        'driftbench/uses.yaml': { value_check: project },
        'specs/a/_driftbench/uses.yaml': { value_check: suite },
        'specs/a/one.yaml': bareSpec(ctx, 'l-suite-a'),
        'specs/b/two.yaml': bareSpec(ctx, 'l-suite-b'),
      });
      const inSuite = await explainAt(ctx, dir, VALUE, 'specs/a/one.yaml');
      const outside = await explainAt(ctx, dir, VALUE, 'specs/b/two.yaml');
      return [
        noCommand(inSuite.result),
        unless(
          inSuite.id === suite,
          `a spec of the suite folder should take ${suite}; explain resolves ${inSuite.id}`,
        ),
        unless(
          outside.id === project,
          `a spec outside the suite folder should take the project ${project}; explain resolves ${outside.id}`,
        ),
      ];
    },
  },
  {
    id: 'nearer-suite-wins',
    tier: 4,
    title:
      'the suite folder nearer to the spec file wins over a farther one, and a spec beside the farther one takes the farther',
    run: async (ctx) => {
      const [far, near] = ['far', 'near'].map((slot) => tok(ctx, 'l-near', slot, 8)) as [string, string];
      const dir = projectFolder(ctx, 'l-near', {
        [objectPath(VALUE, far)]: child(VALUE, far),
        [objectPath(VALUE, near)]: child(VALUE, near),
        'specs/a/_driftbench/uses.yaml': { value_check: far },
        'specs/a/b/_driftbench/uses.yaml': { value_check: near },
        'specs/a/b/one.yaml': bareSpec(ctx, 'l-near-1'),
        'specs/a/two.yaml': bareSpec(ctx, 'l-near-2'),
      });
      const deep = await explainAt(ctx, dir, VALUE, 'specs/a/b/one.yaml');
      const shallow = await explainAt(ctx, dir, VALUE, 'specs/a/two.yaml');
      return [
        noCommand(deep.result),
        unless(
          deep.id === near,
          `specs/a/b/one.yaml should take the nearer suite object ${near}; explain resolves ${deep.id}`,
        ),
        unless(
          shallow.id === far,
          `specs/a/two.yaml should take its own suite object ${far}; explain resolves ${shallow.id}`,
        ),
      ];
    },
  },
  {
    id: 'block-names-a-blame-policy',
    tier: 3,
    title:
      'a block that names a blame policy uses it, not default, and a block of the same spec that names none uses default',
    run: async (ctx) => {
      const policy = tok(ctx, 'l-blame', 'policy', 8);
      const spec = bareSpec(ctx, 'l-blame', 2, { 1: { blame: policy } });
      const dir = projectFolder(ctx, 'l-blame', {
        [objectPath(BLAME, policy)]: child(BLAME, policy),
        'specs/one.yaml': spec,
      });
      const named = await explainAt(ctx, dir, BLAME, `specs/one.yaml#${spec.blocks[1]?.id}`);
      const plain = await explainAt(ctx, dir, BLAME, `specs/one.yaml#${spec.blocks[0]?.id}`);
      return [
        noCommand(named.result),
        unless(
          named.id === policy,
          `the block that says blame: ${policy} should use it; explain resolves ${named.id}: ${said(named.result).slice(0, 160)}`,
        ),
        unless(
          plain.id === 'default',
          `the block that names no blame policy should use default; explain resolves ${plain.id}`,
        ),
      ];
    },
  },
];

function layerItems(): BankItem[] {
  return LAYER_CASES.map((layerCase) =>
    c2(
      FAMILY,
      `c2.objects.layers.${layerCase.id}`,
      layerCase.tier,
      LEVEL,
      LAYERS,
      'layers-resolve',
      layerCase.title,
      layerCase.run,
    ),
  );
}

type Issue = { path?: string; code?: string; message?: string };

/** The loader's errors for a raw spec, unshuffled: path, code and message each. */
function loaderErrors(ctx: ItemContext, raw: unknown): { ok: boolean; errors: Issue[] } {
  initialize(ctx.product);
  const validateSpec = need<(raw: unknown, path?: string) => { ok?: boolean; errors?: Issue[] }>(
    ctx.product.core,
    'core',
    'validateSpec',
  );
  const result = validateSpec(raw, 'c2:objects');
  return { ok: result.ok === true, errors: result.errors ?? [] };
}

type MessageCase = {
  id: string;
  tier: Tier;
  title: string;
  /** The spec with the unknown reference, its twin with a known one, and what the message must name. */
  build(ctx: ItemContext): { bad: unknown; good: unknown; place: string; id: string; kind: string };
};

const MESSAGE_CASES: MessageCase[] = [
  {
    id: 'block-uses-blame',
    tier: 3,
    title:
      'a block uses key naming a blame policy no layer defines is refused with a message naming blocks.1.uses.blame, the kind, the id, the layers searched and the known ids',
    build: (ctx) => {
      const id = tok(ctx, 'u-block', 'id', 9);
      return {
        bad: bareSpec(ctx, 'u-block', 2, { 1: { blame: id } }),
        good: bareSpec(ctx, 'u-block', 2, { 1: { blame: 'default' } }),
        place: 'blocks.1.uses.blame',
        id,
        kind: BLAME,
      };
    },
  },
  {
    id: 'spec-uses-value-check',
    tier: 3,
    title:
      'a spec uses key naming a value check no layer defines is refused with a message naming uses.value_check, the kind, the id, the layers searched and the known ids',
    build: (ctx) => {
      const id = tok(ctx, 'u-spec', 'id', 9);
      return {
        bad: { ...bareSpec(ctx, 'u-spec', 1), uses: { value_check: id } },
        good: { ...bareSpec(ctx, 'u-spec', 1), uses: { value_check: 'default' } },
        place: 'uses.value_check',
        id,
        kind: VALUE,
      };
    },
  },
  {
    id: 'inline-extends',
    tier: 4,
    title:
      'an inline check set of a block that extends an id no layer defines is refused with a message naming blocks.0.uses.check_set, the kind, the id, the layers searched and the known ids',
    build: (ctx) => {
      const id = tok(ctx, 'u-extends', 'id', 9);
      return {
        bad: bareSpec(ctx, 'u-extends', 1, { 0: { check_set: { extends: id, items: [] } } }),
        good: bareSpec(ctx, 'u-extends', 1, { 0: { check_set: { extends: 'default', items: [] } } }),
        place: 'blocks.0.uses.check_set',
        id,
        kind: 'check-set',
      };
    },
  },
];

function messageItems(): BankItem[] {
  return MESSAGE_CASES.map((messageCase) =>
    c2(
      FAMILY,
      `c2.objects.unknown.${messageCase.id}`,
      messageCase.tier,
      LEVEL,
      RESOLVE,
      'unknown-message',
      messageCase.title,
      async (ctx) => {
        const { bad, good, place, id, kind } = messageCase.build(ctx);
        const refused = loaderErrors(ctx, bad);
        const loaded = loaderErrors(ctx, good);
        const issue = refused.errors.find((each) => each.code === 'OBJECT_UNKNOWN');
        const text = `${issue?.path ?? ''} ${issue?.message ?? ''}`;
        return [
          unless(
            loaded.ok,
            `the twin naming a known object should load; it is refused with ${show(loaded.errors.map((each) => each.code))}`,
          ),
          unless(
            issue !== undefined,
            `the reference to ${id} should be refused with OBJECT_UNKNOWN; the loader answered ${refused.ok ? 'ok' : show(refused.errors.map((each) => each.code))}`,
          ),
          unless(
            text.includes(place),
            `the refusal should name the place ${place}; it reads: ${text.slice(0, 220)}`,
          ),
          unless(
            issue?.message?.includes(id) === true,
            `the message should name the id ${id}: ${text.slice(0, 220)}`,
          ),
          unless(
            issue?.message?.includes(kind) === true,
            `the message should name the kind ${kind}: ${text.slice(0, 220)}`,
          ),
          unless(
            /shipped/.test(issue?.message ?? ''),
            `the message should name the layers it searched, shipped among them: ${text.slice(0, 220)}`,
          ),
          unless(
            /\bdefault\b/.test(issue?.message ?? ''),
            `the message should list the known ids of ${kind}, default among them: ${text.slice(0, 220)}`,
          ),
        ];
      },
    ),
  );
}

const paramsUses = (params: Record<string, unknown>) => ({
  uses: { value_check: { extends: 'default', items: [{ id: 'rung1_outcome', params }] } },
});

function paramItems(): BankItem[] {
  const cases: {
    id: string;
    tier: Tier;
    title: string;
    bad: (ctx: ItemContext) => Record<string, unknown>;
    name: (ctx: ItemContext) => string;
  }[] = [
    {
      id: 'wrong-type',
      tier: 3,
      title:
        'an item param of the wrong type (distractors_required: a word) is refused with OBJECT_PARAMS_INVALID naming its path, and a boolean loads',
      bad: (ctx) => ({ distractors_required: tok(ctx, 'p-type', 'word', 6) }),
      name: () => 'distractors_required',
    },
    {
      id: 'unknown-param',
      tier: 3,
      title:
        'an item param its implementation does not take is refused with OBJECT_PARAMS_INVALID naming its path, and a known one loads',
      bad: (ctx) => ({ [tok(ctx, 'p-unknown', 'param', 9)]: 3 }),
      name: (ctx) => tok(ctx, 'p-unknown', 'param', 9),
    },
  ];
  return cases.map((paramCase) =>
    c2(
      FAMILY,
      `c2.objects.params.${paramCase.id}`,
      paramCase.tier,
      LEVEL,
      RESOLVE,
      'params-invalid',
      paramCase.title,
      async (ctx) => {
        const spec = bareSpec(ctx, `p-${paramCase.id}`, 1);
        const refused = loaderErrors(ctx, { ...spec, ...paramsUses(paramCase.bad(ctx)) });
        const loaded = loaderErrors(ctx, { ...spec, ...paramsUses({ distractors_required: true }) });
        const issue = refused.errors.find((each) => each.code === 'OBJECT_PARAMS_INVALID');
        const text = `${issue?.path ?? ''} ${issue?.message ?? ''}`;
        return [
          unless(
            loaded.ok,
            `distractors_required: true should load; the loader refused it with ${show(loaded.errors.map((each) => each.code))}`,
          ),
          unless(
            issue !== undefined,
            `the params should be refused with OBJECT_PARAMS_INVALID; the loader answered ${refused.ok ? 'ok' : show(refused.errors.map((each) => each.code))}`,
          ),
          unless(
            text.includes(paramCase.name(ctx)),
            `the refusal should name the path of ${paramCase.name(ctx)}: ${text.slice(0, 220)}`,
          ),
        ];
      },
    ),
  );
}

function reenableItem(): BankItem {
  return c2(
    FAMILY,
    'c2.objects.items.reenabled-item-is-checked',
    4,
    LEVEL,
    RESOLVE,
    'impl-needed',
    'a disabled item with an implementation nothing provides loads, and an object that enables it again is refused for that implementation',
    async (ctx) => {
      const root = tok(ctx, 'reenable', 'root', 8);
      const again = tok(ctx, 'reenable', 'again', 8);
      const item = tok(ctx, 'reenable', 'item', 7);
      const rootFile = {
        kind: VALUE,
        id: root,
        items: [
          {
            id: item,
            title: tok(ctx, 'reenable', 'title', 11),
            enabled: false,
            impl: `plugin:${tok(ctx, 'reenable', 'impl', 9)}`,
            when: {},
            effect: { settles: ['pass', 'fail'] },
          },
        ],
      };
      const alone = await ctx.product.cli(
        ['object', 'validate'],
        projectFolder(ctx, 'reenable-a', { [objectPath(VALUE, root)]: rootFile }),
      );
      const enabled = await ctx.product.cli(
        ['object', 'validate'],
        projectFolder(ctx, 'reenable-b', {
          [objectPath(VALUE, root)]: rootFile,
          [objectPath(VALUE, again)]: {
            kind: VALUE,
            id: again,
            extends: root,
            items: [{ id: item, enabled: true }],
          },
        }),
      );
      return [
        noCommand(alone),
        unless(
          alone.code === 0,
          `the disabled item should validate (exit 0); validate exited ${alone.code}: ${said(alone).slice(0, 200)}`,
        ),
        unless(
          enabled.code === 1 && /OBJECT_IMPL_UNKNOWN|no builtin or plugin provides/i.test(said(enabled)),
          `the object that enables it again should be refused for its implementation (exit 1); validate exited ${enabled.code}: ${said(enabled).slice(0, 200)}`,
        ),
      ];
    },
  );
}

type FlagCase = {
  id: string;
  tier: Tier;
  title: string;
  /** The refused flags (each set alone must be refused), and the twin that loads. */
  bad(ctx: ItemContext): string[][];
  good: string[];
};

const FLAG_CASES: FlagCase[] = [
  {
    id: 'use-kind-twice',
    tier: 2,
    title: '--use naming the value check twice is refused with OBJECT_INVALID, and naming it once explains',
    bad: () => [['--use', `${VALUE}/default`, '--use', `${VALUE}/default`]],
    good: ['--use', `${VALUE}/default`],
  },
  {
    id: 'use-unknown-kind',
    tier: 2,
    title:
      '--use with a kind driftbench does not know is refused with OBJECT_INVALID, and a known kind explains',
    bad: (ctx) => [['--use', `${tok(ctx, 'f-use', 'kind', 8)}/default`]],
    good: ['--use', `${VALUE}/default`],
  },
  {
    id: 'set-without-item-param',
    tier: 3,
    title: '--set with no #<item>.<param>=<value> is refused with OBJECT_INVALID, and a whole flag explains',
    bad: () => [
      ['--set', VALUE],
      ['--set', `${VALUE}#rung1_outcome`],
      ['--set', `${VALUE}#rung1_outcome.distractors_required`],
    ],
    good: ['--set', `${VALUE}#rung1_outcome.distractors_required=true`],
  },
  {
    id: 'set-unknown-kind',
    tier: 2,
    title:
      '--set with a kind driftbench does not know is refused with OBJECT_INVALID, and a known kind explains',
    bad: (ctx) => [['--set', `${tok(ctx, 'f-set', 'kind', 8)}#rung1_outcome.distractors_required=true`]],
    good: ['--set', `${VALUE}#rung1_outcome.distractors_required=true`],
  },
];

function flagItems(): BankItem[] {
  return FLAG_CASES.map((flagCase) =>
    c2(
      FAMILY,
      `c2.objects.cli.${flagCase.id}`,
      flagCase.tier,
      LEVEL,
      LAYERS,
      'cli-flag-invalid',
      flagCase.title,
      async (ctx) => {
        const spec = bareSpec(ctx, `f-${flagCase.id}`, 1);
        const dir = projectFolder(ctx, `f-${flagCase.id}`, { 'specs/one.yaml': spec });
        const at = `specs/one.yaml#${spec.blocks[0]?.id}`;
        const good = await explainAt(ctx, dir, VALUE, at, flagCase.good);
        const problems: (string | undefined)[] = [
          noCommand(good.result),
          unless(
            good.result.code === 0,
            `explain ${flagCase.good.join(' ')} should exit 0; it exited ${good.result.code}: ${said(good.result).slice(0, 200)}`,
          ),
        ];
        for (const flags of flagCase.bad(ctx)) {
          const bad = await explainAt(ctx, dir, VALUE, at, flags);
          problems.push(
            unless(
              bad.result.code !== 0 && /OBJECT_INVALID/.test(said(bad.result)),
              `explain ${flags.join(' ')} should be refused with OBJECT_INVALID; it exited ${bad.result.code}: ${said(bad.result).slice(0, 200)}`,
            ),
          );
        }
        return problems;
      },
    ),
  );
}

function exitItems(): BankItem[] {
  return [
    c2(
      FAMILY,
      'c2.objects.cli.list-unknown-kind-exits-2',
      2,
      LEVEL,
      OBJECT_CLI,
      'cli-list-exit',
      'driftbench object list of a kind driftbench does not know exits 2 and names it, and list of a known kind exits 0',
      async (ctx) => {
        const dir = projectFolder(ctx, 'x-list', {});
        const kind = tok(ctx, 'x-list', 'kind', 8);
        const bad = await ctx.product.cli(['object', 'list', kind], dir);
        const good = await ctx.product.cli(['object', 'list', VALUE], dir);
        return [
          noCommand(good),
          unless(
            good.code === 0,
            `object list ${VALUE} should exit 0; it exited ${good.code}: ${said(good).slice(0, 160)}`,
          ),
          unless(
            bad.code === 2 && said(bad).includes(kind),
            `object list ${kind} should exit 2 naming the kind; it exited ${bad.code}: ${said(bad).slice(0, 160)}`,
          ),
        ];
      },
    ),
    c2(
      FAMILY,
      'c2.objects.cli.explain-unknown-kind-exits-2',
      2,
      LEVEL,
      OBJECT_CLI,
      'cli-explain-exit',
      'driftbench object explain of a kind driftbench does not know exits 2, and explain of a known kind exits 0',
      async (ctx) => {
        const spec = bareSpec(ctx, 'x-explain', 1);
        const dir = projectFolder(ctx, 'x-explain', { 'specs/one.yaml': spec });
        const kind = tok(ctx, 'x-explain', 'kind', 8);
        const bad = await explainAt(ctx, dir, kind, 'specs/one.yaml');
        const good = await explainAt(ctx, dir, VALUE, 'specs/one.yaml');
        return [
          noCommand(good.result),
          unless(
            good.result.code === 0,
            `explain ${VALUE} should exit 0; it exited ${good.result.code}: ${said(good.result).slice(0, 160)}`,
          ),
          unless(
            bad.result.code === 2,
            `explain ${kind} should exit 2; it exited ${bad.result.code}: ${said(bad.result).slice(0, 160)}`,
          ),
        ];
      },
    ),
  ];
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

function usesItems(): BankItem[] {
  return [
    c2(
      FAMILY,
      'c2.objects.uses.another-run-id',
      2,
      LEVEL,
      RUNNER,
      'uses-hash',
      'a change to uses gives another spec hash and another run id, and the same uses twice gives the same spec hash',
      async (ctx) => {
        const tailored = { extends: 'default', items: [{ id: 'lang', enabled: false }] };
        const plain = await run(ctx.product, toolSpec(ctx, 'run-id'), answering(ctx));
        const tuned = await run(ctx.product, toolSpec(ctx, 'run-id', tailored), answering(ctx));
        const again = await run(ctx.product, toolSpec(ctx, 'run-id', tailored), answering(ctx));
        return [
          unless(plain.specHash !== tuned.specHash, 'a change to uses left the spec hash as it was'),
          unless(
            typeof plain.runId === 'string' && typeof tuned.runId === 'string' && plain.runId !== tuned.runId,
            `a change to uses should give another run id; the runs name ${show(plain.runId)} and ${show(tuned.runId)}`,
          ),
          unless(
            tuned.specHash === again.specHash,
            `the same uses twice gave two spec hashes: ${tuned.specHash}, ${again.specHash}`,
          ),
        ];
      },
    ),
    c2(
      FAMILY,
      'c2.objects.uses.sandboxed-code-block-reruns',
      4,
      LEVEL,
      'packages/core/src/runner/cache.ts',
      'uses-sandbox-reruns',
      'a change to uses runs the agent of a sandboxed code block again from the same cache, while a normal block is re-scored from it',
      async (ctx) => {
        const problems: (string | undefined)[] = [];
        for (const kind of ['code', 'normal'] as const) {
          const r = recipe(ctx.seed, `c2.uses.${kind}`, kind, [{ fate: 'pass' }, { fate: 'pass' }]);
          const cache = memoryCache();
          const off = kind === 'code' ? 'skills' : 'lang';
          const tuned: RawSpec = {
            ...structuredClone(r.raw),
            uses: { check_set: { extends: 'default', items: [{ id: off, enabled: false }] } },
          };
          const first = plantedAgent(ctx.product, kind, r.actions, { scratch: ctx.scratch });
          await run(ctx.product, r.raw, first.adapter, { cache });
          const second = plantedAgent(ctx.product, kind, r.actions, { scratch: ctx.scratch });
          await run(ctx.product, tuned, second.adapter, { cache });
          const calls = second.delivered().length;
          problems.push(
            kind === 'code'
              ? unless(
                  calls === r.raw.blocks.length,
                  `the sandboxed code blocks should run again after the uses change; the agent was sent ${calls} of ${r.raw.blocks.length} blocks`,
                )
              : unless(
                  calls === 0,
                  `a normal block the cache holds should be re-scored, not rerun; the agent was sent ${calls} blocks`,
                ),
          );
        }
        return problems;
      },
    ),
  ];
}

function afterMoveItem(): BankItem {
  return c2(
    FAMILY,
    'c2.objects.moves.after-moves-one-item',
    3,
    LEVEL,
    RESOLVE,
    'move-after',
    "a spec check set that moves the earlier of tools and must after the later one makes its verdicts come after the later one's on every block, and the shipped order keeps them before",
    async (ctx) => {
      const set = need<{ items?: { id: string }[]; order?: string[] }>(
        ctx.product.checks,
        'checks',
        'DEFAULT_CHECK_SET',
      );
      const order = set.order ?? (set.items ?? []).map((each) => each.id);
      const [early, late] =
        order.indexOf('tools') < order.indexOf('must') ? ['tools', 'must'] : ['must', 'tools'];
      const first = (record: RunRecord, index: number, check: string) =>
        (record.blocks[index]?.verdicts ?? []).findIndex((verdict) => verdict.id.split('.')[0] === check);
      const plain = await run(ctx.product, toolSpec(ctx, 'after-plain'), answering(ctx));
      const moved = await run(
        ctx.product,
        toolSpec(ctx, 'after-moved', { extends: 'default', items: [{ id: early, after: late }] }),
        answering(ctx),
      );
      const problems: (string | undefined)[] = [
        unless(
          order.includes('tools') && order.includes('must'),
          `the shipped check set lists ${show(order)}, without tools and must`,
        ),
      ];
      for (const index of [0, 1]) {
        const [pe, pl, me, ml] = [
          first(plain, index, early),
          first(plain, index, late),
          first(moved, index, early),
          first(moved, index, late),
        ];
        problems.push(
          unless(
            pe >= 0 && pl >= 0 && pe < pl,
            `in the shipped order ${early} comes before ${late} on block ${index}; the verdicts sit at ${pe} and ${pl}`,
          ),
          unless(
            me >= 0 && ml >= 0 && me > ml,
            `moved after ${late}, ${early} should come after it on block ${index}; the verdicts sit at ${me} and ${ml}`,
          ),
        );
      }
      return problems;
    },
  );
}

/** The items of the Objects sections. */
export function objectsItems(): BankItem[] {
  return [
    ...hashItems(),
    recordedHashItem(),
    afterMoveItem(),
    ...layerItems(),
    ...messageItems(),
    ...paramItems(),
    reenableItem(),
    ...flagItems(),
    ...exitItems(),
    ...usesItems(),
  ];
}
