import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseEstateMapText, parsePlanText } from '@agent-nexus/driftbench-estate';
import type { Command } from 'commander';
import { exists, show, writeOut } from '../files';
import type { Io } from '../io';
import * as estateCommands from './estate';
import { estateGenerateCommand } from './estate-generate';
import { estatePlanApproveCommand, estatePlanCommand } from './estate-plan';
import { usageSummary } from './estate-pointer';

export type EstateBuildOptions = estateCommands.EstateScanOptions & {
  /** The folder every file is written into. */
  out?: string;
  /** Answer yes to both approvals. */
  yes?: boolean;
  /** Print the full output of every command. */
  verbose?: boolean;
  phrases?: string;
  sessions?: string;
  /** The strength of the covering array of the plan. */
  t?: string;
};

export type EstateBuildDeps = estateCommands.EstateDeps & {
  /** True when a person can answer a question. Tests set it; by default, both standard streams are terminals. */
  interactive?: boolean;
  /** Asks one yes or no question. Tests pass a fake; by default a line is read from the terminal. */
  ask?: (question: string) => Promise<boolean>;
};

/** The folder `estate build` writes into when `--out` is not given. */
export const DEFAULT_BUILD_FOLDER = 'driftbench-build';
/** The record of what each stage read, so a second run skips a stage whose inputs have not changed. */
export const BUILD_STAMP_FILE = 'build.json';

/** Printed when the scan exits 1: the map is written, but a label was refused or a chunk failed. */
const SCAN_WARNING =
  '   The scan reported some refused labels or failed chunks; run with --verbose to read them.\n';

type Stamp = { version: 1; stages: Record<string, { input: string; code?: number }> };

const sha = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

/** The hash of a file, or `none` when it is not there. */
async function fileHash(path: string): Promise<string> {
  return (await exists(path)) ? sha(await readFile(path)) : 'none';
}

/** The hash of every file under a folder: path and bytes, in order. The folder `skip` names is left out. */
async function folderHash(root: string, skip: string): Promise<string> {
  const hash = createHash('sha256');
  const visit = async (dir: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (full === skip || entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile())
        hash
          .update(relative(root, full))
          .update('\0')
          .update(await readFile(full));
    }
  };
  await visit(root);
  return hash.digest('hex');
}

async function readStamp(path: string): Promise<Stamp> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Stamp;
    if (parsed.version === 1 && typeof parsed.stages === 'object') return parsed;
  } catch {
    // A missing or unreadable record means every stage runs.
  }
  return { version: 1, stages: {} };
}

/** An Io that keeps what a stage prints, and forwards it when the user asked for the full output. */
function stageIo(io: Io, verbose: boolean): { io: Io; lines: () => string[] } {
  let kept = '';
  return {
    io: {
      cwd: io.cwd,
      out: (text) => {
        kept += text;
        if (verbose) io.out(text);
      },
      err: (text) => io.err(text),
    },
    lines: () => kept.split('\n').filter((line) => line.trim() !== ''),
  };
}

