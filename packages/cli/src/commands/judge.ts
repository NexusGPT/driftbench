import { writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  assignmentTable,
  type CalibrationReport,
  type CascadeReport,
  type CouncilAssignment,
  type CouncilMode,
  type CouncilResult,
  type CriterionCalibration,
  calibrate,
  calibrateCascade,
  cassettePlayers,
  councilAssignment,
  createCouncil,
  createDefaultJudge,
  criteriaJudge,
  DEFAULT_REPEATS,
  emptyCassette,
  fixtureRequest,
  type JudgeClient,
  JudgeError,
  type LoadedCriterion,
  loadAssignmentTable,
  loadCassette,
  loadCriteria,
  loadLabels,
  recordingClient,
  saveCassette,
  writeAssignmentTable,
} from '@agent-nexus/driftbench-judges';
import type { Command } from 'commander';
import type { Io } from '../io';
import {
  addRouteOptions,
  escalationFrom,
  familyRefusal,
  type JudgeFlags,
  makeLiveJudge,
  panelFrom,
} from '../judge-options';
import {
  addJudgeSettingOptions,
  type JudgeSettingOptions,
  type JudgeSettings,
  judgeSettingsFrom,
} from '../judge-settings';
import { optionNumber } from '../number';
import { registerJudgeTools } from './judge-tools';

const MODES: readonly CouncilMode[] = ['system1', 'hybrid', 'llm'];

export type JudgeRunOptions = {
  criteria?: string;
  cassette?: string;
  mode: string;
  agentFamily: string;
  cascade?: boolean;
  assignments?: string;
  json?: boolean;
} & Pick<
  JudgeFlags,
  | 'judgeRoute'
  | 'routeFirst'
  | 'routeThen'
  | 'routeOn'
  | 'routeConfidence'
  | 'routeDecide'
  | 'panelWeights'
  | 'panelMargin'
> &
  JudgeSettingOptions;

export type JudgeCalibrateOptions = {
  criteria?: string;
  labels?: string;
  cassette?: string;
  out?: string;
  repeats: string;
  mode: string;
  agentFamily: string;
  claude?: string[];
  claudeCommand?: string;
  record?: string;
  spendCapUsd?: string;
  cascade?: boolean;
  assign: string;
  only?: string[];
  json?: boolean;
  /** Live judges as `kind:model`, beside --claude. */
  judge?: string[];
} & Pick<
  JudgeFlags,
  'judgeRoute' | 'routeFirst' | 'routeThen' | 'routeOn' | 'routeConfidence' | 'routeDecide'
> &
  JudgeSettingOptions;

/**
 * `driftbench judge`: the judge council. `judge run` replays a council on recorded answers (a cassette)
 * over every fixture pair of a criteria folder and reports which criteria it separates. `judge calibrate`
 * runs every judge alone on the fixture pairs and the hand-labelled blocks and writes which judges own
 * which criterion. `judge check` validates a criteria folder and its fixture pairs. None calls a model.
 */
