import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { loadSpecs } from '@agent-nexus/driftbench-core';
import {
  buildPrompt,
  type Cassette,
  type CassetteEntry,
  CriterionText,
  fixtureRequest,
  groundEvidence,
  groundEvidenceSpan,
  type JudgeRequest,
  type LabelledBlock,
  type LoadedCriterion,
  labelRequest,
  lintCriterion,
  loadCassette,
  loadCriteria,
  loadLabels,
  parseCriterionFile,
  requestKey,
  saveCassette,
  TranscriptEntry,
} from '@agent-nexus/driftbench-judges';
import type { Command } from 'commander';
import { parse as parseYaml } from 'yaml';
import type { Io } from '../io';

/**
 * The judge tools under `driftbench judge`: `ground` checks a quote against the data a judge saw, `lint`
 * lists the defects of rubrics, `prompt` prints the exact prompt a judge receives, and `cassette inspect` and
 * `cassette rekey` read and re-key recorded answers. None calls a model.
 */
export function registerJudgeTools(judge: Command, io: Io, setExit: (code: number) => void): void {
  judge
    .command('ground')
    .description(
      'Check that a quote is in the data a judge saw: the transcript, the artifact, the Given, the inputs, the reference',
    )
    .requiredOption('--quote <text>', 'the quoted evidence, as the judge wrote it')
    .option('--request <file>', 'the judge request, as a JSON file')
    .option('--criteria <dir>', 'the criteria folder, to build the request of a fixture instead')
    .option('--criterion <name>', 'the criterion whose fixture is the request, with --criteria')
    .option('--fixture <which>', 'the fixture: pass or fail', 'pass')
    .option('--source <place>', 'look only in this place, such as transcript.3, artifact, given or reference')
    .option('--json', 'print one JSON document')
    .action(async (options: GroundOptions) => {
      setExit(await judgeGroundCommand(options, io));
    });

  judge
    .command('lint')
    .description(
      'List the defects of each rubric and its pictures: two questions, taste words, no FAIL picture and others',
    )
    .argument('<paths...>', 'criterion files, spec files, or folders of them')
    .option('--json', 'print one JSON document')
    .action(async (paths: string[], options: { json?: boolean }) => {
      setExit(await judgeLintCommand(paths, options, io));
    });

  judge
    .command('prompt')
    .description('Print the exact prompt a judge receives for one request: the system text and the user text')
    .option('--request <file>', 'the judge request, as a JSON file')
    .option('--criteria <dir>', 'the criteria folder, to build the request of a fixture instead')
    .option('--criterion <name>', 'the criterion whose fixture is the request, with --criteria')
    .option('--fixture <which>', 'the fixture: pass or fail', 'pass')
    .option('--json', 'print one JSON document')
    .action(async (options: PromptOptions) => {
      setExit(await judgePromptCommand(options, io));
    });

  const cassette = judge
    .command('cassette')
    .description('Read and re-key cassettes: the recorded answers of judges');

  cassette
    .command('inspect')
    .description(
      'Print the judges, the entries per judge and per criterion, and the contracts of a cassette; with --criteria, which requests it answers',
    )
    .argument('<file>', 'the cassette JSON file')
    .option(
      '--criteria <dir>',
      'the criteria folder: count the fixture requests the cassette holds an answer for',
    )
    .option('--labels <dir>', 'the labels folder: count the labelled blocks too, with --criteria')
    .option('--json', 'print one JSON document')
    .action(async (file: string, options: InspectOptions) => {
      setExit(await cassetteInspectCommand(file, options, io));
    });

  cassette
    .command('rekey')
    .description(
      'Move recorded answers to the keys of changed criteria. Refuses when the change touches what the judge reads',
    )
    .argument('<file>', 'the cassette JSON file')
    .requiredOption('--from <dir>', 'the criteria folder the cassette was recorded with')
    .requiredOption('--criteria <dir>', 'the changed criteria folder')
    .option('--labels <dir>', 'the labels folder, to re-key the labelled blocks too')
    .option(
      '--rename <old=new>',
      'a criterion renamed from old to new; repeat for several',
      collectValues,
      [],
    )
    .requiredOption('--out <file>', 'where to write the re-keyed cassette; may be the same file')
    .option('--json', 'print one JSON document')
    .action(async (file: string, options: RekeyOptions) => {
      setExit(await cassetteRekeyCommand(file, options, io));
    });
}

