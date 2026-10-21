import { between, canonical, load, loadIssues, type RawSpec, rngFor, type Turn } from '../../blocks/harness';
import { type Action, type FileAction, plantedAgent } from '../../blocks/kinds';
import { need, patched } from '../../blocks/product';
import { type BlockDef, play, playP, type RunRecord, runLoaded, scenario } from '../../blocks-breaker/kit';
import { exec } from '../checks/kit';
import { type BankItem, CORE, type ItemContext, pitem, SANDBOX, show, tok } from './kit';

/**
 * plantedbugs.round2: the documented behaviours that the round-2 planted bugs broke while every item of the bank
 * stayed green (scratchpad/blocks-audit-bugs/NOTES.md, "Round 2"). Written blind from the docs and the one-line
 * behaviour of each bug.
 *
 * - The workspace check compares paths in one form in all three sets of the diff (docs/reference/checks.md
 *   "Workspace"): a changed path the adapter reports as `./d/f.txt` or `d\f.txt` is the listed `d/f.txt`.
 * - A world-only perturbation runs under block inject_at with its own world (docs/concepts/recovery.md "Writing a
 *   perturbation"): where the block's given world and the perturbation's world write the same key, the agent sees
 *   the perturbation's value.
 * - COUNT_RANGE_INVALID is a count whose min is greater than its max (docs/reference/cli.md "Issue codes"): one
 *   above is already greater, and an equal min and max is a valid range.
 * - A thousands grouping in `exact` is strict (docs/reference/checks.md "Text and language"): a leading group of
 *   four digits is no grouping, so its comma counts.
 * - A snapshot stops past 32 folder levels (docs/adapters/process.md "Sandboxes"): a workspace exactly 32 levels
 *   deep is within the bounds.
 * - A snapshot stops past its byte bound (docs/adapters/process.md "Sandboxes": 1 GiB hashed by default): a workspace of
 *   exactly the bound is within it. The item sets a small bound on the local provider (`limits.maxBytes`).
 * - An export fails only when the files pass `exportMaxBytes` (docs/reference/block-contracts.md "The workspace of a
 *   child"): a parent's workspace of exactly that size exports.
 *
 * Each item is a twin: the shape that passes beside the shape that fails, on seeded names and values.
 */

const CHECKS = 'packages/checks';

type VerdictRow = { id: string; outcome: string; gating?: boolean };
const outcomeIn = (rec: RunRecord, block: number, id: string): string =>
  ((rec.blocks[block]?.verdicts ?? []) as VerdictRow[]).find((each) => each.id === id)?.outcome ?? 'none';

/* ---------------------------------------------------------------------------------------------------------
 * the workspace check reads the changed set of the diff in one form
 * ------------------------------------------------------------------------------------------------------- */

type Form = { id: string; title: string; write: (path: string, ctx: ItemContext, tag: string) => string };

const FORMS: readonly Form[] = [
  {
    id: 'dot-slash',
    title: 'after leading ./ segments',
    write: (path, ctx, tag) => `${'./'.repeat(between(rngFor(ctx.seed, `pb:${tag}:dots`), 1, 2))}${path}`,
  },
  { id: 'backslash', title: 'with backslashes', write: (path) => path.replaceAll('/', '\\') },
  {
    id: 'dot-backslash',
    title: 'after .\\ with backslashes',
    write: (path) => `.\\${path.replaceAll('/', '\\')}`,
  },
];

