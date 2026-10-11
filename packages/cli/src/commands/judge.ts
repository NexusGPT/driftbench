import { relative, resolve } from 'node:path';
import {
  type CouncilMode,
  type CouncilResult,
  cassettePlayers,
  createCouncil,
  fixtureRequest,
  type LoadedCriterion,
  loadCassette,
  loadCriteria,
} from '@driftbench/judges';
import type { Command } from 'commander';
import type { Io } from '../io';

const MODES: readonly CouncilMode[] = ['system1', 'hybrid', 'llm'];

export type JudgeRunOptions = {
  criteria?: string;
  cassette?: string;
  mode: string;
  agentFamily: string;
  cascade?: boolean;
  json?: boolean;
};

/**
 * `driftbench judge`: the judge council. `judge run` replays a council on recorded answers (a cassette)
 * over every fixture pair of a criteria folder and reports which criteria it separates. `judge check`
 * validates a criteria folder and its fixture pairs. Neither calls a model.
 */
export function registerJudgeCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const judge = program
    .command('judge')
    .description(
      'Judge criteria with the council: replay recorded answers, or validate criteria and fixtures',
    );

  judge
    .command('run')
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
    .option('--json', 'print one JSON document')
    .action(async (options: JudgeRunOptions) => {
      setExit(await judgeRunCommand(options, io));
    });

  judge
    .command('check')
    .description('Validate a criteria folder: each criterion, its FAIL and PASS pictures, its fixture pair')
    .argument('<criteria>', 'the criteria folder')
    .option('--json', 'print one JSON document')
    .action(async (dir: string, options: { json?: boolean }) => {
      setExit(await judgeCheckCommand(dir, options, io));
    });
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
  const criteriaDir = resolve(io.cwd, options.criteria);
  const loaded = await loadCriteria(criteriaDir);
  if (loaded.issues.length > 0) {
    for (const issue of loaded.issues) io.err(`${show(io, issue.path)}: ${issue.message}\n`);
    io.err(`judge run: the criteria folder has ${loaded.issues.length} issue(s); run judge check first.\n`);
    return 2;
  }

  let council: ReturnType<typeof createCouncil>;
  try {
    const cassette = await loadCassette(resolve(io.cwd, options.cassette));
    council = createCouncil({
      mode: options.mode as CouncilMode,
      agentFamily: options.agentFamily,
      judges: cassettePlayers(cassette),
      ...(options.cascade ? { cascade: true } : {}),
    });
  } catch (cause) {
    io.err(`judge run: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }

  const rows: CriterionRow[] = [];
  for (const criterion of loaded.criteria) rows.push(await judgeCriterion(council, criterion));
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
      `${row.separated ? 'separated' : 'NOT separated'}  ${row.criterion} [${row.cls}${row.gating ? ', gating' : ''}]: ${fixtures}\n`,
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
  return {
    criterion: criterion.def.name,
    cls: row.cls,
    gating: criterion.def.gating === true,
    separated: fixtures.every((f) => f.outcome === f.fixture),
    fixtures,
  };
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