type RequestOptions = { request?: string; criteria?: string; criterion?: string; fixture: string };
export type GroundOptions = RequestOptions & { quote: string; source?: string; json?: boolean };
export type PromptOptions = RequestOptions & { json?: boolean };
export type InspectOptions = { criteria?: string; labels?: string; json?: boolean };
export type RekeyOptions = {
  from: string;
  criteria: string;
  labels?: string;
  rename?: string[];
  out: string;
  json?: boolean;
};

type Loaded = { request: JudgeRequest; label: string } | { error: string };

/** The request of `--request <file>`, or of a fixture of `--criteria <dir> --criterion <name>`. */
async function requestOf(options: RequestOptions, io: Io, command: string): Promise<Loaded> {
  if ((options.request === undefined) === (options.criteria === undefined)) {
    return { error: `judge ${command} needs --request <file>, or --criteria <dir> with --criterion <name>.` };
  }
  if (options.request !== undefined) {
    const path = resolve(io.cwd, options.request);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, 'utf8'));
    } catch (cause) {
      return { error: `${show(io, path)}: ${message(cause)}` };
    }
    const problem = requestProblem(value);
    if (problem !== undefined) return { error: `${show(io, path)}: ${problem}` };
    return { request: value as JudgeRequest, label: show(io, path) };
  }
  if (options.criterion === undefined)
    return { error: `judge ${command} --criteria needs --criterion <name>.` };
  if (options.fixture !== 'pass' && options.fixture !== 'fail') {
    return { error: `--fixture takes pass or fail, not "${options.fixture}".` };
  }
  const found = await criterionIn(resolve(io.cwd, options.criteria as string), options.criterion, io);
  if ('error' in found) return found;
  return {
    request: fixtureRequest(found.criterion, options.fixture),
    label: `${options.criterion}, ${options.fixture} fixture`,
  };
}

/** Why a value is not a judge request: a criterion and a transcript are required, as the judge reads them. */
function requestProblem(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'a judge request is a JSON object';
  const request = value as Record<string, unknown>;
  const criterion = CriterionText.safeParse(request.criterion);
  if (!criterion.success) {
    return `criterion: ${criterion.error.issues[0]?.path.join('.') || '(root)'} ${criterion.error.issues[0]?.message ?? ''}`.trim();
  }
  if (!Array.isArray(request.transcript)) return 'transcript: a list of entries is required';
  for (const [index, entry] of request.transcript.entries()) {
    const parsed = TranscriptEntry.safeParse(entry);
    if (!parsed.success) {
      return `transcript.${index}: ${parsed.error.issues[0]?.path.join('.') || '(root)'} ${parsed.error.issues[0]?.message ?? ''}`.trim();
    }
  }
  return undefined;
}

async function criterionIn(
  dir: string,
  name: string,
  io: Io,
): Promise<{ criterion: LoadedCriterion } | { error: string }> {
  const loaded = await loadCriteria(dir);
  const criterion = loaded.criteria.find((c) => c.def.name === name);
  if (criterion) return { criterion };
  const issue = loaded.issues.find((i) => i.path.endsWith(`${name}.yaml`) || i.path.endsWith(`${name}.yml`));
  if (issue) return { error: `${show(io, issue.path)}: ${issue.message}` };
  const names = loaded.criteria.map((c) => c.def.name);
  return {
    error: `the criteria folder ${show(io, dir)} has no valid criterion ${name}${names.length > 0 ? ` (it has ${names.join(', ')})` : ''}.`,
  };
}