function workspaceFormItems(): BankItem[] {
  return FORMS.map((form) =>
    pitem(
      `pb.workspace-form.changed.${form.id}`,
      3,
      1,
      CHECKS,
      'workspace-one-form',
      `a changed path the diff reports ${form.title} is the same path as the list writes it plainly: changed naming it and others_untouched pass, changed naming another file fails, and an unnamed changed file still fails others_untouched`,
      async (ctx) => {
        const tag = `workspace-form.${form.id}`;
        const w = (slot: string) => tok(ctx, tag, slot, 7);
        const path = `${w('d')}/${w('e')}/${w('f')}.txt`;
        const other = `${w('d')}/${w('g')}.txt`;
        const reported = form.write(path, ctx, tag);
        const diff = (changed: string[]) => ({ workspaceDiff: { created: [], changed, deleted: [] } });
        const rec = await exec(ctx, `pb:${tag}`, [
          { extra: diff([reported]), expect: { workspace: { changed: [path] } } },
          { extra: diff([reported]), expect: { workspace: { changed: [other] } } },
          { extra: diff([reported]), expect: { workspace: { changed: [path], others_untouched: true } } },
          {
            extra: diff([reported, other]),
            expect: { workspace: { changed: [path], others_untouched: true } },
          },
          { extra: diff([path]), expect: { workspace: { changed: [form.write(path, ctx, tag)] } } },
        ]);
        const want: [number, string, string][] = [
          [0, 'workspace.changed', 'pass'],
          [1, 'workspace.changed', 'fail'],
          [2, 'workspace.changed', 'pass'],
          [2, 'workspace.others_untouched', 'pass'],
          [3, 'workspace.others_untouched', 'fail'],
          [4, 'workspace.changed', 'pass'],
        ];
        return want.map(
          ([block, id, outcome]) =>
            outcomeIn(rec, block, id) !== outcome &&
            `block ${block}, whose diff reports changed ${show((rec.blocks[block]?.observed as { workspaceDiff?: unknown })?.workspaceDiff)}: ${id} should ${outcome}; it is ${outcomeIn(rec, block, id)} (run ${rec.status})`,
        );
      },
    ),
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * the world of a world-only perturbation wins over the block's own given world
 * ------------------------------------------------------------------------------------------------------- */

type Part = 'tools' | 'store' | 'fixtures';
const PARTS: readonly Part[] = ['tools', 'store', 'fixtures'];

function perturbationWorldItems(): BankItem[] {
  return PARTS.map((part) =>
    pitem(
      `pb.perturbation-world.over-block-given.${part}`,
      3,
      2,
      CORE,
      'perturbation-world-wins',
      `a world-only perturbation and the block it runs under both write one key of world.${part}: in mode P the agent sees the perturbation's value there, from that block on, beside the spec's own key; in mode F it sees the block's own value`,
      async (ctx) => {
        const tag = `perturbation-world.${part}`;
        const rng = rngFor(ctx.seed, `pb:${tag}:shape`);
        const blocks = between(rng, 2, 4);
        const at = between(rng, 0, blocks - 1);
        const key = tok(ctx, tag, 'key', 8);
        const kept = tok(ctx, tag, 'kept', 8);
        const later = at + 1 < blocks ? at + 1 : undefined;
        const value = (slot: string) => {
          const word = tok(ctx, tag, slot, 9);
          return part === 'tools' ? { result: { code: word } } : { code: word };
        };
        const own = value('own');
        const perturbed = value('perturbed');
        const beside = value('beside');
        const defs: BlockDef[] = Array.from({ length: blocks }, (_, index) => ({
          plan: { text: 'Done.' },
          ...(index === at ? { given: { world: { [part]: { [key]: own } } } } : {}),
        }));
        const pid = tok(ctx, tag, 'pid', 7);
        const sc = scenario(ctx.seed, `pb:${tag}`, defs, {
          given: { world: { [part]: { [kept]: beside } } },
          perturbations: [
            {
              id: pid,
              class: 'D8_tool_failure',
              inject_at: at,
              world: { [part]: { [key]: perturbed } },
              recovery: { within_blocks: 1 },
            },
          ],
        });
        const turnAt = (turns: readonly Turn[], block = at) =>
          turns.find((turn) => turn.user.includes(sc.users[block] as string));
        const read = (turn: Turn | undefined, name: string) =>
          (turn?.world?.[part] as Record<string, unknown> | undefined)?.[name];
        const p = await playP(ctx, sc, pid);
        const f = await play(ctx, sc);
        const pTurn = turnAt(p.log.turns);
        const fTurn = turnAt(f.log.turns);
        return [
          !pTurn && `block ${at} should reach the agent in mode P; the run is ${p.rec.status}`,
          pTurn &&
            canonical(read(pTurn, key)) !== canonical(perturbed) &&
            `in mode P block ${at} runs with the perturbation's world: world.${part}.${key} should be ${show(perturbed)}; the agent saw ${show(read(pTurn, key))}`,
          pTurn &&
            canonical(read(pTurn, kept)) !== canonical(beside) &&
            `the perturbation's world merges by name: world.${part}.${kept}, which only the spec's given writes, should be ${show(beside)}; the agent saw ${show(read(pTurn, kept))}`,
          later !== undefined &&
            canonical(read(turnAt(p.log.turns, later), key)) !== canonical(perturbed) &&
            `the perturbation's world holds from that point: in mode P block ${later} should still see world.${part}.${key} as ${show(perturbed)}; the agent saw ${show(read(turnAt(p.log.turns, later), key))}`,
          !fTurn && `block ${at} should reach the agent in mode F; the run is ${f.rec.status}`,
          fTurn &&
            canonical(read(fTurn, key)) !== canonical(own) &&
            `in mode F block ${at} runs with its own given: world.${part}.${key} should be ${show(own)}; the agent saw ${show(read(fTurn, key))}`,
        ];
      },
    ),
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * COUNT_RANGE_INVALID: a min one above the max is already greater
 * ------------------------------------------------------------------------------------------------------- */

const COUNTED: readonly { field: string; name: string }[] = [
  { field: 'tools', name: 'label' },
  { field: 'cards', name: 'name' },
  { field: 'skills', name: 'name' },
  { field: 'guards', name: 'name' },
  { field: 'references', name: 'path' },
  { field: 'subagents', name: 'name' },
];

function countRangeItems(): BankItem[] {
  return COUNTED.map(({ field, name }) =>
    pitem(
      `pb.count-range.${field}`,
      2,
      1,
      CORE,
      'count-range-invalid',
      `a count in expect.${field} whose min is one above its max is COUNT_RANGE_INVALID, as is one further above, while a min equal to the max loads`,
      async (ctx) => {
        const tag = `count-range.${field}`;
        const rng = rngFor(ctx.seed, `pb:${tag}:bounds`);
        const max = between(rng, 0, 6);
        const spec = (count: { min: number; max: number }, slot: string): RawSpec => ({
          id: tok(ctx, tag, `spec:${slot}`, 9),
          blocks: [
            {
              id: tok(ctx, tag, `block:${slot}`, 6),
              user: tok(ctx, tag, `user:${slot}`, 9),
              expect: { [field]: [{ [name]: tok(ctx, tag, 'name', 8), count }] },
            },
          ],
        });
        const shapes: [string, { min: number; max: number }, boolean][] = [
          ['equal', { min: max, max }, false],
          ['one-above', { min: max + 1, max }, true],
          ['further', { min: max + 1 + between(rng, 1, 4), max }, true],
        ];
        return shapes.map(([slot, count, invalid]) => {
          const issues = loadIssues(ctx.product, spec(count, slot));
          const has = issues.codes.includes('COUNT_RANGE_INVALID');
          if (invalid)
            return (
              !has &&
              `a count ${show(count)} in expect.${field} has a min greater than its max: the loader should report COUNT_RANGE_INVALID; it reported ${show(issues.codes)}`
            );
          return (
            !issues.ok &&
            `a count ${show(count)} in expect.${field}, min equal to max, is a valid range: the spec should load; the loader reported ${show(issues.codes)}`
          );
        });
      },
    ),
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * exact: a leading group of four digits is no thousands grouping
 * ------------------------------------------------------------------------------------------------------- */

function exactGroupingItems(): BankItem[] {
  return (['reply', 'reference'] as const).map((side) =>
    pitem(
      `pb.exact.four-digit-lead.${side}`,
      3,
      1,
      CHECKS,
      'exact-strict-grouping',
      `in exact, a ${side} that writes a comma after a leading group of four digits keeps that comma: it does not equal the digits run together, while a leading group of one to three digits is a thousands grouping and does`,
      async (ctx) => {
        const tag = `exact.four-digit-lead.${side}`;
        const rng = rngFor(ctx.seed, `pb:${tag}:digits`);
        const four = String(between(rng, 1000, 9999));
        const short = String(between(rng, 1, 999));
        const group = () => String(between(rng, 0, 999)).padStart(3, '0');
        const [g1, g2] = [group(), group()];
        const label = tok(ctx, tag, 'label', 7);
        type Case = [grouped: string, plain: string, pass: boolean];
        const cases: Case[] = [
          [`${label} ${four},${g1}`, `${label} ${four}${g1}`, false],
          [`${label} ${four},${g1},${g2}`, `${label} ${four}${g1}${g2}`, false],
          [`${label} ${four},${g1}`, `${label} ${four},${g1}`, true],
          [`${label} ${short},${g1}`, `${label} ${short}${g1}`, true],
          [`${label} ${short},${g1},${g2}`, `${label} ${short}${g1}${g2}`, true],
        ];
        const rows = cases.map(([grouped, plain]) =>
          side === 'reply'
            ? { text: grouped, expect: { exact: plain } }
            : { text: plain, expect: { exact: grouped } },
        );
        const rec = await exec(ctx, `pb:${tag}`, rows);
        return cases.map(([grouped, plain, pass], index) => {
          const [reply, reference] = side === 'reply' ? [grouped, plain] : [plain, grouped];
          const got = outcomeIn(rec, index, 'exact.0');
          const want = pass ? 'pass' : 'fail';
          return (
            got !== want && `the reply "${reply}" against exact "${reference}" should ${want}; it is ${got}`
          );
        });
      },
    ),
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * the sandbox bounds: 32 folder levels, and the export bound, are within
 * ------------------------------------------------------------------------------------------------------- */

const LEVELS = 32;

/** A path `levels` folders deep, seeded folder names, ending in a file. */
const deepPath = (ctx: ItemContext, tag: string, levels: number): string =>
  `${Array.from({ length: levels }, (_, index) => tok(ctx, tag, `level${index}`, 3)).join('/')}/${tok(ctx, tag, 'leaf', 7)}.txt`;

async function oneBlockCode(
  ctx: ItemContext,
  tag: string,
  files: FileAction[],
  expect: Record<string, unknown>,
) {
  const marker = tok(ctx, tag, 'marker', 9);
  const raw: RawSpec = {
    id: tok(ctx, tag, 'spec', 9),
    kind: 'task',
    blocks: [{ id: tok(ctx, tag, 'block', 6), user: marker, expect }],
  };
  const agent = plantedAgent(
    ctx.product,
    'code',
    new Map<string, Action>([[marker, { reply: 'Done.', files }]]),
    {
      scratch: ctx.scratch,
    },
  );
  return runLoaded(ctx.product, load(ctx.product, raw), agent.adapter);
}

function depthItems(): BankItem[] {
  return [
    pitem(
      'pb.snapshot-depth.at-the-bound',
      3,
      2,
      SANDBOX,
      'snapshot-depth-bound',
      `a file the agent writes ${LEVELS} folder levels deep is within the snapshot's bounds: the run completes and the file is created; one level deeper the agent left a workspace past the bounds and the run fails`,
      async (ctx) => {
        const runAt = async (levels: number) => {
          const tag = `snapshot-depth.${levels}`;
          const path = deepPath(ctx, tag, levels);
          const rec = await oneBlockCode(
            ctx,
            tag,
            [{ path, format: 'txt', data: `${tok(ctx, tag, 'line', 9)}\n` }],
            {
              workspace: { created: [path] },
            },
          );
          return { path, rec };
        };
        const at = await runAt(LEVELS);
        const below = await runAt(LEVELS - 1);
        const past = await runAt(LEVELS + 1);
        return [
          at.rec.status !== 'completed' &&
            `a workspace ${LEVELS} folder levels deep is within the bounds: the run should complete; it is ${at.rec.status} ${show(at.rec.error ?? '')}`,
          at.rec.status === 'completed' &&
            outcomeIn(at.rec, 0, 'workspace.created') !== 'pass' &&
            `workspace.created naming the file ${LEVELS} levels deep should pass; it is ${outcomeIn(at.rec, 0, 'workspace.created')}`,
          below.rec.status !== 'completed' &&
            `a workspace ${LEVELS - 1} folder levels deep is within the bounds: the run should complete; it is ${below.rec.status}`,
          past.rec.status !== 'failed' &&
            `a workspace ${LEVELS + 1} folder levels deep is past the bounds: the run should fail; it is ${past.rec.status}`,
        ];
      },
    ),
  ];
}

/**
 * The product with a byte bound of `maxBytes` on every local sandbox's snapshot, so the bound is reachable with a
 * workspace of a few kilobytes (the lead's ruling: a small bound, never a huge workspace). The local provider takes
 * it as `limits.maxBytes`.
 */
function withByteBound(product: ItemContext['product'], maxBytes: number): ItemContext['product'] {
  const localProvider = need<(options: Record<string, unknown>) => unknown>(
    product.sandbox,
    'sandbox',
    'localProvider',
  );
  return patched(product, {
    name: product.name,
    sandbox: {
      localProvider: (options: Record<string, unknown>) =>
        localProvider({ ...options, limits: { ...((options.limits as object) ?? {}), maxBytes } }),
    },
  });
}

function byteBoundItems(): BankItem[] {
  return [
    pitem(
      'pb.snapshot-bytes.at-the-bound',
      3,
      2,
      SANDBOX,
      'snapshot-bytes-bound',
      "a workspace of exactly the snapshot's byte bound is within it: the run completes and the files are created; one byte below completes too, and one byte past it the agent left a workspace past the bounds and the run fails",
      async (ctx) => {
        const tag = 'snapshot-bytes';
        const rng = rngFor(ctx.seed, `pb:${tag}:size`);
        const bound = between(rng, 600, 4000);
        const product = withByteBound(ctx.product, bound);
        const runAt = async (total: number, slot: string) => {
          const w = (name: string) => tok(ctx, `${tag}:${slot}`, name, 7);
          const first = between(rng, 1, total - 1);
          const paths = [`${w('d')}/${w('a')}.txt`, `${w('b')}.txt`];
          const files: FileAction[] = [
            { path: paths[0] as string, format: 'txt', data: 'a'.repeat(first) },
            { path: paths[1] as string, format: 'txt', data: 'b'.repeat(total - first) },
          ];
          const marker = tok(ctx, `${tag}:${slot}`, 'marker', 9);
          const raw: RawSpec = {
            id: tok(ctx, `${tag}:${slot}`, 'spec', 9),
            kind: 'task',
            blocks: [
              {
                id: tok(ctx, `${tag}:${slot}`, 'block', 6),
                user: marker,
                expect: { workspace: { created: paths } },
              },
            ],
          };
          // The agent removes the history file the adapter hands it, so the workspace holds its own files alone.
          const action: Action = { reply: 'Done.', files, deletes: ['driftbench-history.json'] };
          const agent = plantedAgent(product, 'code', new Map([[marker, action]]), { scratch: ctx.scratch });
          return runLoaded(product, load(product, raw), agent.adapter);
        };
        const at = await runAt(bound, 'at');
        const below = await runAt(bound - 1, 'below');
        const past = await runAt(bound + 1, 'past');
        return [
          at.status !== 'completed' &&
            `a workspace of exactly the byte bound (${bound} bytes) is within the bounds: the run should complete; it is ${at.status} ${show(at.error ?? '')}`,
          at.status === 'completed' &&
            outcomeIn(at, 0, 'workspace.created') !== 'pass' &&
            `workspace.created naming the files of exactly ${bound} bytes should pass; it is ${outcomeIn(at, 0, 'workspace.created')}`,
          below.status !== 'completed' &&
            `a workspace one byte under the bound is within the bounds: the run should complete; it is ${below.status}`,
          past.status !== 'failed' &&
            `a workspace one byte past the bound (${bound + 1} bytes) is past the bounds: the run should fail; it is ${past.status}`,
        ];
      },
    ),
  ];
}

function exportBoundItems(): BankItem[] {
  return [
    pitem(
      'pb.export-bound.exactly-at',
      3,
      2,
      SANDBOX,
      'export-at-the-bound',
      "a parent workspace of exactly exportMaxBytes exports: the child runs and starts with the parent's files; one byte more and the child is not_run, setup_failed",
      async (ctx) => {
        const tag = 'export-bound.exactly-at';
        const rng = rngFor(ctx.seed, `pb:${tag}:size`);
        const bound = between(rng, 2000, 6000);
        const share = between(rng, 300, bound - 300);
        const runWith = async (total: number, slot: string) => {
          const w = (name: string) => tok(ctx, `${tag}:${slot}`, name, 7);
          const paths = [`${w('d')}/${w('a')}.txt`, `${w('e')}.txt`];
          const files: FileAction[] = [
            { path: paths[0] as string, format: 'txt', data: 'a'.repeat(share) },
            { path: paths[1] as string, format: 'txt', data: 'b'.repeat(total - share) },
          ];
          const markers = [0, 1].map((b) => tok(ctx, `${tag}:${slot}`, `marker${b}`, 9));
          const ids = [0, 1].map((b) => tok(ctx, `${tag}:${slot}`, `block${b}`, 6));
          const raw: RawSpec = {
            id: tok(ctx, `${tag}:${slot}`, 'spec', 9),
            kind: 'task',
            blocks: [
              { id: ids[0] as string, user: markers[0] as string, expect: { execution: { ran_code: true } } },
              {
                id: ids[1] as string,
                user: markers[1] as string,
                parent: ids[0] as string,
                expect: { execution: { ran_code: true } },
              },
            ],
          };
          const command = (word: string) => [{ command: `${w('cmd')} ${word}`, exitCode: 0 }];
          const actions = new Map<string, Action>([
            [markers[0] as string, { reply: 'Done.', files, commands: command(w('one')) }],
            [markers[1] as string, { reply: 'Done.', commands: command(w('two')) }],
          ]);
          const agent = plantedAgent(ctx.product, 'code', actions, {
            scratch: ctx.scratch,
            exportMaxBytes: bound,
          });
          const rec = await runLoaded(ctx.product, load(ctx.product, raw), agent.adapter);
          const child = agent.delivered().find((turn) => turn.marker === markers[1]);
          return { rec, child, paths };
        };
        const at = await runWith(bound, 'at');
        const past = await runWith(bound + 1, 'past');
        const childAt = at.rec.blocks[1];
        const childPast = past.rec.blocks[1];
        const missing = at.paths.filter((path) => !(at.child?.files ?? []).includes(path));
        return [
          !at.child &&
            `a parent workspace of exactly exportMaxBytes (${bound} bytes) exports: the child should run; it is ${childAt?.status ?? 'absent'} ${show(childAt?.notRun ?? '')}`,
          at.child &&
            missing.length > 0 &&
            `the child should start with the parent's files; it misses ${show(missing)}, it saw ${show(at.child.files)}`,
          (childPast?.status !== 'not_run' || childPast.notRun?.kind !== 'setup_failed') &&
            `a parent workspace one byte past exportMaxBytes fails the export: the child should be not_run, setup_failed; it is ${childPast?.status ?? 'absent'} ${show(childPast?.notRun?.kind ?? '')}`,
        ];
      },
    ),
  ];
}

export function round2Items(): BankItem[] {
  return [
    ...workspaceFormItems(),
    ...perturbationWorldItems(),
    ...countRangeItems(),
    ...exactGroupingItems(),
    ...depthItems(),
    ...byteBoundItems(),
    ...exportBoundItems(),
  ];
}
