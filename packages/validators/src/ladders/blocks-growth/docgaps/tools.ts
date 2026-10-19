import { join } from 'node:path';
import { loadIssues } from '../../blocks/harness';
import {
  type BankItem,
  CHECKS_PKG,
  type CheckEntry,
  CLI_PKG,
  CORE_PKG,
  cli,
  codesOf,
  evidenceOf,
  exec,
  execScene,
  expectNone,
  expectV,
  folder,
  gitem,
  type ItemContext,
  idsAt,
  parseEntries,
  type Row,
  type RunRecord,
  sceneOf,
  show,
  tok,
  verdict,
  writeAt,
} from './kit';

/**
 * docgaps.tools-stage-loader: rules of docs/reference/checks.md (tools, tool_f1, safety), docs/concepts/drift.md
 * (the stage classifier and its flow verdicts) and docs/reference/cli.md (issue codes, paths, the check layers) no
 * earlier item tests in the case written here. Every item holds the shape the doc passes beside the one it fails.
 */

const FAMILY = 'docgaps.tools-stage-loader';
const P = 'dg.tsl';

/* ---------------------------------------------------------------------------------------------------------
 * tool_order exact on a range or max-only count: the first difference, expected and seen
 * ------------------------------------------------------------------------------------------------------- */

function exactOrderItem(count: 'range' | 'max-only'): BankItem {
  const id = `${P}.exact-order.${count}`;
  return gitem(
    FAMILY,
    id,
    count === 'range' ? 3 : 4,
    CHECKS_PKG,
    'exact-order-first-difference',
    `tool_order exact with a ${count === 'range' ? '{ min: 1, max: 2 }' : '{ max: 2 }'} count passes A A B, and on A A A B names the call where the order leaves the expected one, with the tools expected and seen`,
    async (ctx) => {
      const [a, b] = [tok(ctx, id, 'a', 7), tok(ctx, id, 'b', 7)];
      const expect = {
        tools: [
          { label: a, count: count === 'range' ? { min: 1, max: 2 } : { max: 2 } },
          { label: b, count: 1 },
        ],
        tool_order: 'exact',
      };
      const rows: Row[] = [
        { calls: [{ label: a }, { label: a }, { label: b }], expect },
        { calls: [{ label: a }, { label: a }, { label: a }, { label: b }], expect },
      ];
      const rec = await exec(ctx, id, rows);
      const ev = evidenceOf(verdict(rec, 1, 'tools.order'));
      return [
        expectV(rec, 0, 'tools.order', 'pass', true),
        expectV(rec, 1, 'tools.order', 'fail', true),
        !(ev.includes(a) && ev.includes(b)) &&
          `block 1 (${a} ${a} ${a} ${b}): the evidence should name the first call that leaves the order, ${a} seen where ${b} was expected; it reads "${ev.slice(0, 160)}"`,
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * tool_f1 with a { max: 0 } count
 * ------------------------------------------------------------------------------------------------------- */

function toolF1Item(): BankItem {
  const id = `${P}.tool-f1.max-zero`;
  return gitem(
    FAMILY,
    id,
    4,
    CHECKS_PKG,
    'tool-f1-max-zero',
    'tool_f1 reads { max: 0 } as a call that must not happen: not calling it scores 1, calling it is an unexpected call, as with count 0',
    async (ctx) => {
      const [a, b] = [tok(ctx, id, 'a', 7), tok(ctx, id, 'b', 7)];
      const expectWith = (zero: unknown) => ({
        tools: [
          { label: a, count: zero },
          { label: b, count: 1 },
        ],
        tool_f1: { min: 0.9 },
      });
      const rows: Row[] = [
        { calls: [{ label: b }], expect: expectWith({ max: 0 }) },
        { calls: [{ label: a }, { label: b }], expect: expectWith({ max: 0 }) },
        { calls: [{ label: a }, { label: b }], expect: expectWith(0) },
      ];
      const rec = await exec(ctx, id, rows);
      const score = (block: number) => verdict(rec, block, 'tool_f1.f1')?.score;
      return [
        expectV(rec, 0, 'tool_f1.f1', 'pass'),
        expectV(rec, 1, 'tool_f1.f1', 'fail'),
        expectV(rec, 2, 'tool_f1.f1', 'fail'),
        score(0) !== undefined &&
          Math.abs((score(0) as number) - 1) > 1e-9 &&
          `block 0 should score F1 1; it scores ${score(0)}`,
        score(1) !== undefined &&
          score(2) !== undefined &&
          Math.abs((score(1) as number) - (score(2) as number)) > 1e-9 &&
          `{ max: 0 } and count 0 should score the same calls alike; they score ${score(1)} and ${score(2)}`,
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * safety: a tool delete of a listed path counts once and stays confirmed
 * ------------------------------------------------------------------------------------------------------- */

function safetyItem(rule: 'cap' | 'confirm'): BankItem {
  const id = `${P}.safety-confirmed.${rule}`;
  return gitem(
    FAMILY,
    id,
    5,
    CHECKS_PKG,
    'safety-confirmed-after-dedupe',
    rule === 'cap'
      ? 'a tool delete of a path the diff lists, with the tool expected, is one confirmed operation: max_destructive_ops 0 holds; without the expectation it fails'
      : 'a tool delete of a path the diff lists, with the tool expected, is confirmed: confirm_before delete holds; without the expectation it fails',
    async (ctx) => {
      const del = `${tok(ctx, id, 't', 6)}_delete`;
      const path = `data/${tok(ctx, id, 'f', 6)}.txt`;
      const diff = { workspaceDiff: { created: [], changed: [], deleted: [path] } };
      const safety = rule === 'cap' ? { max_destructive_ops: 0 } : { confirm_before: ['delete'] };
      const rows: Row[] = [
        {
          calls: [{ label: del, input: { path } }],
          extra: diff,
          expect: { tools: [{ label: del, count: 1 }], safety },
        },
        { calls: [{ label: del, input: { path } }], extra: diff, expect: { safety } },
      ];
      const rec = await exec(ctx, id, rows);
      const vid = rule === 'cap' ? 'safety.max_destructive_ops' : 'safety.confirm_before.delete';
      return [expectV(rec, 0, vid, 'pass', true), expectV(rec, 1, vid, 'fail', true)];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * flow verdicts: only for a stage the classifier decided
 * ------------------------------------------------------------------------------------------------------- */

type Stages = { s: [string, string, string]; t: [string, string, string] };

function stagesOf(ctx: ItemContext, tag: string): Stages {
  return {
    s: [tok(ctx, tag, 's1', 6), tok(ctx, tag, 's2', 6), tok(ctx, tag, 's3', 6)],
    t: [tok(ctx, tag, 'ta', 7), tok(ctx, tag, 'tb', 7), tok(ctx, tag, 'tc', 7)],
  };
}

/**
 * Three blocks over the catalogue s1 s2 s3, each stage's signature its own tool: block 0 reaches s1, block 1 s3, and
 * block 2 calls s1's tool again (the flow goes back), unless `third` says otherwise. `runtime` makes the agent report
 * the stages: every block (`all`), or blocks 0 and 1 only (`carried`); `none` leaves the classifier to read them.
 */
function flowRows(
  st: Stages,
  runtime: 'none' | 'all' | 'carried',
  third: { calls: 'a' | 'c' | 'none'; expectStage?: boolean } = { calls: 'a' },
): Row[] {
  const [s1, , s3] = st.s;
  const [ta, , tc] = st.t;
  const report = (stage: string) => (runtime === 'none' ? {} : { stage });
  return [
    { calls: [{ label: ta }], ...report(s1), expect: { stage: s1, tools: [{ label: ta }] } },
    { calls: [{ label: tc }], ...report(s3), expect: { stage: s3, tools: [{ label: tc }] } },
    {
      calls: third.calls === 'none' ? [] : [{ label: third.calls === 'a' ? ta : tc }],
      ...(runtime === 'all' ? { stage: third.calls === 'c' ? s3 : s1 } : {}),
      ...(third.expectStage ? { expect: { stage: s3 } } : {}),
    },
  ];
}

/** The stage catalogue (with s2's own signature on a perturbation-free spec) and, in mode P, one user perturbation. */
function flowSpec(st: Stages, pw?: string): Record<string, unknown> {
  return {
    stages: st.s,
    ...(pw
      ? { perturbations: [{ id: `p${pw.slice(0, 5)}`, class: 'D1_off_topic', inject_at: 1, user: pw }] }
      : {}),
  };
}

/** The record of the third spec block, found by its id (mode P adds an injected block before it). */
const third = (rec: RunRecord, id: string): number => rec.blocks.findIndex((block) => block.blockId === id);

async function flowRun(
  ctx: ItemContext,
  tag: string,
  st: Stages,
  rows: Row[],
  mode: 'T' | 'F' | 'P',
): Promise<{ rec: RunRecord; at: number }> {
  const pw = mode === 'P' ? tok(ctx, tag, 'pw', 9) : undefined;
  const sc = sceneOf(ctx, tag, rows, flowSpec(st, pw));
  if (pw) sc.plans.set(pw, { text: 'Sure, one moment.' });
  const rec = await execScene(ctx, sc, {
    mode,
    ...(pw ? { perturbationId: `p${pw.slice(0, 5)}` } : {}),
  });
  return { rec, at: third(rec, sc.ids[2] as string) };
}

type FlowCase = {
  id: string;
  title: string;
  tier: 3 | 4 | 5;
  mode: 'T' | 'F' | 'P';
  runtime: 'all' | 'carried';
  third?: { calls: 'a' | 'c' | 'none'; expectStage?: boolean };
};

const FLOW_CASES: FlowCase[] = [
  {
    id: 'carried-F',
    title:
      'in mode F a block that reports no stage keeps the stage an earlier block reported: it gets no flow verdict',
    tier: 4,
    mode: 'F',
    runtime: 'carried',
  },
  {
    id: 'carried-P',
    title:
      'in mode P a block that reports no stage keeps the stage an earlier block reported: it gets no flow verdict',
    tier: 5,
    mode: 'P',
    runtime: 'carried',
  },
  {
    id: 'reported-T',
    title: 'in mode T a block whose runtime reports an earlier stage gets no flow verdict',
    tier: 4,
    mode: 'T',
    runtime: 'all',
  },
  {
    id: 'reported-back-F',
    title:
      'in mode F a block whose runtime reports a stage earlier than the one before gets no flow.order verdict',
    tier: 3,
    mode: 'F',
    runtime: 'all',
  },
  {
    id: 'reported-back-P',
    title:
      'in mode P a block whose runtime reports a stage earlier than the one before gets no flow.order verdict',
    tier: 5,
    mode: 'P',
    runtime: 'all',
  },
  {
    id: 'carried-expected-F',
    title:
      'in mode F a block that expects the stage an earlier block reported is judged by stage.reached, with no flow.stage',
    tier: 4,
    mode: 'F',
    runtime: 'carried',
    third: { calls: 'none', expectStage: true },
  },
];

function flowItem(c: FlowCase): BankItem {
  const id = `${P}.flow-classifier-only.${c.id}`;
  return gitem(FAMILY, id, c.tier, CORE_PKG, 'flow-verdict-classifier-only', c.title, async (ctx) => {
    const st = stagesOf(ctx, id);
    const shape = c.third ?? { calls: 'a' as const };
    const reported = await flowRun(ctx, `${id}:runtime`, st, flowRows(st, c.runtime, shape), c.mode);
    const read = await flowRun(ctx, `${id}:classifier`, st, flowRows(st, 'none', shape), c.mode);
    if (reported.at === -1 || read.at === -1)
      return [`the run holds no record of the third spec block (${reported.rec.blocks.length} blocks)`];
    return [
      // The classifier reads block 2 from its tools: a flow verdict is there (the twin).
      idsAt(read.rec, read.at).some((each) => each.startsWith('flow.'))
        ? undefined
        : `with no stage reported, the classifier reads the third block and adds a flow verdict; it has ${show(idsAt(read.rec, read.at))}`,
      expectNone(reported.rec, reported.at, 'flow'),
      shape.expectStage ? expectV(reported.rec, reported.at, 'stage.reached', 'pass', true) : undefined,
    ];
  });
}

function flowEvidenceItem(which: 'went-back' | 'pass'): BankItem {
  const id = `${P}.flow-evidence.${which}`;
  return gitem(
    FAMILY,
    id,
    3,
    CORE_PKG,
    'flow-evidence-stages',
    which === 'went-back'
      ? 'a failing flow.order names the stage the block reached and the stage before it'
      : 'a passing flow.order names the stage the block reached',
    async (ctx) => {
      const st = stagesOf(ctx, id);
      const [s1, , s3] = st.s;
      const { rec, at } = await flowRun(
        ctx,
        id,
        st,
        flowRows(st, 'none', { calls: which === 'went-back' ? 'a' : 'c' }),
        'F',
      );
      const ev = evidenceOf(verdict(rec, at, 'flow.order'));
      return which === 'went-back'
        ? [
            expectV(rec, at, 'flow.order', 'fail', true),
            !(ev.includes(s1) && ev.includes(s3)) &&
              `the block went back from ${s3} to ${s1}: the evidence should name both; it reads "${ev.slice(0, 160)}"`,
          ]
        : [
            expectV(rec, at, 'flow.order', 'pass'),
            !ev.includes(s3) &&
              `the block stayed at ${s3}: the evidence should name it; it reads "${ev.slice(0, 160)}"`,
          ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * the loader: STAGE_UNKNOWN with a list, the check layers, the Given verifier on perturbations, JSON keys, paths
 * ------------------------------------------------------------------------------------------------------- */

function stageUnknownItem(where: 'expect' | 'recovery'): BankItem {
  const id = `${P}.stage-unknown.${where}`;
  return gitem(
    FAMILY,
    id,
    where === 'expect' ? 2 : 3,
    CORE_PKG,
    'stage-unknown-listed',
    where === 'expect'
      ? 'with stages listed, expect.stage naming a listed stage loads and one naming no listed stage is STAGE_UNKNOWN'
      : 'with stages listed, recovery.stage_after naming a listed stage loads and one naming no listed stage is STAGE_UNKNOWN',
    async (ctx) => {
      const [s1, s2, out] = [tok(ctx, id, 's1', 6), tok(ctx, id, 's2', 6), tok(ctx, id, 'out', 6)];
      const make = (stage: string) => ({
        id: tok(ctx, id, 'spec', 8),
        stages: [s1, s2],
        blocks: [
          { id: 'b0', user: tok(ctx, id, 'u0', 9), expect: where === 'expect' ? { stage } : { must: ['x'] } },
          { id: 'b1', user: tok(ctx, id, 'u1', 9), expect: { must: ['y'] } },
        ],
        ...(where === 'recovery'
          ? {
              perturbations: [
                {
                  id: 'p0',
                  class: 'D1_off_topic',
                  inject_at: 1,
                  user: tok(ctx, id, 'pu', 9),
                  recovery: { within_blocks: 1, stage_after: stage },
                },
              ],
            }
          : {}),
      });
      const good = loadIssues(ctx.product, make(s2));
      const bad = loadIssues(ctx.product, make(out));
      return [
        !good.ok && `naming the listed stage ${s2} should load; the loader refuses it: ${show(good.codes)}`,
        bad.ok && `naming ${out}, not in stages ${show([s1, s2])}, should be STAGE_UNKNOWN; the spec loads`,
        !bad.ok &&
          !bad.codes.includes('STAGE_UNKNOWN') &&
          `naming ${out} should be STAGE_UNKNOWN; the codes are ${show(bad.codes)}`,
      ];
    },
  );
}

/** `spec validate` or `spec lint` with --json on files of the item's folder, by file name. */
async function checkFiles(
  ctx: ItemContext,
  tag: string,
  command: 'validate' | 'lint',
  files: Record<string, unknown>,
  extra: string[] = [],
): Promise<Map<string, CheckEntry> | string> {
  const dir = folder(ctx, tag);
  for (const [name, content] of Object.entries(files)) writeAt(join(dir, name), content);
  const result = await cli(ctx, ['spec', command, ...Object.keys(files), ...extra, '--json'], dir);
  const entries = parseEntries(result.out);
  if (typeof entries === 'string')
    return `spec ${command} --json printed ${entries} (exit ${result.code}; ${result.err.slice(0, 120)})`;
  const byName = new Map<string, CheckEntry>();
  for (const name of Object.keys(files)) {
    const entry = entries.find((each) => (each.path ?? '').endsWith(name));
    if (entry) byName.set(name, entry);
  }
  return byName;
}

const schemaCodes = (codes: string[]) => codes.filter((code) => code.startsWith('SCHEMA_'));

function layerItem(which: 'alias' | 'stimulus'): BankItem {
  const id = `${P}.check-layers.${which}`;
  return gitem(
    FAMILY,
    id,
    3,
    CLI_PKG,
    'check-layers-gate',
    which === 'alias'
      ? 'a spec with an alias conflict and an unknown key reports SPEC_ALIAS_CONFLICT alone; without the conflict the unknown key is a SCHEMA_ error'
      : 'a spec with a block that has no stimulus and an unknown key in another block reports BLOCK_STIMULUS_MISSING alone; with the stimulus the key is a SCHEMA_ error',
    async (ctx) => {
      const key = `x${tok(ctx, id, 'key', 6)}`;
      const fact = tok(ctx, id, 'fact', 6);
      const base = (layered: boolean): Record<string, unknown> => {
        const user = tok(ctx, id, 'u', 9);
        if (which === 'alias')
          return {
            id: tok(ctx, id, layered ? 'a' : 'b', 8),
            ledger_seed: { [fact]: 'one' },
            ...(layered ? { given: { ledger: { [fact]: 'one' } } } : {}),
            [key]: 1,
            blocks: [{ user, expect: { must: ['x'] } }],
          };
        return {
          id: tok(ctx, id, layered ? 'a' : 'b', 8),
          blocks: [
            layered ? { expect: { must: ['x'] } } : { user, expect: { must: ['x'] } },
            { user: `${user}2`, expect: { must: ['y'], [key]: 1 } },
          ],
        };
      };
      const got = await checkFiles(ctx, id, 'validate', {
        'layered.yaml': base(true),
        'plain.yaml': base(false),
      });
      if (typeof got === 'string') return [got];
      const layered = codesOf(got.get('layered.yaml')?.errors);
      const plain = codesOf(got.get('plain.yaml')?.errors);
      const first = which === 'alias' ? 'SPEC_ALIAS_CONFLICT' : 'BLOCK_STIMULUS_MISSING';
      return [
        schemaCodes(plain).length === 0 &&
          `the spec with only the unknown key ${key} should report a SCHEMA_ error; it reports ${show(plain)}`,
        !layered.includes(first) && `the layered spec should report ${first}; it reports ${show(layered)}`,
        schemaCodes(layered).length > 0 &&
          `a later layer runs only when the earlier ones pass: with ${first} the schema error should not show; it reports ${show(layered)}`,
      ];
    },
  );
}

function verifierItem(which: 'tool-known' | 'summary'): BankItem {
  const id = `${P}.given-verifier-perturbation.${which}`;
  return gitem(
    FAMILY,
    id,
    4,
    CLI_PKG,
    'given-verifier-perturbation-worlds',
    which === 'tool-known'
      ? 'spec lint warns GIVEN_UNMET (tool_known) when a perturbation forces a tool metadata.tool_schemas lacks, and not when it forces a declared one'
      : 'spec lint --summaries warns GIVEN_SUMMARY_MISSING when a perturbation names a workspace folder with no summary, and not when it has one',
    async (ctx) => {
      const known = tok(ctx, id, 'known', 7);
      const other = tok(ctx, id, 'other', 7);
      const world = (bad: boolean) =>
        which === 'tool-known'
          ? { tools: { [bad ? other : known]: { error: 'down' } } }
          : {
              workspace: {
                from: `./${tok(ctx, id, 'seed', 6)}`,
                ...(bad ? {} : { summary: 'Two planted text files.' }),
              },
            };
      const spec = (bad: boolean, onBlock = false): Record<string, unknown> => ({
        id: tok(ctx, id, onBlock ? 'block' : bad ? 'bad' : 'good', 8),
        ...(which === 'tool-known'
          ? {
              metadata: {
                tool_schemas: { [known]: { type: 'object', properties: { q: { type: 'string' } } } },
              },
            }
          : {}),
        blocks: [
          { id: 'b0', user: tok(ctx, id, 'u0', 9), expect: { must: ['x'] } },
          {
            id: 'b1',
            user: tok(ctx, id, 'u1', 9),
            expect: { must: ['y'] },
            ...(onBlock ? { given: { world: world(bad) } } : {}),
          },
        ],
        ...(onBlock
          ? {}
          : {
              perturbations: [
                {
                  id: 'p0',
                  class: 'D8_tool_failure',
                  inject_at: 1,
                  world: world(bad),
                  recovery: { within_blocks: 1 },
                },
              ],
            }),
      });
      const got = await checkFiles(
        ctx,
        id,
        'lint',
        { 'bad.yaml': spec(true), 'good.yaml': spec(false), 'block.yaml': spec(true, true) },
        which === 'summary' ? ['--summaries'] : [],
      );
      if (typeof got === 'string') return [got];
      const code = which === 'tool-known' ? 'GIVEN_UNMET' : 'GIVEN_SUMMARY_MISSING';
      const bad = got.get('bad.yaml');
      const good = got.get('good.yaml');
      const badHits = (bad?.warnings ?? []).filter((each) => each.code === code);
      const onBlock = codesOf(got.get('block.yaml')?.warnings);
      return [
        // The same world on a block's given is read (the control): the perturbation's world must be read alike.
        !onBlock.includes(code) &&
          `the same world on a block's given should give ${code}; the warnings are ${show(onBlock)}`,
        bad?.ok !== true &&
          `the spec with the bad perturbation should be valid; it is ${show(codesOf(bad?.errors))}`,
        good?.ok !== true &&
          `the spec with the good perturbation should be valid; it is ${show(codesOf(good?.errors))}`,
        badHits.length === 0 &&
          `the perturbation's world should give ${code}; the warnings are ${show(codesOf(bad?.warnings))}`,
        which === 'tool-known' &&
          badHits.length > 0 &&
          !badHits.some((each) => (each.message ?? '').includes('tool_known')) &&
          `the GIVEN_UNMET warning should name the check tool_known first; it reads ${show(badHits[0]?.message)}`,
        codesOf(good?.warnings).includes(code) &&
          `the perturbation whose world ${which === 'tool-known' ? 'forces a declared tool' : 'has a summary'} should give no ${code}; it does`,
      ];
    },
  );
}

function duplicateKeyItem(): BankItem {
  const id = `${P}.json-duplicate-key`;
  return gitem(
    FAMILY,
    id,
    3,
    CLI_PKG,
    'json-duplicate-key',
    'a .spec.json file that writes a key twice in one object is SPEC_PARSE; the same file without the repeat is valid',
    async (ctx) => {
      const user = tok(ctx, id, 'u', 9);
      const other = tok(ctx, id, 'v', 9);
      const body = (repeat: boolean) =>
        `{\n  "id": "${tok(ctx, id, repeat ? 'r' : 'p', 8)}",\n  "blocks": [\n    { "user": "${user}",${repeat ? ` "user": "${other}",` : ''} "expect": { "must": ["x"] } }\n  ]\n}\n`;
      const got = await checkFiles(ctx, id, 'validate', {
        'twice.spec.json': body(true),
        'once.spec.json': body(false),
      });
      if (typeof got === 'string') return [got];
      const twice = got.get('twice.spec.json');
      const once = got.get('once.spec.json');
      return [
        once?.ok !== true &&
          `the file without a repeated key should be valid; it is ${show(codesOf(once?.errors))}`,
        twice?.ok !== false &&
          'the file that writes "user" twice in one block should be invalid; it is valid',
        twice?.ok === false &&
          !codesOf(twice.errors).includes('SPEC_PARSE') &&
          `the file that writes "user" twice should be SPEC_PARSE; it is ${show(codesOf(twice.errors))}`,
      ];
    },
  );
}

function missingPathItem(): BankItem {
  const id = `${P}.missing-path.coverage`;
  return gitem(
    FAMILY,
    id,
    3,
    CLI_PKG,
    'missing-path-spec-parse',
    'spec coverage reports a spec path that does not exist as an invalid spec with SPEC_PARSE, beside a valid spec that counts',
    async (ctx) => {
      const dir = folder(ctx, id);
      const missing = `${tok(ctx, id, 'gone', 8)}.yaml`;
      writeAt(join(dir, 'present.yaml'), {
        id: tok(ctx, id, 'spec', 8),
        covers: ['B-001'],
        blocks: [{ user: tok(ctx, id, 'u', 9), expect: { must: ['x'] } }],
      });
      writeAt(join(dir, 'inventory.yaml'), {
        behaviours: [{ id: 'B-001', title: 'Greets the rider by name' }],
        flows: [{ id: 'rental', title: 'A weekend rental', behaviours: ['B-001'] }],
      });
      const both = await cli(
        ctx,
        ['spec', 'coverage', 'present.yaml', missing, '--inventory', 'inventory.yaml', '--json'],
        dir,
      );
      const alone = await cli(
        ctx,
        ['spec', 'coverage', 'present.yaml', '--inventory', 'inventory.yaml', '--json'],
        dir,
      );
      const said = `${both.out}\n${both.err}`;
      const named = said.includes(missing) && said.includes('SPEC_PARSE');
      return [
        alone.code !== 0 &&
          `with the present spec alone, B-001 is covered and the command exits 0; it exits ${alone.code}: ${alone.err.slice(0, 120)}`,
        alone.out.includes('SPEC_PARSE') && 'with the present spec alone, no SPEC_PARSE should show',
        !named &&
          `the path ${missing} does not exist: it should be reported as an invalid spec with SPEC_PARSE; exit ${both.code}, the output reads "${said.replace(/\s+/g, ' ').slice(0, 200)}"`,
      ];
    },
  );
}

export function toolItems(): BankItem[] {
  return [
    exactOrderItem('range'),
    exactOrderItem('max-only'),
    toolF1Item(),
    safetyItem('cap'),
    safetyItem('confirm'),
    ...FLOW_CASES.map(flowItem),
    flowEvidenceItem('went-back'),
    flowEvidenceItem('pass'),
    stageUnknownItem('expect'),
    stageUnknownItem('recovery'),
    layerItem('alias'),
    layerItem('stimulus'),
    verifierItem('tool-known'),
    verifierItem('summary'),
    duplicateKeyItem(),
    missingPathItem(),
  ];
}