/** The places of a request a quote can come from, in the order `groundEvidence` looks. */
function places(request: JudgeRequest): string[] {
  return [
    ...request.transcript.map((_, index) => `transcript.${index}`),
    ...(request.artifact === undefined ? [] : ['artifact']),
    ...(request.given === undefined ? [] : ['given']),
    ...(request.inputs ?? []).map((input) => `input.${input.path}`),
    ...(request.reference === undefined ? [] : ['reference']),
  ];
}

/** Exit 0 when the quote is grounded, 1 when it is not, 2 on bad input. */
export async function judgeGroundCommand(options: GroundOptions, io: Io): Promise<number> {
  const loaded = await requestOf(options, io, 'ground');
  if ('error' in loaded) {
    io.err(`${loaded.error}\n`);
    return 2;
  }
  const { request } = loaded;
  const grounding =
    options.source === undefined
      ? groundEvidence(request, { outcome: 'inconclusive', reasoning: '', evidence: options.quote })
      : groundEvidenceSpan(request, { source: options.source, quote: options.quote });
  const known = places(request);
  if (options.json) {
    io.out(
      `${JSON.stringify(
        {
          request: loaded.label,
          quote: options.quote,
          ...(options.source === undefined ? {} : { source: options.source }),
          grounded: grounding.grounded,
          ...(grounding.where === undefined ? {} : { where: grounding.where }),
          places: known,
        },
        null,
        2,
      )}\n`,
    );
    return grounding.grounded ? 0 : 1;
  }
  if (grounding.grounded) {
    io.out(`grounded in ${grounding.where}\n`);
    return 0;
  }
  io.out(
    options.source === undefined
      ? 'NOT grounded: no data place holds the quote.\n'
      : `NOT grounded in ${options.source}.\n`,
  );
  io.out(`The places of ${loaded.label}: ${known.join(', ')}.\n`);
  return 1;
}

/** Exit 0 always on a printed prompt, 2 on bad input. */
export async function judgePromptCommand(options: PromptOptions, io: Io): Promise<number> {
  const loaded = await requestOf(options, io, 'prompt');
  if ('error' in loaded) {
    io.err(`${loaded.error}\n`);
    return 2;
  }
  let prompt: { system: string; user: string };
  try {
    prompt = buildPrompt(loaded.request);
  } catch (cause) {
    io.err(`judge prompt: ${message(cause)}\n`);
    return 2;
  }
  if (options.json) {
    io.out(`${JSON.stringify({ request: loaded.label, ...prompt }, null, 2)}\n`);
    return 0;
  }
  io.out(`=== system (${loaded.label}) ===\n${prompt.system}\n\n=== user ===\n${prompt.user}\n`);
  return 0;
}

/** What each lint code means, as the user reads it. */
const LINT_MEANINGS: Readonly<Record<string, string>> = {
  'two-questions': 'more than one question mark: one verdict cannot answer two questions',
  subjective: 'a taste word, such as good or appropriate: two judges read it two ways',
  'vague-quantity': 'a quantity word, such as some or often, that hides the count',
  'double-negative': 'two negations in one sentence',
  'no-observable': 'names nothing a judge can read: no reply, agent, message, tool, call or user',
  'too-long': 'over 400 characters',
  'no-fail-picture': 'no FAIL picture',
  'no-pass-picture': 'no PASS picture',
  'same-pictures': 'the PASS and FAIL pictures are one text',
  'picture-contradicts-rubric': 'one picture is the other with "not" added',
  'scope-mismatch':
    'the rubric points at one reply in a conversation criterion, or at the whole conversation in a block one',
  placeholder: 'an unfilled slot, such as {plan} or <customer name>',
  'unbalanced-quotes': 'a quote opened and not closed',
  'empty-rubric': 'nothing to answer',
  compound: 'two checks in one rubric (and also, as well as)',
  hedged: 'a hedge (might, may, could) in the rubric or the PASS picture',
  'instruction-to-judge': 'the rubric tells the judge the verdict',
  'pictures-swapped': 'the PASS picture describes a failure, or the FAIL picture a pass',
};

