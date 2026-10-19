import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { load, type RawSpec } from '../../blocks/harness';
import { type Action, type FileAction, plantedAgent } from '../../blocks/kinds';
import { type RunRecord, runLoaded } from '../../blocks-breaker/kit';
import { type BankItem, type ItemContext, pitem, SANDBOX, show, tok, writeAt } from './kit';

/**
 * plantedbugs.sandbox: two rules of the sandbox a code agent runs in (docs/adapters/process.md).
 *
 * - A snapshot never enters node_modules or .git ("Sandboxes"), wherever the folder sits: a file under one, at the
 *   root or deeper, is in no workspace diff, and the export a child starts from skips it.
 * - Every path given to a sandbox is relative to the workspace root, and an absolute path is refused ("Workspace
 *   paths"): a file seeded by an absolute path is never written, and an artifact named by one is never read.
 *
 * Each item runs the planted code agent through the product's process adapter in a local sandbox, beside the twin
 * that passes: the same files outside such a folder, or the same path written relative.
 */

type Diff = { created?: string[]; changed?: string[]; deleted?: string[] };
type Verdict = { id: string; outcome: string; gating?: boolean; evidence?: unknown };

/** One run of a code spec whose blocks are played by `actions` (marker to action). */
async function codeRun(ctx: ItemContext, raw: RawSpec, actions: Map<string, Action>) {
  const agent = plantedAgent(ctx.product, 'code', actions, { scratch: ctx.scratch });
  const rec = await runLoaded(ctx.product, load(ctx.product, raw), agent.adapter);
  return { rec, delivered: agent.delivered() };
}

const diffOf = (rec: RunRecord, block: number): Diff =>
  ((rec.blocks[block]?.observed as { workspaceDiff?: Diff } | undefined)?.workspaceDiff ?? {}) as Diff;
const verdictOf = (rec: RunRecord, block: number, id: string): Verdict | undefined =>
  ((rec.blocks[block]?.verdicts ?? []) as Verdict[]).find((each) => each.id === id);
const outcomeOf = (rec: RunRecord, block: number, id: string): string =>
  verdictOf(rec, block, id)?.outcome ?? 'none';

/* ---------------------------------------------------------------------------------------------------------
 * a snapshot never enters node_modules or .git, at any depth
 * ------------------------------------------------------------------------------------------------------- */

type Nest = { id: string; title: string; skipped: (w: (slot: string) => string) => string[] };

const NESTS: readonly Nest[] = [
  {
    id: 'node-modules-in-a-folder',
    title: 'node_modules inside a folder of the workspace',
    skipped: (w) => [`${w('d')}/node_modules/${w('p')}/${w('f')}.js`],
  },
  {
    id: 'git-in-a-folder',
    title: '.git inside a folder of the workspace',
    skipped: (w) => [`${w('d')}/.git/${w('f')}`, `${w('d')}/.git/${w('o')}/${w('g')}`],
  },
  {
    id: 'both-deep',
    title: 'node_modules and .git two folders down',
    skipped: (w) => [`${w('d')}/${w('e')}/node_modules/${w('f')}.txt`, `${w('d')}/${w('e')}/.git/${w('g')}`],
  },
];

function snapshotItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const nest of NESTS) {
    out.push(
      pitem(
        `pb.snapshot.${nest.id}`,
        3,
        1,
        SANDBOX,
        'snapshot-skips-any-depth',
        `the workspace diff of a block that writes files under ${nest.title} lists none of them and lists the file it wrote beside them: a created list naming that file and others_untouched pass, one naming a skipped file fails`,
        async (ctx) => {
          const tag = `snapshot.${nest.id}`;
          const w = (slot: string) => tok(ctx, tag, slot, 7);
          const skipped = nest.skipped(w);
          const kept = `${w('d')}/${w('k')}.txt`;
          const files: FileAction[] = [kept, ...skipped].map((path) => ({
            path,
            format: 'txt',
            data: `${w('line')}\n`,
          }));
          const markers = [0, 1].map((b) => tok(ctx, tag, `marker${b}`, 9));
          const raw: RawSpec = {
            id: tok(ctx, tag, 'spec', 9),
            kind: 'task',
            blocks: [
              {
                id: tok(ctx, tag, 'b0', 6),
                user: markers[0] as string,
                expect: { workspace: { created: [kept], others_untouched: true } },
              },
              {
                id: tok(ctx, tag, 'b1', 6),
                user: markers[1] as string,
                expect: { workspace: { created: [`${w('n')}-${skipped[0]}`] } },
              },
            ],
          };
          const actions = new Map<string, Action>([
            [markers[0] as string, { reply: 'Done.', files }],
            [
              markers[1] as string,
              { reply: 'Done.', files: files.map((file) => ({ ...file, path: `${w('n')}-${file.path}` })) },
            ],
          ]);
          const { rec } = await codeRun(ctx, raw, actions);
          const diff = diffOf(rec, 0);
          const listed = [...(diff.created ?? []), ...(diff.changed ?? []), ...(diff.deleted ?? [])];
          const leaked = skipped.filter((path) => listed.includes(path));
          return [
            !(diff.created ?? []).includes(kept) &&
              `the diff of block 0 should list ${kept} as created; it is ${show(diff)} (run ${rec.status})`,
            leaked.length > 0 &&
              `a snapshot never enters node_modules or .git: the diff of block 0 should not list ${show(leaked)}; it is ${show(diff)}`,
            outcomeOf(rec, 0, 'workspace.created') !== 'pass' &&
              `workspace.created of block 0, naming ${kept}, should pass; it is ${outcomeOf(rec, 0, 'workspace.created')}`,
            outcomeOf(rec, 0, 'workspace.others_untouched') !== 'pass' &&
              `workspace.others_untouched of block 0 should pass: the files under ${nest.title} are in no diff; it is ${outcomeOf(rec, 0, 'workspace.others_untouched')} (${show(verdictOf(rec, 0, 'workspace.others_untouched')?.evidence)})`,
            outcomeOf(rec, 1, 'workspace.created') !== 'fail' &&
              `workspace.created of block 1, naming a file under ${nest.title}, should fail; it is ${outcomeOf(rec, 1, 'workspace.created')}`,
          ];
        },
      ),
    );
  }
  out.push(
    pitem(
      'pb.export.skips-nested-node-modules-and-git',
      3,
      2,
      SANDBOX,
      'export-skips',
      'a child starts with the files its parent wrote in a folder, except those under node_modules or .git inside that folder',
      async (ctx) => {
        const tag = 'export.skips-nested';
        const w = (slot: string) => tok(ctx, tag, slot, 7);
        const kept = `${w('d')}/${w('k')}.txt`;
        const skipped = [
          `${w('d')}/node_modules/${w('p')}/${w('f')}.js`,
          `${w('d')}/${w('e')}/.git/${w('g')}`,
        ];
        const markers = [0, 1].map((b) => tok(ctx, tag, `marker${b}`, 9));
        const ids = [0, 1].map((b) => tok(ctx, tag, `block${b}`, 6));
        const raw: RawSpec = {
          id: tok(ctx, tag, 'spec', 9),
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
        const actions = new Map<string, Action>([
          [
            markers[0] as string,
            {
              reply: 'Done.',
              files: [kept, ...skipped].map((path) => ({
                path,
                format: 'txt' as const,
                data: `${w('line')}\n`,
              })),
              commands: [{ command: `${w('cmd')} ${w('arg')}`, exitCode: 0 }],
            },
          ],
          [
            markers[1] as string,
            { reply: 'Done.', commands: [{ command: `${w('cmd')} ${w('two')}`, exitCode: 0 }] },
          ],
        ]);
        const { rec, delivered } = await codeRun(ctx, raw, actions);
        const child = delivered.find((turn) => turn.marker === markers[1]);
        const files = child?.files ?? [];
        const leaked = skipped.filter((path) => files.includes(path));
        return [
          !child && `the child should run; the run is ${rec.status} and the agent never received it`,
          child &&
            !files.includes(kept) &&
            `the child should start with ${kept}, which its parent wrote; it saw ${show(files)}`,
          leaked.length > 0 &&
            `the export skips node_modules and .git: the child should not receive ${show(leaked)}; it saw ${show(files)}`,
        ];
      },
    ),
  );
  return out;
}

/* ---------------------------------------------------------------------------------------------------------
 * an absolute workspace path is refused
 * ------------------------------------------------------------------------------------------------------- */

function absoluteItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const where of ['spec', 'block'] as const)
    out.push(
      pitem(
        `pb.sandbox-path.absolute-seed.${where}`,
        3,
        1,
        SANDBOX,
        'absolute-path-refused',
        `a workspace file seeded ${where === 'spec' ? 'by the spec' : "by a block's given"} under an absolute path is never written, in the workspace or at that path, while the same file under a relative path reaches the agent`,
        async (ctx) => {
          const tag = `sandbox-path.absolute-seed.${where}`;
          const name = `${tok(ctx, tag, 'file', 8)}.txt`;
          // Two absolute forms: one rooted at /, and one that names a folder of the item's own scratch space.
          const outside = join(ctx.scratch, tok(ctx, tag, 'out', 8), name);
          const run = async (slot: string, files: Record<string, string>) => {
            const markers = [0, 1].map((b) => tok(ctx, `${tag}:${slot}`, `marker${b}`, 9));
            const workspace = { files };
            const raw: RawSpec = {
              id: tok(ctx, `${tag}:${slot}`, 'spec', 9),
              kind: 'task',
              ...(where === 'spec' ? { given: { world: { workspace } } } : {}),
              blocks: markers.map((marker, b) => ({
                id: tok(ctx, `${tag}:${slot}`, `block${b}`, 6),
                user: marker,
                ...(where === 'block' && b === 1 ? { given: { world: { workspace } } } : {}),
                expect: { must: ['Done'] },
              })),
            };
            const actions = new Map<string, Action>(markers.map((marker) => [marker, { reply: 'Done.' }]));
            const { rec, delivered } = await codeRun(ctx, raw, actions);
            const seen = delivered.flatMap((turn) => turn.files ?? []).filter((path) => path.endsWith(name));
            return { rec, seen };
          };
          const line = `${tok(ctx, tag, 'line', 9)}\n`;
          const relativeRun = await run('relative', { [name]: line });
          const rooted = await run('rooted', { [`/${name}`]: line });
          const scratchRun = await run('scratch', { [outside]: line });
          return [
            !relativeRun.seen.includes(name) &&
              `the file seeded as ${name} should reach the agent; it saw ${show(relativeRun.seen)} (run ${relativeRun.rec.status})`,
            rooted.seen.length > 0 &&
              `the absolute path /${name} is refused: the agent should never see that file; it saw ${show(rooted.seen)}`,
            scratchRun.seen.length > 0 &&
              `an absolute path is refused: the agent should never see the file seeded under one; it saw ${show(scratchRun.seen)}`,
            existsSync(outside) &&
              `an absolute path is refused: nothing should be written at ${outside}; the file is there`,
          ];
        },
      ),
    );
  for (const form of ['rooted', 'outside'] as const)
    out.push(
      pitem(
        `pb.sandbox-path.absolute-artifact.${form}`,
        3,
        1,
        SANDBOX,
        'absolute-path-refused',
        `an artifact named by an absolute path (${form === 'rooted' ? 'the name of a file the agent wrote, after a /' : 'a file outside the workspace'}) is never read: its verdict fails and gates, while the file the agent wrote, named relative, passes its contains check`,
        async (ctx) => {
          const tag = `sandbox-path.absolute-artifact.${form}`;
          const name = `${tok(ctx, tag, 'file', 8)}.txt`;
          const word = tok(ctx, tag, 'word', 9);
          const outside = join(ctx.scratch, tok(ctx, tag, 'out', 8), name);
          writeAt(outside, `${word}\n`);
          const absolute = form === 'rooted' ? `/${name}` : outside;
          const markers = [0, 1].map((b) => tok(ctx, tag, `marker${b}`, 9));
          const artifact = (path: string) => ({
            artifacts: [{ path, kind: 'text', checks: [{ contains: word }] }],
          });
          const raw: RawSpec = {
            id: tok(ctx, tag, 'spec', 9),
            kind: 'task',
            blocks: [
              { id: tok(ctx, tag, 'b0', 6), user: markers[0] as string, expect: artifact(name) },
              { id: tok(ctx, tag, 'b1', 6), user: markers[1] as string, expect: artifact(absolute) },
            ],
          };
          const file: FileAction = { path: name, format: 'txt', data: `${word}\n` };
          const actions = new Map<string, Action>(
            markers.map((marker) => [marker, { reply: 'Done.', files: [file] } as Action]),
          );
          const { rec } = await codeRun(ctx, raw, actions);
          const opened = (block: number, path: string) => verdictOf(rec, block, `artifacts.${path}`);
          const relativeV = opened(0, name);
          const absoluteV = opened(1, absolute);
          return [
            relativeV?.outcome !== 'pass' &&
              `the artifact ${name}, which the agent wrote, should be read: artifacts.${name} should pass; it is ${relativeV?.outcome ?? 'absent'} (run ${rec.status})`,
            outcomeOf(rec, 0, `artifacts.${name}.0.contains`) !== 'pass' &&
              `the contains check of ${name} should pass; it is ${outcomeOf(rec, 0, `artifacts.${name}.0.contains`)}`,
            (absoluteV?.outcome !== 'fail' || absoluteV.gating === false) &&
              `the absolute artifact path ${absolute} is refused: its verdict should fail and gate; it is ${show(absoluteV ? { outcome: absoluteV.outcome, gating: absoluteV.gating } : 'absent')}`,
            outcomeOf(rec, 1, `artifacts.${absolute}.0.contains`) === 'pass' &&
              `the contains check of the absolute path ${absolute} should not pass: the file is never read`,
            rec.blocks[1]?.pass !== false && `block 1, whose artifact is never read, should fail; it passes`,
          ];
        },
      ),
    );
  return out;
}

export function sandboxItems(): BankItem[] {
  return [...snapshotItems(), ...absoluteItems()];
}
