import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse, stringify } from 'yaml';
import { observed } from '../../blocks/harness';
import { startHttpAgent } from '../../blocks/http-agent';
import { type BankItem, CLI_PKG, cli, folder, gitem, type ItemContext, show, tok, writeAt } from './kit';

/**
 * docgaps.run, the campaign part: what `campaign status` says of carried results (docs/concepts/blast-radius.md "In
 * the statistics and the report"), the hashes of an exported bundle (docs/datasets.md "Run a campaign again
 * elsewhere"), and the sections `radius localize` ranks (docs/concepts/blast-radius.md "Localisation over
 * sections"). A seeded agent behind a local endpoint answers every spec; nothing leaves 127.0.0.1.
 */

const FAMILY = 'docgaps.run';
const P = 'dg.run';

type SpecPlan = {
  /** The spec's id, written in its file `<id>.yaml`. */
  id: string;
  /** Does the agent answer the block's code (pass) or not (fail). */
  pass: boolean;
  /** Keys of the spec beside its blocks (`metadata`). */
  extra?: Record<string, unknown>;
  /** What the agent reports it cost, in USD. */
  usd?: number;
  /** Expectations of the first block beside its must. */
  expect?: Record<string, unknown>;
};

type World = {
  dir: string;
  files: string[];
  run(argv: string[]): Promise<{ code: number; out: string; err: string }>;
  close(): Promise<void>;
};

/** One spec of one block per plan, all on a seeded http agent that answers each block as its plan says. */
async function world(ctx: ItemContext, tag: string, plans: SpecPlan[]): Promise<World> {
  const dir = folder(ctx, tag);
  const users = plans.map((_, s) => tok(ctx, tag, `u${s}`, 10));
  const codes = plans.map((_, s) => tok(ctx, tag, `c${s}`, 8));
  const agent = await startHttpAgent((turn) => {
    const s = users.findIndex((user) => turn.user.includes(user));
    if (s === -1) return observed('Understood, back to your rental.');
    const plan = plans[s] as SpecPlan;
    return {
      ...observed(plan.pass ? `Yes, ${codes[s]}.` : 'Let me look into it.'),
      cost: { usd: plan.usd ?? 0 },
    };
  });
  const files = plans.map((plan, s) => {
    const name = `${plan.id}.yaml`;
    writeAt(join(dir, name), {
      id: plan.id,
      target: {
        adapter: 'http',
        agent: 'larkspur',
        options: { url: agent.url, tool_stubs: false, deterministic: true },
      },
      ...(plan.extra ?? {}),
      blocks: [
        { id: 'b0', user: users[s], expect: { must: [codes[s]], ...(plan.expect ?? {}) } },
        { id: 'b1', user: `${users[s]} again`, expect: { must: [codes[s]] } },
      ],
    });
    return name;
  });
  return { dir, files, run: (argv) => cli(ctx, argv, dir), close: () => agent.close() };
}

async function withWorld<T>(
  ctx: ItemContext,
  tag: string,
  plans: SpecPlan[],
  body: (w: World) => Promise<T>,
): Promise<T> {
  const w = await world(ctx, tag, plans);
  try {
    return await body(w);
  } finally {
    await w.close();
  }
}

const brief = (text: string) => text.replace(/\s+/g, ' ').slice(0, 200);

/* ---------------------------------------------------------------------------------------------------------
 * campaign status of a radius campaign: the merged line and the agent version of the carried runs
 * ------------------------------------------------------------------------------------------------------- */