type LintRow = { readonly criterion: string; readonly file: string; readonly issues: string[] };
const LINT_EXT = new Set(['.yaml', '.yml', '.json']);

/** Exit 0 when no rubric has a defect, 1 when one has, 2 when a path cannot be read or holds no criterion. */
export async function judgeLintCommand(
  paths: string[],
  options: { json?: boolean },
  io: Io,
): Promise<number> {
  const rows: LintRow[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const given of paths) {
    const path = resolve(io.cwd, given);
    let files: string[];
    let explicit: boolean;
    try {
      if ((await stat(path)).isDirectory()) {
        files = (await readdir(path))
          .filter((name) => LINT_EXT.has(extname(name)))
          .sort()
          .map((name) => resolve(path, name));
        explicit = false;
      } else {
        files = [path];
        explicit = true;
      }
    } catch (cause) {
      errors.push(`${given}: ${message(cause)}`);
      continue;
    }
    for (const file of files) {
      const found = await criteriaOf(file);
      if ('error' in found) {
        if (explicit) errors.push(`${show(io, file)}: ${found.error}`);
        else skipped.push(show(io, file));
        continue;
      }
      for (const criterion of found.criteria) {
        rows.push({
          criterion: criterion.name,
          file: show(io, file),
          issues: lintCriterion(criterion).issues.map((issue) => issue.code),
        });
      }
    }
  }
  if (errors.length === 0 && rows.length === 0) {
    errors.push(`no criterion in ${paths.join(', ')}: give criterion files, spec files, or folders of them`);
  }
  const flagged = rows.filter((row) => row.issues.length > 0).length;
  const code = errors.length > 0 ? 2 : flagged > 0 ? 1 : 0;
  if (options.json) {
    io.out(`${JSON.stringify({ criteria: rows, flagged, skipped, errors }, null, 2)}\n`);
    return code;
  }
  for (const error of errors) io.err(`judge lint: ${error}\n`);
  for (const row of rows) {
    if (row.issues.length === 0) {
      io.out(`ok  ${row.criterion} (${row.file})\n`);
      continue;
    }
    io.out(`${row.criterion} (${row.file}): ${row.issues.join(', ')}\n`);
    for (const issue of row.issues) io.out(`    ${issue}: ${LINT_MEANINGS[issue] ?? 'see the lint codes'}\n`);
  }
  if (skipped.length > 0) io.out(`Skipped, neither a criterion file nor a spec: ${skipped.join(', ')}.\n`);
  io.out(`\n${rows.length} criteria linted, ${flagged} with a defect.\n`);
  return code;
}

/** The criteria of one file: a criterion file (with `criterion` and `fixtures`), or a spec's `criteria`. */
async function criteriaOf(file: string): Promise<{ criteria: CriterionText[] } | { error: string }> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (cause) {
    return { error: message(cause) };
  }
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (cause) {
    return { error: `not YAML or JSON: ${message(cause)}` };
  }
  if (value && typeof value === 'object' && 'criterion' in value && 'fixtures' in value) {
    const loaded = parseCriterionFile(text, file);
    if ('issues' in loaded) return { error: loaded.issues.map((issue) => issue.message).join('; ') };
    return { criteria: [textOf(loaded.def)] };
  }
  const [spec] = await loadSpecs([file]);
  if (!spec?.ok) return { error: 'neither a criterion file nor a valid spec' };
  return { criteria: (spec.spec.criteria ?? []).map(textOf) };
}

function textOf(def: { name: string; rubric: string; pass?: string; fail?: string; scope?: string }) {
  return {
    name: def.name,
    rubric: def.rubric,
    ...(def.pass === undefined ? {} : { pass: def.pass }),
    ...(def.fail === undefined ? {} : { fail: def.fail }),
    ...(def.scope === 'conversation' || def.scope === 'block' ? { scope: def.scope } : {}),
  } satisfies CriterionText;
}