async function askOnTerminal(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

/**
 * `driftbench estate build <folder>`: the whole chain from an estate to generated tests, in one folder.
 * It runs `estate scan`, approves the atoms, writes the space map and the plan, approves the plan rows and
 * runs `estate generate`. It asks before each approval; `--yes` answers both. A stage whose inputs did not
 * change since the last run is skipped.
 */
export function registerEstateBuildCommand(estate: Command, io: Io, setExit: (code: number) => void): void {
  estate
    .command('build')
    .description(
      'Run the whole chain on an estate: scan, approve, map, plan, approve, generate. Asks before each approval',
    )
    .argument('<root>', 'the estate folder (for claude-code, the project that holds CLAUDE.md and .claude/)')
    .option('--out <dir>', `the folder to write every file into (default ${DEFAULT_BUILD_FOLDER})`)
    .option('--yes', 'answer yes to both approvals; without it, a terminal is asked and anything else stops')
    .option('--verbose', 'print the full output of every command, as when you run them one by one')
    .option('--runtime <name>', 'the runtime that reads the estate', 'claude-code')
    .option('--replay <file>', 'replay recorded answers instead of calling a model')
    .option('--no-model', 'read the structured atoms only; no prose atom')
    .option('--provider <name>', 'anthropic or openai (default: the first whose key is set)')
    .option('--ignore <glob>', 'skip the paths this glob matches; repeat it', collect)
    .option(
      '--pointer',
      'read the prose with the pointer reader, and keep a ledger of unit ids in the folder',
    )
    .option('--labels <file>', 'with --pointer: the label sets (YAML)')
    .option('--cassette <file>', 'with --pointer: the recorded labeler answers (JSON lines)')
    .option('--record', 'with --pointer: call the labelers on a cassette miss and record the answer')
    .option('--labeler <spec>', 'with --pointer: <class>:<client>[:<model>]; repeat it', collect)
    .option('--prices <file>', 'with --pointer: a table of USD per million tokens (YAML), to print the cost')
    .option('--jobs <n>', 'with --pointer: requests in flight at once')
    .option('--phrases <file>', 'the approved phrase bank for estate generate')
    .option('--sessions <file>', 'the index of recorded sessions for estate generate')
    .option('--t <n>', 'the strength of the covering array of the plan', '2')
    .action(async (root: string, options: EstateBuildOptions) => {
      setExit(await estateBuildCommand(root, options, io));
    });
}

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

/**
 * Exit 0 when every stage ran and every generated test is complete, 1 when an approval was declined or
 * cannot be asked, or the suite holds incomplete tests, 2 on a usage or input error.
 */
export async function estateBuildCommand(
  rootArg: string,
  options: EstateBuildOptions,
  io: Io,
  deps: EstateBuildDeps = {},
): Promise<number> {
  const root = resolve(io.cwd, rootArg);
  if (!(await exists(root))) {
    io.err(`Cannot find ${show(root, io)}.\n`);
    return 2;
  }
  const out = resolve(io.cwd, options.out ?? DEFAULT_BUILD_FOLDER);
  const file = (name: string) => join(out, name);
  const shown = (name: string) => show(file(name), io);
  const interactive = deps.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  const ask = deps.ask ?? askOnTerminal;
  const verbose = options.verbose === true;
  const stampPath = file(BUILD_STAMP_FILE);
  const stamp = await readStamp(stampPath);
  const saveStamp = () => writeOut(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, io);

  io.out(`driftbench estate build ${show(root, io)}, into ${show(out, io)}\n`);

  // 1. Read the estate into a map.
  const replay = options.replay ? resolve(io.cwd, options.replay) : undefined;
  const cassette = options.cassette ? resolve(io.cwd, options.cassette) : undefined;
  const labels = options.labels ? resolve(io.cwd, options.labels) : undefined;
  const scanInput = sha(
    JSON.stringify([
      await folderHash(root, out),
      options.runtime ?? 'claude-code',
      options.model === false,
      options.provider ?? null,
      options.ignore ?? [],
      options.pointer === true,
      options.labeler ?? [],
      replay ? await fileHash(replay) : null,
      cassette ? await fileHash(cassette) : null,
      labels ? await fileHash(labels) : null,
    ]),
  );
  const scanned = stamp.stages.scan;
  if (scanned?.input === scanInput && (await exists(file('map.yaml')))) {
    io.out('1. Read the estate: unchanged since the last run, map.yaml kept.\n');
    if (scanned.code === 1) io.out(SCAN_WARNING);
  } else {
    const step = stageIo(io, verbose);
    const scanOptions: estateCommands.EstateScanOptions = {
      runtime: options.runtime ?? 'claude-code',
      out: file('map.yaml'),
      force: true,
      ...(options.replay ? { replay: replay as string } : {}),
      ...(options.model === false ? { model: false } : {}),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.ignore ? { ignore: options.ignore } : {}),
      ...(options.pointer
        ? {
            pointer: true,
            ledger: file('ledger.json'),
            update: true,
            ...(labels ? { labels } : {}),
            ...(cassette ? { cassette } : {}),
            ...(options.record ? { record: true } : {}),
            ...(options.labeler ? { labeler: options.labeler } : {}),
            ...(options.jobs ? { jobs: options.jobs } : {}),
            ...(options.prices ? { prices: options.prices } : {}),
          }
        : {}),
    };
    let usage: string[] = [];
    const code = await estateCommands.estateScanCommand(root, scanOptions, step.io, {
      ...deps,
      onScan: (result, prices) => {
        usage = usageSummary(result, prices);
      },
    });
    if (code === 2 || !(await exists(file('map.yaml')))) return 2;
    stamp.stages.scan = { input: scanInput, code };
    delete stamp.stages.approve;
    delete stamp.stages.plan;
    const counts = await atomCounts(file('map.yaml'));
    io.out(
      `1. Read the estate: ${counts.atoms} atoms, ${counts.waiting} of them split from prose by a model and waiting for approval. Wrote ${shown('map.yaml')}.\n`,
    );
    if (code === 1) io.out(SCAN_WARNING);
    for (const line of usage) io.out(`${line}\n`);
    await saveStamp();
  }

  // 2. Approve the atoms.
  const mapHash = await fileHash(file('map.yaml'));
  if (stamp.stages.approve?.input === mapHash && (await exists(file('approved.yaml')))) {
    io.out('2. Approve the atoms: done before, approved.yaml kept.\n');
  } else {
    const counts = await atomCounts(file('map.yaml'));
    if (counts.waiting > 0 && options.yes !== true) {
      const question = `${counts.waiting} atoms were split from prose by a model and wait for your approval. Approve all ${counts.waiting}?`;
      if (!interactive) {
        io.out(
          [
            `Stopped before the first approval: ${question}`,
            `Run again with --yes to approve them all, or approve some first with driftbench estate approve ${shown('map.yaml')} --kind <kind> and run estate build again.`,
            '',
          ].join('\n'),
        );
        return 1;
      }
      if (!(await ask(`${question} [y/N] `))) {
        io.out(
          `Stopped: nothing approved. Approve by kind or atom with driftbench estate approve ${shown('map.yaml')} --kind <kind>, then run estate build again.\n`,
        );
        return 1;
      }
    }
    const step = stageIo(io, verbose);
    const code = await estateCommands.estateApproveCommand(
      file('map.yaml'),
      { all: true, to: file('approved.yaml') },
      step.io,
    );
    if (code !== 0) return code;
    stamp.stages.approve = { input: mapHash };
    io.out(
      `2. Approve the atoms: ${options.yes === true ? 'approved all, as --yes says' : 'approved'}. Wrote ${shown('approved.yaml')}.\n`,
    );
    await saveStamp();
  }

  // 3. Map the situations and plan the tests.
  const approvedHash = await fileHash(file('approved.yaml'));
  const planInput = sha(JSON.stringify([approvedHash, options.t ?? '2']));
  if (stamp.stages.plan?.input === planInput && (await exists(file('plan.yaml')))) {
    io.out('3. Map and plan: unchanged, space.yaml and plan.yaml kept.\n');
  } else {
    const mapStep = stageIo(io, verbose);
    const mapCode = await estateCommands.estateMapCommand(
      file('approved.yaml'),
      { to: file('space.yaml') },
      mapStep.io,
    );
    if (mapCode !== 0) return mapCode;
    const planStep = stageIo(io, verbose);
    const planCode = await estatePlanCommand(
      file('approved.yaml'),
      {
        out: file('plan.yaml'),
        space: file('space.yaml'),
        force: true,
        ...(options.t ? { t: options.t } : {}),
      },
      planStep.io,
    );
    if (planCode !== 0) return planCode;
    stamp.stages.plan = { input: planInput };
    delete stamp.stages.planApprove;
    delete stamp.stages.generate;
    const rows = await planRows(file('plan.yaml'));
    io.out(
      `3. Map and plan: the plan holds ${rows.total} tests, chosen so that every pair of situations is covered at least once. Wrote ${shown('space.yaml')} and ${shown('plan.yaml')}.\n`,
    );
    await saveStamp();
  }

  // 4. Approve the plan.
  const rows = await planRows(file('plan.yaml'));
  if (rows.proposed > 0) {
    if (options.yes !== true) {
      const question = `The plan holds ${rows.total} tests, ${rows.proposed} of them waiting for your approval. Approve all ${rows.proposed}?`;
      if (!interactive) {
        io.out(
          [
            `Stopped before the second approval: ${question}`,
            `Run again with --yes to approve them all, or approve some first with driftbench estate plan approve ${shown('plan.yaml')} --row <id>, then run estate build again.`,
            '',
          ].join('\n'),
        );
        return 1;
      }
      if (!(await ask(`${question} [y/N] `))) {
        io.out(
          `Stopped: no test approved. Approve with driftbench estate plan approve ${shown('plan.yaml')} --all, then run estate build again.\n`,
        );
        return 1;
      }
    }
    const step = stageIo(io, verbose);
    const code = await estatePlanApproveCommand(file('plan.yaml'), { all: true }, step.io);
    if (code !== 0) return code;
    delete stamp.stages.generate;
    io.out(
      `4. Approve the plan: approved all ${rows.proposed} tests${options.yes === true ? ', as --yes says' : ''}.\n`,
    );
    await saveStamp();
  } else {
    io.out('4. Approve the plan: every test was approved before.\n');
  }

  // 5. Write the tests.
  const phrases = options.phrases ? resolve(io.cwd, options.phrases) : undefined;
  const sessions = options.sessions ? resolve(io.cwd, options.sessions) : undefined;
  const generateInput = sha(
    JSON.stringify([
      await fileHash(file('approved.yaml')),
      await fileHash(file('plan.yaml')),
      phrases ? await fileHash(phrases) : null,
      sessions ? await fileHash(sessions) : null,
    ]),
  );
  const report = join(file('generated'), 'estate-generate-report.json');
  let generateCode = 0;
  const before = stamp.stages.generate;
  if (before?.input === generateInput && (await exists(report))) {
    generateCode = before.code ?? 0;
    io.out('5. Write the tests: unchanged, generated/ kept.\n');
  } else {
    const step = stageIo(io, verbose);
    generateCode = await estateGenerateCommand(
      {
        map: file('approved.yaml'),
        plan: file('plan.yaml'),
        out: file('generated'),
        force: true,
        ...(phrases ? { phrases } : {}),
        ...(sessions ? { sessions } : {}),
      },
      step.io,
    );
    if (generateCode === 2) return 2;
    stamp.stages.generate = { input: generateInput, code: generateCode };
    const lines = step.lines();
    const total = lines.find((line) => line.startsWith('total '))?.split(/\s+/);
    const wrote = lines.find((line) => line.startsWith('Wrote '));
    const split = total
      ? ` ${total[2]} are complete and ${total[3]} still wait for something (the report lists what).`
      : '';
    io.out(`5. Write the tests: ${total ? `${total[1]} tests written.${split}` : (wrote ?? 'done.')}\n`);
    await saveStamp();
  }

  const specs = show(file('generated'), io);
  io.out(
    [
      '',
      `Done. The tests are in ${specs}. Next:`,
      `  run a test:        driftbench estate run <a spec of ${specs}/specs/live> --estate ${show(root, io)} --runtime claude-code --command <your agent> --store runs.db --map ${shown('approved.yaml')}`,
      ...(options.pointer
        ? [
            `  after an edit:     driftbench radius ledger ${shown('map.yaml')} --ledger ${shown('ledger.json')} --out change.yaml`,
            `                     driftbench radius ${specs}/specs/live --change change.yaml`,
          ]
        : []),
      '',
    ].join('\n'),
  );
  return generateCode === 0 ? 0 : 1;
}

/** The number of atoms of a map, and how many of them are not approved. */
async function atomCounts(path: string): Promise<{ atoms: number; waiting: number }> {
  const parsed = parseEstateMapText(await readFile(path, 'utf8'));
  if (!parsed.ok) return { atoms: 0, waiting: 0 };
  return {
    atoms: parsed.map.atoms.length,
    waiting: parsed.map.atoms.filter((atom) => !atom.approved).length,
  };
}

/** The number of rows of a plan, and how many of them wait for approval. */
async function planRows(path: string): Promise<{ total: number; proposed: number }> {
  const parsed = parsePlanText(await readFile(path, 'utf8'));
  if (!parsed.ok) return { total: 0, proposed: 0 };
  return {
    total: parsed.plan.rows.length,
    proposed: parsed.plan.rows.filter((row) => row.status === 'proposed').length,
  };
}