function mergedItem(which: 'counts' | 'version'): BankItem {
  const id = `${P}.status-merged.${which}`;
  return gitem(
    FAMILY,
    id,
    4,
    CLI_PKG,
    'status-merged-line',
    which === 'counts'
      ? 'campaign status of a campaign with one fresh and one carried run prints that fresh and carried results are merged, 1 fresh and 1 carried; the baseline prints no such line'
      : 'campaign status of a campaign whose carried run was measured on v1 while it runs v2 names both versions; the baseline prints no such line',
    async (ctx) => {
      const [ta, tb] = [tok(ctx, id, 'ta', 6), tok(ctx, id, 'tb', 6)];
      const plans: SpecPlan[] = [
        { id: tok(ctx, id, 'sa', 7), pass: true, extra: { metadata: { depends: { tools: [ta] } } } },
        { id: tok(ctx, id, 'sb', 7), pass: true, extra: { metadata: { depends: { tools: [tb] } } } },
      ];
      return withWorld(ctx, id, plans, async (w) => {
        const [v1, v2] = [`${tok(ctx, id, 'v', 5)}-v1`, `${tok(ctx, id, 'v', 5)}-v2`];
        const base = `c-${tok(ctx, id, 'base', 7)}`;
        const next = `c-${tok(ctx, id, 'next', 7)}`;
        writeAt(join(w.dir, 'change.yaml'), { from: v1, to: v2, changes: [{ kind: 'tool', id: ta }] });
        const first = await w.run([
          'campaign',
          'run',
          ...w.files,
          '--agent-version',
          v1,
          '--store',
          'runs.db',
          '--campaign',
          base,
        ]);
        const second = await w.run([
          'campaign',
          'run',
          ...w.files,
          '--agent-version',
          v2,
          '--store',
          'runs.db',
          '--campaign',
          next,
          '--change',
          'change.yaml',
          '--from',
          base,
        ]);
        const status = await w.run(['campaign', 'status', next, '--store', 'runs.db']);
        const baseline = await w.run(['campaign', 'status', base, '--store', 'runs.db']);
        const merged = /Fresh and carried results are merged: 1 runs? fresh, 1 runs? carried/;
        const version = new RegExp(
          `1 runs? carried from ${base}, measured on another agent version, ${v1} \\(this campaign runs ${v2}\\)`,
        );
        const want = which === 'counts' ? merged : version;
        return [
          first.code !== 0 &&
            `the baseline campaign passes and exits 0; it exits ${first.code}: ${brief(first.err)}`,
          !/1 carried/.test(second.out) &&
            `the change names only ${ta}, which one spec declares: the radius campaign should carry the other spec's run; it printed "${brief(second.out.split('\n').slice(-3).join(' '))}"`,
          !want.test(status.out) &&
            `campaign status of ${next} should print ${which === 'counts' ? '"Fresh and carried results are merged: 1 runs fresh, 1 runs carried."' : `that the carried run was measured on ${v1} while the campaign runs ${v2}`}; it printed "${brief(status.out)}"`,
          (merged.test(baseline.out) || /carried from/.test(baseline.out)) &&
            `the baseline ${base} carries nothing and should print no merged line; it printed "${brief(baseline.out)}"`,
        ];
      });
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * campaign export: the manifest holds the SHA-256 of every file
 * ------------------------------------------------------------------------------------------------------- */

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

function bundleItem(which: 'runs-and-specs' | 'sources'): BankItem {
  const id = `${P}.bundle-manifest.${which}`;
  return gitem(
    FAMILY,
    id,
    which === 'sources' ? 4 : 3,
    CLI_PKG,
    'bundle-manifest-hashes',
    which === 'sources'
      ? "the manifest of an exported campaign run with a prompt version holds the SHA-256 of the version's version.json and of its file"
      : 'the manifest of an exported campaign holds the SHA-256 of the campaign record, of every run and of every spec it writes',
    async (ctx) => {
      const plans: SpecPlan[] = [
        { id: tok(ctx, id, 'sa', 7), pass: true },
        { id: tok(ctx, id, 'sb', 7), pass: false },
      ];
      return withWorld(ctx, id, plans, async (w) => {
        const campaign = `c-${tok(ctx, id, 'c', 7)}`;
        const prompt = tok(ctx, id, 'prompt', 6);
        const pre: { code: number; err: string }[] = [];
        if (which === 'sources') {
          writeAt(
            join(w.dir, 'desk.txt'),
            'You answer the riders of Larkspur Cycles, a fictional bike shop.\n',
          );
          pre.push(await w.run(['prompt', 'push', prompt, 'desk.txt', '--store', 'runs.db']));
        }
        const ran = await w.run([
          'campaign',
          'run',
          ...w.files,
          '--store',
          'runs.db',
          '--campaign',
          campaign,
          ...(which === 'sources' ? ['--prompt', prompt] : []),
        ]);
        const exported = await w.run([
          'campaign',
          'export',
          campaign,
          '--store',
          'runs.db',
          '--out',
          'bundles',
        ]);
        const bundle = join(w.dir, 'bundles', campaign);
        let manifest = '';
        let all: string[] = [];
        try {
          manifest = readFileSync(join(bundle, 'manifest.json'), 'utf8');
          all = filesUnder(bundle).filter((path) => !path.endsWith('manifest.json'));
        } catch (error) {
          return [
            `campaign export should write ${campaign}/manifest.json; exit ${exported.code}: ${brief(exported.err || exported.out)} (${(error as Error).message.slice(0, 80)})`,
          ];
        }
        const wanted =
          which === 'sources'
            ? all.filter((path) => relative(bundle, path).startsWith('sources'))
            : all.filter((path) => !relative(bundle, path).startsWith('sources'));
        // Each file is named in the manifest beside a SHA-256: its own path, followed by 64 hex characters.
        const named = (path: string) =>
          new RegExp(
            `"${relative(bundle, path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"[0-9a-f]{64}"`,
          ).test(manifest) || manifest.includes(sha256(path));
        const missing = wanted.filter((path) => !named(path)).map((path) => relative(bundle, path));
        return [
          ...pre.map(
            (each) =>
              each.code !== 0 &&
              `prompt push should store the prompt version; it exits ${each.code}: ${brief(each.err)}`,
          ),
          ran.code !== 1 &&
            `the campaign has a failing cell and exits 1; it exits ${ran.code}: ${brief(ran.err)}`,
          exported.code !== 0 && `campaign export exits 0; it exits ${exported.code}: ${brief(exported.err)}`,
          which === 'sources' &&
            !wanted.some((path) => path.endsWith('version.json')) &&
            `the bundle of a campaign run with --prompt should hold sources/prompt/${prompt}@1/version.json; it holds ${show(all.map((path) => relative(bundle, path)))}`,
          which === 'runs-and-specs' &&
            wanted.length < 5 &&
            `the bundle should hold campaign.json, 2 runs and 2 specs; it holds ${show(wanted.map((path) => relative(bundle, path)))}`,
          missing.length > 0 &&
            `manifest.json should name every file of the bundle with its SHA-256; it names no hash for ${show(missing)}`,
        ];
      });
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * radius localize: a section only refuted links reach is not ranked
 * ------------------------------------------------------------------------------------------------------- */

function refutedItem(): BankItem {
  const id = `${P}.localize.refuted-only-section`;
  return gitem(
    FAMILY,
    id,
    5,
    CLI_PKG,
    'refuted-section-unranked',
    'radius localize ranks a local section a failing block links to, and leaves out one only a refuted link of that block reaches',
    async (ctx) => {
      const [hot, cold, quiet] = [tok(ctx, id, 'hot', 7), tok(ctx, id, 'cold', 7), tok(ctx, id, 'quiet', 7)];
      const promptId = tok(ctx, id, 'desk', 6);
      const link = (section: string, status: string) => ({
        block: 'b0',
        to: { kind: 'prompt_section', prompt: promptId, section },
        status,
        created_by: 'author',
      });
      const plans: SpecPlan[] = [
        {
          id: tok(ctx, id, 'sa', 7),
          pass: false,
          extra: { metadata: { links: [link(hot, 'declared'), link(cold, 'refuted')] } },
        },
        { id: tok(ctx, id, 'sb', 7), pass: true, extra: { metadata: { links: [link(quiet, 'declared')] } } },
      ];
      return withWorld(ctx, id, plans, async (w) => {
        const text = [
          '# Larkspur desk',
          '',
          'You help the riders of Larkspur Cycles, a fictional bike shop.',
          '',
          `## ${hot}`,
          '',
          'Name the bike and its daily price before you book it.',
          '',
          `## ${cold}`,
          '',
          'Offer a helmet with every rental of a road bike.',
          '',
          `## ${quiet}`,
          '',
          'Close the shop at six and say so when asked.',
          '',
        ].join('\n');
        writeAt(join(w.dir, 'desk.md'), text);
        const init = await w.run([
          'radius',
          'sections',
          'init',
          'desk.md',
          '--id',
          promptId,
          '--prompt-version',
          'v1',
          '--out',
          'desk.sections.yaml',
        ]);
        if (init.code !== 0)
          return [
            `radius sections init exits 0 on a prompt of three headings; it exits ${init.code}: ${brief(init.err)}`,
          ];
        // Every section init writes is global; the three named ones are made local, so localize may rank them.
        const registry = parse(readFileSync(join(w.dir, 'desk.sections.yaml'), 'utf8')) as {
          sections?: { id: string; scope?: string }[];
        };
        for (const section of registry.sections ?? [])
          if ([hot, cold, quiet].includes(section.id)) section.scope = 'local';
        writeAt(join(w.dir, 'desk.sections.yaml'), stringify(registry));
        const campaign = `c-${tok(ctx, id, 'c', 7)}`;
        const ran = await w.run([
          'campaign',
          'run',
          ...w.files,
          '--store',
          'runs.db',
          '--campaign',
          campaign,
        ]);
        const local = await w.run([
          'radius',
          'localize',
          ...w.files,
          '--store',
          'runs.db',
          '--campaign',
          campaign,
          '--sections',
          'desk.sections.yaml',
          '--json',
        ]);
        const known = (registry.sections ?? []).map((section) => section.id);
        return [
          !known.includes(hot) || !known.includes(cold)
            ? `the registry should hold the sections ${hot} and ${cold}; it holds ${show(known)}`
            : undefined,
          ran.code !== 1 &&
            `one spec fails, so the campaign exits 1; it exits ${ran.code}: ${brief(ran.err)}`,
          local.code !== 0 &&
            `radius localize ranks the sections of a failing block and exits 0; it exits ${local.code}: ${brief(local.err || local.out)}`,
          !local.out.includes(hot) &&
            `the failing block links ${hot}: it should be ranked; the output reads "${brief(local.out)}"`,
          local.out.includes(cold) &&
            `only a refuted link reaches ${cold}: it has no covering block and is not ranked; the output names it: "${brief(local.out)}"`,
        ];
      });
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * the Spent of a radius campaign: carried runs cost nothing
 * ------------------------------------------------------------------------------------------------------- */

function spentItem(): BankItem {
  const id = `${P}.status-spent.fresh-only`;
  return gitem(
    FAMILY,
    id,
    4,
    CLI_PKG,
    'status-spent-fresh-only',
    'a radius campaign that runs one spec fresh and carries one spends the fresh run alone, on its own summary and in campaign status; the baseline spends both',
    async (ctx) => {
      const [ta, tb] = [tok(ctx, id, 'ta', 6), tok(ctx, id, 'tb', 6)];
      const plans: SpecPlan[] = [
        {
          id: tok(ctx, id, 'sa', 7),
          pass: true,
          usd: 0.11,
          extra: { metadata: { depends: { tools: [ta] } } },
        },
        {
          id: tok(ctx, id, 'sb', 7),
          pass: true,
          usd: 0.3,
          extra: { metadata: { depends: { tools: [tb] } } },
        },
      ];
      return withWorld(ctx, id, plans, async (w) => {
        const [v1, v2] = [`${tok(ctx, id, 'v', 5)}-v1`, `${tok(ctx, id, 'v', 5)}-v2`];
        const base = `c-${tok(ctx, id, 'base', 7)}`;
        const next = `c-${tok(ctx, id, 'next', 7)}`;
        writeAt(join(w.dir, 'change.yaml'), { from: v1, to: v2, changes: [{ kind: 'tool', id: ta }] });
        const spent = (out: string) => /Spent \$([0-9]+(?:\.[0-9]+)?)/.exec(out)?.[1];
        const first = await w.run([
          'campaign',
          'run',
          ...w.files,
          '--agent-version',
          v1,
          '--store',
          'runs.db',
          '--campaign',
          base,
        ]);
        const second = await w.run([
          'campaign',
          'run',
          ...w.files,
          '--agent-version',
          v2,
          '--store',
          'runs.db',
          '--campaign',
          next,
          '--change',
          'change.yaml',
          '--from',
          base,
        ]);
        const status = await w.run(['campaign', 'status', next, '--store', 'runs.db']);
        // Two blocks a spec, each reporting the spec's cost: 0.22 for the first spec, 0.60 for the second.
        return [
          spent(first.out) !== '0.82' &&
            `the baseline runs both specs, $0.22 and $0.60: it spends $0.82; it printed Spent $${spent(first.out)}`,
          !/1 carried/.test(second.out) &&
            `the radius campaign should carry the spec the change leaves out; it printed "${brief(second.out.split('\n').slice(-3).join(' '))}"`,
          spent(second.out) !== '0.22' &&
            `the radius campaign runs the first spec fresh ($0.22) and carries the second: it spends $0.22; it printed Spent $${spent(second.out)}`,
          spent(status.out) !== '0.22' &&
            `campaign status of the radius campaign counts the fresh run alone, $0.22; it printed Spent $${spent(status.out)}`,
        ];
      });
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * perturb: the Reply checks line of a drawn phrasing with stage-bound patterns
 * ------------------------------------------------------------------------------------------------------- */

function replyChecksItem(which: 'another-stage' | 'no-stage'): BankItem {
  const id = `${P}.reply-checks.${which}`;
  return gitem(
    FAMILY,
    id,
    4,
    CLI_PKG,
    'reply-checks-line',
    which === 'another-stage'
      ? 'perturb with a drawn phrasing whose patterns are tied to two stages, the spec at one of them, prints Reply checks with the other not applicable (tied to another stage)'
      : 'perturb with a drawn phrasing whose patterns are tied to two stages, the spec at none, prints Reply checks with both not applicable (no stage)',
    async (ctx) => {
      const [s1, s2] = [tok(ctx, id, 's1', 6), tok(ctx, id, 's2', 6)];
      const plans: SpecPlan[] = [
        {
          id: tok(ctx, id, 'sa', 7),
          pass: true,
          extra: which === 'another-stage' ? { stages: [s1, s2] } : {},
          expect: which === 'another-stage' ? { stage: s1 } : {},
        },
      ];
      return withWorld(ctx, id, plans, async (w) => {
        writeAt(join(w.dir, 'redteam', 'd02-goal-shift.yaml'), {
          class: 'D2_goal_shift',
          stages: [s1, s2],
          conversation: [
            {
              id: `d2-${tok(ctx, id, 'ph', 6)}`,
              approved: true,
              user: 'Wait, can you show me the cheapest bike instead?',
              must: [
                'back to your rental',
                { pattern: 'rental', at_stage: [s1] },
                { pattern: 'back', at_stage: [s2] },
              ],
            },
          ],
        });
        const ran = await w.run([
          'perturb',
          w.files[0] as string,
          '--class',
          'D2',
          '--at',
          '1',
          '--pack',
          'redteam',
        ]);
        const said = `${ran.out}\n${ran.err}`;
        const line = /Reply checks: (\d+) of (\d+) applied, (\d+) not applicable \(([^)]+)\)/.exec(ran.out);
        const [a, t, n] = line ? [Number(line[1]), Number(line[2]), Number(line[3])] : [0, 0, 0];
        const wantN = which === 'another-stage' ? 1 : 2;
        const reason = which === 'another-stage' ? 'tied to another stage' : 'no stage';
        return [
          ran.code === 2 && `perturb should run the drawn phrasing; it exits 2: ${brief(said)}`,
          !line && `perturb should print a Reply checks line; it printed "${brief(said)}"`,
          line !== null &&
            n !== wantN &&
            `${wantN} stage-bound pattern${wantN === 1 ? ' is' : 's are'} not applicable; the line reads "${line[0]}"`,
          line !== null &&
            a + n !== t &&
            `the applied and the not applicable checks make the total; the line reads "${line[0]}"`,
          line !== null &&
            line[4] !== reason &&
            `the reason should be "${reason}"; the line reads "${line[0]}"`,
        ];
      });
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * replay: the summary line
 * ------------------------------------------------------------------------------------------------------- */

function replayItem(): BankItem {
  const id = `${P}.replay.summary-line`;
  return gitem(
    FAMILY,
    id,
    3,
    CLI_PKG,
    'replay-summary-line',
    'replay over two recorded sessions, one meeting its spec and one not, ends with "2 specs replayed: 1 pass, 1 fail. Campaign replay-<hash> (in memory)."',
    async (ctx) => {
      const dir = folder(ctx, id);
      const names = [tok(ctx, id, 'one', 7), tok(ctx, id, 'two', 7)];
      const codes = [tok(ctx, id, 'c1', 8), tok(ctx, id, 'c2', 8)];
      names.forEach((name, i) => {
        const user = {
          type: 'user',
          uuid: `u${i}`,
          message: { role: 'user', content: `Is ${name} free on Saturday?` },
        };
        const reply = i === 0 ? `Yes, ${codes[0]}.` : 'Let me check the calendar.';
        const assistant = {
          type: 'assistant',
          uuid: `a${i}`,
          message: { role: 'assistant', content: [{ type: 'text', text: reply }] },
        };
        writeAt(join(dir, `${name}.jsonl`), `${JSON.stringify(user)}\n${JSON.stringify(assistant)}\n`);
        writeAt(join(dir, 'suite', `${name}.yaml`), {
          id: `replay-${name}`,
          metadata: { session: name },
          blocks: [{ user: `Is ${name} free on Saturday?`, expect: { must: [codes[i]] } }],
        });
      });
      const ran = await cli(
        ctx,
        ['replay', ...names.map((name) => `${name}.jsonl`), '--suite', 'suite'],
        dir,
      );
      return [
        ran.code !== 1 &&
          `one aligned spec fails, so replay exits 1; it exits ${ran.code}: ${brief(ran.err || ran.out)}`,
        !/^2 specs replayed: 1 pass, 1 fail\. Campaign replay-[0-9a-f]+ \(in memory\)\.$/m.test(ran.out) &&
          `the last line should read "2 specs replayed: 1 pass, 1 fail. Campaign replay-<hash> (in memory)."; the output reads "${brief(ran.out.split('\n').slice(-3).join(' | '))}"`,
      ];
    },
  );
}

export function campaignItems(): BankItem[] {
  return [
    mergedItem('counts'),
    mergedItem('version'),
    spentItem(),
    bundleItem('runs-and-specs'),
    bundleItem('sources'),
    refutedItem(),
    replyChecksItem('another-stage'),
    replyChecksItem('no-stage'),
    replayItem(),
  ];
}