/**
 * How a cassette player keys a request for one judge: the contract and the decoder version the cassette
 * recorded for that judge, as `playerClient` applies them, then `requestKey` with the judge's settings.
 */
type Player = {
  readonly judge: Cassette['judges'][number];
  readonly contract: 'ledger' | 'legacy';
  readonly decoder: 1 | 2;
};

function playersOf(cassette: Cassette): Player[] {
  return cassette.judges.map((judge) => {
    const own = cassette.entries.filter((entry) => entry.judge === judge.id);
    return {
      judge,
      contract: own.some((entry) => entry.answerContract === 'ledger') ? 'ledger' : 'legacy',
      decoder: own.some((entry) => entry.criterionDecoderVersion === 2) ? 2 : 1,
    };
  });
}

/** The request as the player keys it, and as the judge reads it. */
function keyed(player: Player, request: JudgeRequest): JudgeRequest {
  let effective: JudgeRequest = request.answerContract
    ? request
    : { ...request, answerContract: player.contract };
  if (request.criterionDecoderVersion === undefined && player.decoder === 2) {
    effective = { ...effective, criterionDecoderVersion: 2 };
  }
  const { judge } = player;
  // A system 1 client that runs no procedure is always keyed, and read, under the legacy contract.
  return judge.cls === 'system1' && judge.families === undefined && judge.comparison === undefined
    ? { ...effective, answerContract: 'legacy' }
    : effective;
}

function keyOf(player: Player, request: JudgeRequest): string {
  return requestKey(keyed(player, request), player.judge);
}

/** One request a criteria folder sends: a fixture or a labelled block, at the normal or the large budget. */
type Sent = { readonly criterion: string; readonly item: string; readonly request: JudgeRequest };

function sentBy(
  criteria: readonly LoadedCriterion[],
  labels: ReadonlyMap<string, readonly LabelledBlock[]>,
  nameOf: (criterion: string) => string = (name) => name,
): Map<string, Sent[]> {
  const out = new Map<string, Sent[]>();
  for (const criterion of criteria) {
    const base: { item: string; request: JudgeRequest }[] = [
      { item: 'pass fixture', request: fixtureRequest(criterion, 'pass') },
      { item: 'fail fixture', request: fixtureRequest(criterion, 'fail') },
      ...(labels.get(nameOf(criterion.def.name)) ?? []).map((block) => ({
        item: `label ${block.id}`,
        request: labelRequest(criterion, block),
      })),
    ];
    out.set(
      criterion.def.name,
      base.flatMap(({ item, request }) =>
        (['normal', 'large'] as const).map((budget) => ({
          criterion: criterion.def.name,
          item: budget === 'large' ? `${item} (large budget)` : item,
          request: { ...request, budget },
        })),
      ),
    );
  }
  return out;
}

async function criteriaFolder(dir: string, io: Io): Promise<LoadedCriterion[] | string> {
  const loaded = await loadCriteria(dir);
  if (loaded.issues.length > 0) {
    return loaded.issues.map((issue) => `${show(io, issue.path)}: ${issue.message}`).join('\n');
  }
  return loaded.criteria;
}

async function labelsFolder(
  dir: string | undefined,
  io: Io,
): Promise<ReadonlyMap<string, readonly LabelledBlock[]> | string> {
  if (dir === undefined) return new Map();
  const loaded = await loadLabels(resolve(io.cwd, dir));
  if (loaded.issues.length > 0) {
    return loaded.issues.map((issue) => `${show(io, issue.path)}: ${issue.message}`).join('\n');
  }
  return loaded.labels;
}

type JudgeSummary = {
  id: string;
  family: string;
  cls: string;
  model?: string;
  settings?: string;
  entries: number;
  answers: number;
  raw: number;
  errors: number;
  contracts: Record<string, number>;
  decoderVersions: Record<string, number>;
  costUsd: number;
};