export function registerJudgeCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const judge = program
    .command('judge')
    .description(
      'Judge criteria with the council: replay recorded answers, or validate criteria and fixtures',
    );

  const run = addJudgeSettingOptions(judge.command('run'))
    .description(
      'Replay a council on a cassette over every fixture pair, and report the criteria it separates',
    )
    .requiredOption(
      '--criteria <dir>',
      'the criteria folder: one YAML file per criterion with its fixture pair',
    )
    .requiredOption('--cassette <file>', 'the recorded answers, as a cassette JSON file')
    .option('--mode <mode>', `the council mode: ${MODES.join(', ')}`, 'hybrid')
    .option('--agent-family <family>', 'the model family of the agent under test, none for no model', 'none')
    .option('--cascade', 'run the cheapest judge first and stop on a sure pass')
    .option('--assignments <file>', 'the assignment table judge calibrate wrote')
    .option('--json', 'print one JSON document');
  addRouteOptions(run).action(async (options: JudgeRunOptions) => {
    setExit(await judgeRunCommand(options, io));
  });

  const calibrateCommand = addJudgeSettingOptions(judge.command('calibrate'))
    .description(
      'Run every judge on the fixture pairs and the hand-labelled blocks, and write which judge owns each criterion',
    )
    .requiredOption('--criteria <dir>', 'the criteria folder, with a fixture pair per criterion')
    .requiredOption(
      '--labels <dir>',
      'the labels folder: one YAML file of hand-labelled blocks per criterion',
    )
    .option('--cassette <file>', 'the recorded answers of every judge, as a cassette JSON file')
    .option(
      '--claude <model>',
      'add a live judge on the local claude command with this model, such as haiku; repeat for several. Paid calls',
      collectValues,
      [],
    )
    .option(
      '--judge <kind:model>',
      'add a live judge of this kind, such as openai:<model> or anthropic:<model> (keys from the environment); repeat for several. Paid calls',
      collectValues,
      [],
    )
    .option('--claude-command <path>', 'the claude command to run', 'claude')
    .option('--record <file>', 'save every live answer, with its cost, as a cassette to replay later')
    .option('--spend-cap-usd <usd>', 'stop calling live judges once their calls have cost this much')
    .option(
      '--cascade',
      'the first judge answers everything; the others only where it is unsure or disagrees with the label. Writes the cascade report as JSON to --out',
    )
    .option(
      '--assign <rule>',
      'council: three judges at the bar in one class; cheapest: the one cheapest judge at the bar, alone',
      'council',
    )
    .option('--only <criterion>', 'calibrate only this criterion; repeat for several', collectValues, [])
    .requiredOption('--out <file>', 'where to write the assignment table (YAML)')
    .option('--repeats <n>', 'how many times each judge answers each fixture', String(DEFAULT_REPEATS))
    .option('--mode <mode>', `the council mode the table is for: ${MODES.join(', ')}`, 'hybrid')
    .option('--agent-family <family>', 'the model family of the agent under test, none for no model', 'none')
    .option('--json', 'print the report as one JSON document')
    .option(
      '--judge-route <route>',
      'measure a deployable route, escalation: label-blind, as a run would route; writes the cascade report as JSON to --out',
    )
    .option(
      '--route-first <judge>',
      'with --judge-route escalation: the judge that answers first (an id or kind:model)',
    )
    .option(
      '--route-then <judge>',
      'with --judge-route escalation: a judge asked when a trigger fires; repeat for several',
      collectValues,
      [],
    )
    .option(
      '--route-on <triggers>',
      'with --judge-route escalation: the triggers, comma separated (default all four)',
    )
    .option(
      '--route-confidence <p>',
      'with --judge-route escalation: the low-confidence bar, from 0 to 1 (default 0.5)',
    )
    .option(
      '--route-decide <rule>',
      'with --judge-route escalation: majority or first-stands (default majority)',
    );
  calibrateCommand.action(async (options: JudgeCalibrateOptions) => {
    setExit(await judgeCalibrateCommand(options, io));
  });

  judge
    .command('check')
    .description('Validate a criteria folder: each criterion, its FAIL and PASS pictures, its fixture pair')
    .argument('<criteria>', 'the criteria folder')
    .option('--json', 'print one JSON document')
    .action(async (dir: string, options: { json?: boolean }) => {
      setExit(await judgeCheckCommand(dir, options, io));
    });

  registerJudgeTools(judge, io, setExit);
}

type FixtureRow = {
  readonly fixture: 'pass' | 'fail';
  readonly outcome: CouncilResult['outcome'];
  readonly cls: CouncilResult['cls'];
  readonly split: boolean;
  readonly cascaded: boolean;
  readonly errors: number;
  readonly votes: CouncilResult['votes'];
  readonly log: readonly string[];
};

type CriterionRow = {
  readonly criterion: string;
  readonly cls: string;
  readonly gating: boolean;
  /** Why calibration left the criterion unassigned; it then never gates. */
  readonly unassigned?: string;
  readonly separated: boolean;
  readonly fixtures: readonly FixtureRow[];
};