/** Exit 0 when the cassette is read, 2 when it cannot be. */
export async function cassetteInspectCommand(file: string, options: InspectOptions, io: Io): Promise<number> {
  const path = resolve(io.cwd, file);
  let cassette: Cassette;
  try {
    cassette = await loadCassette(path);
  } catch (cause) {
    io.err(`judge cassette inspect: ${message(cause)}\n`);
    return 2;
  }
  if (options.labels !== undefined && options.criteria === undefined) {
    io.err('judge cassette inspect --labels needs --criteria <dir>.\n');
    return 2;
  }
  const judges: JudgeSummary[] = cassette.judges.map((judge) => {
    const own = cassette.entries.filter((entry) => entry.judge === judge.id);
    return {
      id: judge.id,
      family: judge.family,
      cls: judge.cls,
      ...(judge.model === undefined ? {} : { model: judge.model }),
      ...(judge.settings === undefined ? {} : { settings: judge.settings }),
      entries: own.length,
      answers: own.filter((entry) => entry.error === undefined && entry.answer !== undefined).length,
      raw: own.filter((entry) => entry.error === undefined && entry.answer === undefined).length,
      errors: own.filter((entry) => entry.error !== undefined).length,
      contracts: tally(own.map((entry) => entry.answerContract ?? 'unmarked (legacy)')),
      decoderVersions: tally(own.map((entry) => String(entry.criterionDecoderVersion ?? 1))),
      costUsd: own.reduce((sum, entry) => sum + (entry.cost_usd ?? 0), 0),
    };
  });
  const perCriterion = new Map<string, Record<string, number>>();
  for (const entry of cassette.entries) {
    const name = entry.criterion ?? '(unnamed)';
    const row = perCriterion.get(name) ?? {};
    row[entry.judge] = (row[entry.judge] ?? 0) + 1;
    perCriterion.set(name, row);
  }
  const criteria = [...perCriterion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([criterion, byJudge]) => ({ criterion, byJudge }));

  let coverage:
    | {
        criteria: { criterion: string; requests: number; answered: number; missing: string[] }[];
        stale: number;
      }
    | undefined;
  if (options.criteria !== undefined) {
    const folder = await criteriaFolder(resolve(io.cwd, options.criteria), io);
    if (typeof folder === 'string') {
      io.err(`${folder}\njudge cassette inspect: the criteria folder has issues; run judge check first.\n`);
      return 2;
    }
    const labels = await labelsFolder(options.labels, io);
    if (typeof labels === 'string') {
      io.err(`${labels}\n`);
      return 2;
    }
    const players = playersOf(cassette);
    const held = new Set(cassette.entries.map((entry) => `${entry.judge} ${entry.key}`));
    const used = new Set<string>();
    const rows = [];
    for (const [criterion, sent] of sentBy(folder, labels)) {
      const missing: string[] = [];
      for (const one of sent) {
        // A request is answered when a judge holds its key. The large budget is asked only after an unparsed
        // answer, so its keys count as matched entries but never as missing.
        let hit = false;
        for (const player of players) {
          const key = `${player.judge.id} ${keyOf(player, one.request)}`;
          if (!held.has(key)) continue;
          used.add(key);
          hit = true;
        }
        if (!hit && !one.item.endsWith('(large budget)')) missing.push(one.item);
      }
      const requests = sent.filter((one) => !one.item.endsWith('(large budget)')).length;
      rows.push({ criterion, requests, answered: requests - missing.length, missing });
    }
    const stale = cassette.entries.filter((entry) => !used.has(`${entry.judge} ${entry.key}`)).length;
    coverage = { criteria: rows, stale };
  }

  const costUsd = judges.reduce((sum, judge) => sum + judge.costUsd, 0);
  if (options.json) {
    io.out(
      `${JSON.stringify(
        {
          file: show(io, path),
          version: cassette.version,
          entries: cassette.entries.length,
          costUsd,
          judges,
          criteria,
          ...(coverage === undefined ? {} : { coverage }),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }
  io.out(
    `${show(io, path)}: ${cassette.judges.length} judge(s), ${cassette.entries.length} entries, recorded cost ${costUsd.toFixed(4)} USD.\n`,
  );
  for (const judge of judges) {
    io.out(
      `  ${judge.id.padEnd(18)} ${judge.cls}  family ${judge.family}${judge.model ? `  model ${judge.model}` : ''}: ${judge.entries} entries (${judge.answers} answer, ${judge.raw} raw, ${judge.errors} error); contract ${describeTally(judge.contracts)}; decoder ${describeTally(judge.decoderVersions)}\n`,
    );
  }
  io.out('Entries per criterion:\n');
  for (const row of criteria) {
    io.out(`  ${row.criterion}: ${describeTally(row.byJudge)}\n`);
  }
  if (coverage !== undefined) {
    io.out('Requests of the criteria folder the cassette answers (a judge holds the key):\n');
    for (const row of coverage.criteria) {
      io.out(
        `  ${row.criterion}: ${row.answered} of ${row.requests}${row.missing.length > 0 ? `; no answer for ${row.missing.join(', ')}` : ''}\n`,
      );
    }
    io.out(
      `${coverage.stale} entr${coverage.stale === 1 ? 'y matches' : 'ies match'} no request of the folder${options.labels === undefined ? ' (labelled blocks are not counted without --labels)' : ''}.\n`,
    );
  }
  return 0;
}

type Move = { judge: string; criterion: string; item: string; from: string; to: string };
type Refusal = { judge: string; criterion: string; item: string; changes: string[] };

/**
 * Exit 0 when the cassette is re-keyed and written, 1 when the change touches what a judge reads (nothing
 * is written), 2 on bad input.
 */
export async function cassetteRekeyCommand(file: string, options: RekeyOptions, io: Io): Promise<number> {
  const path = resolve(io.cwd, file);
  let cassette: Cassette;
  try {
    cassette = await loadCassette(path);
  } catch (cause) {
    io.err(`judge cassette rekey: ${message(cause)}\n`);
    return 2;
  }
  const renames = new Map<string, string>();
  for (const pair of options.rename ?? []) {
    const match = /^([^=\s]+)=([^=\s]+)$/.exec(pair);
    if (!match) {
      io.err(`--rename takes old=new, not "${pair}".\n`);
      return 2;
    }
    renames.set(match[1] as string, match[2] as string);
  }
  const before = await criteriaFolder(resolve(io.cwd, options.from), io);
  const after = await criteriaFolder(resolve(io.cwd, options.criteria), io);
  for (const folder of [before, after]) {
    if (typeof folder === 'string') {
      io.err(`${folder}\njudge cassette rekey: a criteria folder has issues; run judge check first.\n`);
      return 2;
    }
  }
  const labels = await labelsFolder(options.labels, io);
  if (typeof labels === 'string') {
    io.err(`${labels}\n`);
    return 2;
  }
  const oldCriteria = before as LoadedCriterion[];
  const newCriteria = after as LoadedCriterion[];
  const newNames = new Set(newCriteria.map((c) => c.def.name));
  for (const [from, to] of renames) {
    if (!oldCriteria.some((c) => c.def.name === from)) {
      io.err(`--rename ${from}=${to}: ${options.from} has no criterion ${from}.\n`);
      return 2;
    }
    if (!newNames.has(to)) {
      io.err(`--rename ${from}=${to}: ${options.criteria} has no criterion ${to}.\n`);
      return 2;
    }
  }
  const newNameOf = (old: string) => renames.get(old) ?? old;
  const oldSent = sentBy(oldCriteria, labels, newNameOf);
  const newSent = sentBy(newCriteria, labels);

  const players = playersOf(cassette);
  const entriesAt = new Map<string, CassetteEntry[]>();
  for (const entry of cassette.entries) {
    const at = `${entry.judge} ${entry.key}`;
    entriesAt.set(at, [...(entriesAt.get(at) ?? []), entry]);
  }
  const moves: Move[] = [];
  const refusals: Refusal[] = [];
  const conflicts: string[] = [];
  for (const [oldName, sent] of oldSent) {
    const newName = newNameOf(oldName);
    const twins = newSent.get(newName);
    if (!twins) continue;
    const byItem = new Map(twins.map((one) => [one.item, one]));
    for (const one of sent) {
      const twin = byItem.get(one.item);
      if (!twin) continue;
      for (const player of players) {
        const from = keyOf(player, one.request);
        const to = keyOf(player, twin.request);
        if (from === to || !entriesAt.has(`${player.judge.id} ${from}`)) continue;
        const changes = promptChanges(keyed(player, one.request), keyed(player, twin.request));
        if (changes.length > 0) {
          refusals.push({ judge: player.judge.id, criterion: newName, item: one.item, changes });
          continue;
        }
        if (entriesAt.has(`${player.judge.id} ${to}`)) {
          conflicts.push(`${player.judge.id}, ${newName} ${one.item}: the new key ${to} already has entries`);
          continue;
        }
        moves.push({ judge: player.judge.id, criterion: newName, item: one.item, from, to });
      }
    }
  }

  if (refusals.length > 0 || conflicts.length > 0) {
    if (options.json) {
      io.out(`${JSON.stringify({ rekeyed: false, refusals, conflicts, moves: [] }, null, 2)}\n`);
      return refusals.length > 0 ? 1 : 2;
    }
    for (const refusal of refusals) {
      io.out(
        `refused  ${refusal.criterion} ${refusal.item}, judge ${refusal.judge}: the ${refusal.changes.join(' and ')} prompt changes\n`,
      );
    }
    for (const conflict of conflicts) io.err(`judge cassette rekey: ${conflict}\n`);
    if (refusals.length > 0) {
      io.out(
        `\nNothing written: the change touches what ${new Set(refusals.map((r) => r.judge)).size} judge(s) read on ${refusals.length} request(s). Record those answers again.\n`,
      );
      return 1;
    }
    return 2;
  }

  const moved = new Map(moves.map((move) => [`${move.judge} ${move.from}`, move]));
  const entries = cassette.entries.map((entry) => {
    const move = moved.get(`${entry.judge} ${entry.key}`);
    if (!move) return entry;
    return {
      ...entry,
      key: move.to,
      ...(entry.criterion === undefined ? {} : { criterion: move.criterion }),
    };
  });
  const changedEntries = cassette.entries.filter((entry) => moved.has(`${entry.judge} ${entry.key}`)).length;
  const out = resolve(io.cwd, options.out);
  await saveCassette(out, { ...cassette, entries });
  if (options.json) {
    io.out(
      `${JSON.stringify({ rekeyed: true, keys: moves.length, entries: changedEntries, moves, out: show(io, out) }, null, 2)}\n`,
    );
    return 0;
  }
  for (const move of moves) {
    io.out(`rekeyed  ${move.criterion} ${move.item}, judge ${move.judge}: ${move.from} -> ${move.to}\n`);
  }
  io.out(
    `\n${moves.length} key(s) moved (${changedEntries} entries); every prompt is unchanged. Wrote ${show(io, out)}.\n`,
  );
  return 0;
}

/** Which parts of the prompt differ between two requests: system, user, or none. */
function promptChanges(a: JudgeRequest, b: JudgeRequest): string[] {
  let left: { system: string; user: string };
  let right: { system: string; user: string };
  try {
    left = buildPrompt(a);
    right = buildPrompt(b);
  } catch {
    return ['whole'];
  }
  return [...(left.system === right.system ? [] : ['system']), ...(left.user === right.user ? [] : ['user'])];
}

function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

function describeTally(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([name, n]) => `${name} ${n}`);
  return parts.length === 0 ? 'none' : parts.join(', ');
}

function show(io: Io, path: string): string {
  const rel = relative(io.cwd, path);
  return rel === '' ? '.' : rel;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function collectValues(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