/** Exit 0 when every criterion is separated, 1 when one is not or a judge gave no answer, 2 on bad input. */
export async function judgeRunCommand(options: JudgeRunOptions, io: Io): Promise<number> {
  if (!options.criteria || !options.cassette) {
    io.err('judge run needs --criteria <dir> and --cassette <file>.\n');
    return 2;
  }
  if (!MODES.includes(options.mode as CouncilMode)) {
    io.err(`--mode takes ${MODES.join(', ')}, not "${options.mode}".\n`);
    return 2;
  }
  const settings = judgeSettingsFrom(options, io);
  if (settings === undefined) return 2;
  const criteriaDir = resolve(io.cwd, options.criteria);
  const loaded = await loadCriteria(criteriaDir);
  if (loaded.issues.length > 0) {
    for (const issue of loaded.issues) io.err(`${show(io, issue.path)}: ${issue.message}\n`);
    io.err(`judge run: the criteria folder has ${loaded.issues.length} issue(s); run judge check first.\n`);
    return 2;
  }

  const routed = options.judgeRoute !== undefined || options.panelWeights !== undefined;
  if (routed) return judgeRunRouted(options, loaded.criteria, settings, io);
  for (const [flag, value] of [
    ['--route-first', options.routeFirst],
    ['--route-then', options.routeThen?.length ? 'set' : undefined],
    ['--route-on', options.routeOn],
    ['--route-confidence', options.routeConfidence],
    ['--route-decide', options.routeDecide],
    ['--panel-margin', options.panelMargin],
  ] as const) {
    if (value !== undefined) {
      io.err(`judge run: ${flag} goes with --judge-route escalation or --panel-weights.\n`);
      return 2;
    }
  }
  let council: ReturnType<typeof createCouncil>;
  try {
    const cassette = await loadCassette(resolve(io.cwd, options.cassette));
    let earned: CouncilAssignment | undefined;
    if (options.assignments) {
      earned = councilAssignment(await loadAssignmentTable(resolve(io.cwd, options.assignments)));
      if (earned.mode !== options.mode) {
        throw new Error(
          `the assignment table is for mode ${earned.mode}, the run is in mode ${options.mode}`,
        );
      }
    }
    council = createCouncil({
      mode: options.mode as CouncilMode,
      agentFamily: options.agentFamily,
      judges: cassettePlayers(cassette).map((player) =>
        settings(
          criteriaJudge(
            player,
            loaded.criteria.map((criterion) => criterion.def),
          ),
        ),
      ),
      ...(earned ? { assignment: earned.assignment, unassigned: earned.unassigned } : {}),
      ...(options.cascade ? { cascade: true } : {}),
    });
  } catch (cause) {
    io.err(`judge run: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }

  const rows: CriterionRow[] = [];
  for (const criterion of loaded.criteria) rows.push(await judgeCriterion(council, criterion));
  return printJudgeRun(rows, options, io);
}

/**
 * `judge run --judge-route escalation` or `--panel-weights`: the recorded judges answer through the route or the
 * panel instead of a council, one client per fixture. The output is the council's, each fixture with its one
 * decision.
 */
async function judgeRunRouted(
  options: JudgeRunOptions,
  criteria: readonly LoadedCriterion[],
  settings: JudgeSettings,
  io: Io,
): Promise<number> {
  const fail = (message: string) => {
    io.err(`judge run: ${message}\n`);
    return 2;
  };
  if (options.judgeRoute !== undefined && options.panelWeights !== undefined)
    return fail('--judge-route and --panel-weights are two ways to decide: give one.');
  if (options.assignments !== undefined || options.cascade)
    return fail(
      'a route or a panel decides in place of the council: --assignments and --cascade go with the council.',
    );
  let client: JudgeClient;
  try {
    // Each player as the council's: the criteria's own settings, then the run-wide ones.
    const players = cassettePlayers(await loadCassette(resolve(io.cwd, options.cassette ?? ''))).map(
      (player) =>
        settings(
          criteriaJudge(
            player,
            criteria.map((criterion) => criterion.def),
          ),
        ),
    );
    const byId = new Map(players.map((player) => [player.id, player]));
    const built =
      options.judgeRoute !== undefined
        ? await escalationFrom(
            options,
            async (ref) => byId.get(ref.trim()) ?? `the cassette holds no judge ${ref}`,
          )
        : await panelFrom(options, players, io);
    if (typeof built === 'string') return fail(built);
    client = built.client;
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }
  const refused = await familyRefusal(client, options.agentFamily);
  if (refused !== undefined) return fail(refused);
  const rows: CriterionRow[] = [];
  for (const criterion of criteria) {
    const fixtures: FixtureRow[] = [];
    for (const fixture of ['pass', 'fail'] as const) {
      let outcome: CouncilResult['outcome'] = 'inconclusive';
      let errors = 0;
      let log: string;
      try {
        const result = await client.judge(fixtureRequest(criterion, fixture));
        outcome = result.unparsed ? 'inconclusive' : result.answer.outcome;
        log = result.answer.reasoning;
      } catch (cause) {
        errors = 1;
        log = `no answer: ${cause instanceof Error ? cause.message : String(cause)}`;
      }
      fixtures.push({
        fixture,
        outcome,
        cls: client.cls,
        split: false,
        cascaded: false,
        errors,
        votes: [{ judge: client.id, outcome }],
        log: [log],
      });
    }
    rows.push({
      criterion: criterion.def.name,
      cls: client.cls,
      gating: criterion.def.gating === true,
      separated: fixtures.every((f) => f.outcome === f.fixture),
      fixtures,
    });
  }
  return printJudgeRun(rows, options, io);
}

/** Prints the rows of `judge run`. Exit 0 when every criterion is separated, 1 when one is not or a judge gave no answer. */
function printJudgeRun(rows: readonly CriterionRow[], options: JudgeRunOptions, io: Io): number {
  const separated = rows.filter((row) => row.separated).length;
  const errors = rows.reduce((sum, row) => sum + row.fixtures.reduce((s, f) => s + f.errors, 0), 0);
  const code = separated === rows.length && errors === 0 ? 0 : 1;

  if (options.json) {
    io.out(
      `${JSON.stringify({ mode: options.mode, separated, criteria: rows.length, errors, rows }, null, 2)}\n`,
    );
    return code;
  }
  for (const row of rows) {
    const fixtures = row.fixtures
      .map(
        (f) =>
          `${f.fixture} fixture ${f.outcome}${f.split ? ' (split, re-judged)' : ''}${f.cascaded ? ' (cascade)' : ''}`,
      )
      .join(', ');
    io.out(
      `${row.separated ? 'separated' : 'NOT separated'}  ${row.criterion} [${row.cls}${row.gating ? ', gating' : ''}${row.unassigned ? ', unassigned: not gating' : ''}]: ${fixtures}\n`,
    );
    if (!row.separated) {
      for (const f of row.fixtures) for (const line of f.log) io.out(`    ${f.fixture}: ${line}\n`);
    }
  }
  io.out(`\n${separated} of ${rows.length} criteria separated in mode ${options.mode}`);
  io.out(
    errors > 0
      ? `; ${errors} judge call(s) gave no answer (a cassette miss or a recorded failure).\n`
      : '.\n',
  );
  return code;
}

async function judgeCriterion(
  council: ReturnType<typeof createCouncil>,
  criterion: LoadedCriterion,
): Promise<CriterionRow> {
  const fixtures: FixtureRow[] = [];
  for (const fixture of ['pass', 'fail'] as const) {
    const result = await council.judge(fixtureRequest(criterion, fixture), criterion.def.judge_class);
    fixtures.push({
      fixture,
      outcome: result.outcome,
      cls: result.cls,
      split: result.split,
      cascaded: result.cascaded,
      errors: result.errors,
      votes: result.votes,
      log: result.log,
    });
  }
  const row = council.assignmentFor(criterion.def.name, criterion.def.judge_class);
  const unassigned = council.unassignedReason(criterion.def.name);
  return {
    criterion: criterion.def.name,
    cls: row.cls,
    gating: criterion.def.gating === true && unassigned === undefined,
    ...(unassigned === undefined ? {} : { unassigned }),
    separated: fixtures.every((f) => f.outcome === f.fixture),
    fixtures,
  };
}

/**
 * Exit 0 when the table is written and every gating criterion is assigned, 1 when a gating criterion
 * stays unassigned or a judge gave no answer (the table is still written), 2 on bad input.
 */
export async function judgeCalibrateCommand(options: JudgeCalibrateOptions, io: Io): Promise<number> {
  const live = options.claude ?? [];
  const liveJudges = options.judge ?? [];
  if (
    !options.criteria ||
    !options.labels ||
    (!options.cassette && live.length === 0 && liveJudges.length === 0) ||
    !options.out
  ) {
    io.err(
      'judge calibrate needs --criteria <dir>, --labels <dir>, --out <file>, and --cassette <file>, --claude <model> or --judge <kind:model>.\n',
    );
    return 2;
  }
  if (options.judgeRoute !== undefined && options.cascade) {
    io.err(
      'judge calibrate: --judge-route measures the deployable route; --cascade the label-aware one: give one.\n',
    );
    return 2;
  }
  const cap = options.spendCapUsd === undefined ? undefined : optionNumber(options.spendCapUsd);
  if (cap !== undefined && !(Number.isFinite(cap) && cap > 0)) {
    io.err(`--spend-cap-usd takes a positive number, not "${options.spendCapUsd}".\n`);
    return 2;
  }
  if (!MODES.includes(options.mode as CouncilMode)) {
    io.err(`--mode takes ${MODES.join(', ')}, not "${options.mode}".\n`);
    return 2;
  }
  if (options.assign !== undefined && options.assign !== 'council' && options.assign !== 'cheapest') {
    io.err(`--assign takes council or cheapest, not "${options.assign}".\n`);
    return 2;
  }
  const repeats = optionNumber(options.repeats);
  if (!Number.isInteger(repeats) || repeats < 1) {
    io.err(`--repeats takes a whole number from 1, not "${options.repeats}".\n`);
    return 2;
  }
  const loaded = await loadCriteria(resolve(io.cwd, options.criteria));
  const labels = await loadLabels(resolve(io.cwd, options.labels));
  const issues = [...loaded.issues, ...labels.issues];
  const known = new Set(loaded.criteria.map((criterion) => criterion.def.name));
  for (const name of labels.labels.keys()) {
    if (!known.has(name))
      issues.push({ path: options.labels, message: `labels for an unknown criterion ${name}` });
  }
  if (issues.length > 0) {
    for (const issue of issues) io.err(`${show(io, issue.path)}: ${issue.message}\n`);
    io.err(`judge calibrate: ${issues.length} issue(s) in the criteria or the labels.\n`);
    return 2;
  }

  const settings = judgeSettingsFrom(options, io);
  if (settings === undefined) return 2;
  let report: CalibrationReport;
  const recorded = emptyCassette();
  try {
    const judges: JudgeClient[] = options.cassette
      ? cassettePlayers(await loadCassette(resolve(io.cwd, options.cassette))).map(settings)
      : [];
    const spend = { usd: 0 };
    const spendLedger = { spentUsd: 0, reservedUsd: 0, costIncomplete: false };
    for (const model of live) {
      let client: JudgeClient = createDefaultJudge({
        provider: 'claude-cli',
        id: `claude-${process.env.CLAUDE_JUDGE_MODEL?.trim() || model}`,
        ...(cap === undefined ? {} : { maxBudgetUsd: Math.min(0.1, cap), spendCapUsd: cap, spendLedger }),
        model,
        ...(options.claudeCommand ? { command: options.claudeCommand } : {}),
      });
      if (options.record) client = recordingClient(client, recorded);
      judges.push(capped(settings(client), spend, cap));
    }
    const named = new Map<string, JudgeClient>();
    for (const spec of liveJudges) {
      let client = await makeLiveJudge(spec, { claudeCommand: options.claudeCommand });
      if (options.record) client = recordingClient(client, recorded);
      const wrapped = capped(settings(client), spend, cap);
      judges.push(wrapped);
      named.set(spec, wrapped);
    }
    const only = options.only ?? [];
    const unknown = only.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      io.err(`judge calibrate: --only names no criterion ${unknown.join(', ')}.\n`);
      return 2;
    }
    const chosen =
      only.length > 0 ? loaded.criteria.filter((c) => only.includes(c.def.name)) : loaded.criteria;
    if (options.judgeRoute !== undefined) {
      const route = await escalationFrom(
        options,
        async (ref) =>
          named.get(ref.trim()) ??
          judges.find((judge) => judge.id === ref.trim()) ??
          `no judge ${ref}: name a judge id, or a --judge <kind:model> given`,
      );
      if (typeof route === 'string') {
        io.err(`judge calibrate: ${route}\n`);
        return 2;
      }
      const cascade = await calibrateCascade({
        judge: route.client,
        criteria: chosen,
        labels: labels.labels,
        repeats,
      });
      const out = resolve(io.cwd, options.out);
      await writeFile(out, `${JSON.stringify(cascade, null, 2)}\n`, 'utf8');
      if (options.record) await saveCassette(resolve(io.cwd, options.record), recorded);
      return printCascade(cascade, io, options, out, route.label);
    }
    for (const [flag, value] of [
      ['--route-first', options.routeFirst],
      ['--route-then', options.routeThen?.length ? 'set' : undefined],
      ['--route-on', options.routeOn],
      ['--route-confidence', options.routeConfidence],
      ['--route-decide', options.routeDecide],
    ] as const) {
      if (value !== undefined) {
        io.err(`judge calibrate: ${flag} goes with --judge-route escalation.\n`);
        return 2;
      }
    }
    if (options.cascade) {
      // The cascade writes a report, not an assignment table: the table's rule and mode do not apply to it.
      if (options.assign !== undefined && options.assign !== 'council') {
        io.err(
          `judge calibrate --cascade writes no assignment table: --assign ${options.assign} does not apply to it.\n`,
        );
        return 2;
      }
      if (options.mode !== 'hybrid') {
        io.err('judge calibrate --cascade writes no assignment table: --mode does not apply to it.\n');
        return 2;
      }
      const [head, ...rest] = judges;
      if (!head || rest.length === 0) {
        io.err('judge calibrate --cascade needs a first judge and at least one to escalate to.\n');
        return 2;
      }
      const cascade = await calibrateCascade({
        first: head,
        escalateTo: rest,
        criteria: chosen,
        labels: labels.labels,
        repeats,
        agentFamily: options.agentFamily,
      });
      const out = resolve(io.cwd, options.out);
      await writeFile(out, `${JSON.stringify(cascade, null, 2)}\n`, 'utf8');
      if (options.record) await saveCassette(resolve(io.cwd, options.record), recorded);
      return printCascade(cascade, io, options, out);
    }
    report = await calibrate({
      judges,
      criteria: chosen,
      ...(options.assign === 'cheapest' ? { rule: 'cheapest' as const } : {}),
      labels: labels.labels,
      repeats,
      mode: options.mode as CouncilMode,
      agentFamily: options.agentFamily,
    });
  } catch (cause) {
    io.err(`judge calibrate: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
  const out = resolve(io.cwd, options.out);
  await writeAssignmentTable(out, assignmentTable(report));
  if (options.record) await saveCassette(resolve(io.cwd, options.record), recorded);

  const unassigned = report.criteria.filter((c) => c.assignment.status === 'unassigned');
  const gatingUnassigned = unassigned.filter((c) => c.gating);
  const code = gatingUnassigned.length > 0 || report.errors > 0 ? 1 : 0;
  if (options.json) {
    io.out(`${JSON.stringify({ ...report, table: show(io, out) }, null, 2)}\n`);
    return code;
  }
  for (const criterion of report.criteria) io.out(describeCalibration(criterion, report));
  const pooled = report.pooled
    .map(
      (row) =>
        `${row.judge} ${row.kappa === undefined ? 'n/a' : row.kappa.toFixed(2)} (${row.agree}/${row.n})`,
    )
    .join(', ');
  io.out(`Kappa over every labelled block: ${pooled}.\n`);
  if (report.excluded.length > 0) {
    io.out(`Left out, same family as the agent: ${report.excluded.join(', ')}.\n`);
  }
  io.out(
    `\n${report.criteria.length - unassigned.length} of ${report.criteria.length} criteria assigned in mode ${report.mode} (${report.repeats} repeats, kappa at least ${report.kappaMin}).`,
  );
  if (unassigned.length > 0) {
    io.out(
      ` Unassigned, judged but never gating: ${unassigned.map((c) => `${c.criterion}${c.gating ? ' (declared gating)' : ''}`).join(', ')}.`,
    );
  }
  if (report.errors > 0) io.out(` ${report.errors} judge call(s) gave no answer.`);
  if (report.spentUsd > 0) io.out(` Spent ${report.spentUsd.toFixed(4)} USD.`);
  io.out(
    `\nWrote ${show(io, out)}${options.record ? ` and ${show(io, resolve(io.cwd, options.record))}` : ''}.\n`,
  );
  return code;
}

function describeCalibration(criterion: CriterionCalibration, report: CalibrationReport): string {
  const a = criterion.assignment;
  const head =
    a.status === 'assigned'
      ? a.judges.length === 1
        ? `${criterion.criterion}${criterion.gating ? ' [gating]' : ''}: owned by ${a.owner} alone (${a.cls})${perCall(criterion, a.owner)}`
        : `${criterion.criterion}${criterion.gating ? ' [gating]' : ''}: owned by ${a.owner} (${a.cls}: ${a.judges.join(', ')}${a.rejudge.length > 0 ? `; re-judge ${a.rejudge.join(', ')}` : ''})${a.singleFamily ? ` [single family: ${a.singleFamily}]` : ''}`
      : `${criterion.criterion}${criterion.gating ? ' [gating]' : ''}: UNASSIGNED, judged but not gating: ${a.reason}`;
  const lines = [head];
  for (const row of criterion.judges) {
    const kappa = row.labels.kappa === undefined ? 'n/a' : row.labels.kappa.toFixed(2);
    const interval = `[${row.labels.agreement.lower.toFixed(2)}, ${row.labels.agreement.upper.toFixed(2)}]`;
    lines.push(
      `    ${row.judge.padEnd(18)} ${row.cls}  separation ${row.separation.separated}/${row.separation.repeats}  kappa ${kappa.padStart(5)}  agreement ${row.labels.agree}/${row.labels.n} ${interval}  ${row.meetsBar ? 'at the bar' : `misses: ${row.misses.join('; ')}`}`,
    );
  }
  lines.push(
    `    alpha across judges ${criterion.alpha === undefined ? 'n/a' : criterion.alpha.toFixed(2)}; bar: ${report.repeats}/${report.repeats} separation and kappa ${report.kappaMin}`,
  );
  for (const group of criterion.labelConflicts ?? []) {
    lines.push(`    label conflict: ${group.join(', ')} hold one slice under both labels`);
  }
  if (criterion.fixtureLeaks && criterion.fixtureLeaks.length > 0) {
    lines.push(
      `    fixture leak: ${criterion.fixtureLeaks.join(', ')} equal a fixture of the criterion, which inflates agreement`,
    );
  }
  for (const warning of criterion.warnings ?? []) {
    lines.push(
      warning === 'few-labels'
        ? '    warning few-labels: a class has fewer than 5 labelled blocks, so kappa is loose'
        : `    warning ${warning}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Exit 0 when every file is valid, 1 when one has an issue, 2 when the folder cannot be read. */
export async function judgeCheckCommand(dir: string, options: { json?: boolean }, io: Io): Promise<number> {
  const path = resolve(io.cwd, dir);
  const { criteria, issues } = await loadCriteria(path);
  const unreadable = issues.some((issue) => issue.message.startsWith('cannot read the folder'));
  const code = unreadable ? 2 : issues.length > 0 ? 1 : 0;
  if (options.json) {
    const out = {
      valid: criteria.map((c) => ({
        criterion: c.def.name,
        file: show(io, c.path),
        judge_class: c.def.judge_class ?? 'auto',
        gating: c.def.gating === true,
        scope: c.def.scope ?? 'block',
      })),
      issues: issues.map((issue) => ({ file: show(io, issue.path), message: issue.message })),
    };
    io.out(`${JSON.stringify(out, null, 2)}\n`);
    return code;
  }
  for (const c of criteria) {
    const pass = c.fixtures.pass.transcript.length;
    const fail = c.fixtures.fail.transcript.length;
    io.out(
      `ok  ${c.def.name} [${c.def.judge_class ?? 'auto'}${c.def.gating ? ', gating' : ''}]: pass fixture ${pass} line(s), fail fixture ${fail} line(s)\n`,
    );
  }
  for (const issue of issues) io.err(`${show(io, issue.path)}: ${issue.message}\n`);
  io.out(`\n${criteria.length} valid criteria, ${issues.length} issue(s).\n`);
  return code;
}

function show(io: Io, path: string): string {
  const rel = relative(io.cwd, path);
  return rel === '' ? '.' : rel;
}

function collectValues(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/**
 * A live judge under a shared spend cap: once the calls of every capped judge have cost `cap` US dollars,
 * the next call gives no answer instead of spending more.
 */
function capped(client: JudgeClient, spend: { usd: number }, cap: number | undefined): JudgeClient {
  return {
    id: client.id,
    family: client.family,
    cls: client.cls,
    ...(client.model ? { model: client.model } : {}),
    cost: client.cost,
    async judge(request) {
      if (cap !== undefined && spend.usd >= cap) {
        throw new JudgeError('config', `the spend cap of ${cap} USD is reached: no more live calls`);
      }
      const result = await client.judge(request);
      spend.usd += result.costUsd ?? 0;
      return result;
    },
  };
}

/** Exit 0, or 1 when a call gave no answer. */
function printCascade(
  report: CascadeReport,
  io: Io,
  options: JudgeCalibrateOptions,
  out: string,
  route?: string,
): number {
  const errors = report.criteria.reduce((sum, c) => sum + c.errors, 0);
  if (options.json) {
    io.out(`${JSON.stringify(report, null, 2)}\n`);
    return errors > 0 ? 1 : 0;
  }
  io.out(
    route === undefined
      ? `Cascade: ${report.first} answers everything; ${report.escalateTo.join(' and ')} answer where it is unsure or disagrees with the label.\n`
      : `Route: ${route}, label-blind, as a run routes it; escalated items are the ones its triggers sent on.\n`,
  );
  const kappa = (k: number | undefined) => (k === undefined ? 'n/a' : k.toFixed(2));
  for (const c of report.criteria) {
    const ups = c.escalated.length === 0 ? 'none' : c.escalated.map((e) => `${e.item} (${e.why})`).join(', ');
    io.out(
      `${c.criterion}: separation ${c.separation.separated}/${c.separation.repeats}, kappa ${kappa(c.labels.kappa)} (${c.labels.agree}/${c.labels.n}), ${c.spentUsd.toFixed(4)} USD; escalated: ${ups}\n`,
    );
    io.out(
      `    unsure only: separation ${c.unsureOnly.separation.separated}/${c.unsureOnly.separation.repeats}, kappa ${kappa(c.unsureOnly.labels.kappa)} (${c.unsureOnly.labels.agree}/${c.unsureOnly.labels.n}), ${c.unsureOnly.spentUsd.toFixed(4)} USD\n`,
    );
  }
  io.out(
    `\nSpent ${report.spentUsd.toFixed(4)} USD${errors > 0 ? `; ${errors} call(s) gave no answer` : ''}. Wrote ${show(io, out)}${options.record ? ` and ${show(io, resolve(io.cwd, options.record))}` : ''}.\n`,
  );
  return errors > 0 ? 1 : 0;
}

/** The owner's measured cost per call on a criterion, when its client reported one. */
function perCall(criterion: CriterionCalibration, owner: string): string {
  const row = criterion.judges.find((judge) => judge.judge === owner);
  if (!row || row.spentUsd <= 0 || row.calls === 0) return '';
  return `, ${(row.spentUsd / row.calls).toFixed(4)} USD per call`;
}
