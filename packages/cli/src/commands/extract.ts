import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  approveAll,
  approveDimensions,
  axisGrid,
  countEntries,
  type ExtractResult,
  extractMap,
  loadProposal,
  loadRecording,
  ModelError,
  type ModelPort,
  type ProposalIssue,
  pendingEntries,
  portFromEnv,
  recordingPort,
  renderProposal,
  type SourceKind,
  type SourceText,
  shortQuote,
  toSpaceMap,
} from '@agent-nexus/driftbench-generate';
import { formatSpaceMap, validateSpaceMap } from '@agent-nexus/driftbench-space';
import type { Command } from 'commander';
import { exists, reason, showPath as show } from '../files';
import type { Io } from '../io';

export type ExtractOptions = {
  prompt?: string[];
  inventory?: string;
  tools?: string;
  out?: string;
  /** False with --no-model. */
  model?: boolean;
  provider?: string;
  replay?: string;
  agent?: string;
  force?: boolean;
};

export type ExtractDeps = {
  /** The model to call instead of the one the environment configures. Tests pass a fake. */
  port?: ModelPort;
  /** Where model keys are read. Default `process.env`. */
  env?: Record<string, string | undefined>;
  now?: () => Date;
};

/**
 * `driftbench extract`: code and a model propose the map of situations from an agent's prompt, its
 * behaviour inventory and its tool schemas; a person approves them. `driftbench extract approve` lists
 * the decisions left and approves by dimension or everything; `driftbench extract map` writes the space map
 * of the approved axes.
 */
export function registerExtractCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const extract = program
    .command('extract')
    .description('Propose the map of situations from a prompt and an inventory, for a person to approve')
    .option('--prompt <file>', 'the agent prompt or policy; repeat it for several files', collect)
    .option('--inventory <file>', 'the behaviour inventory (YAML or JSON)')
    .option('--tools <file>', 'tool schemas, or a spec whose metadata.tool_schemas lists them')
    .option('--out <file>', 'where to write the proposal (YAML)')
    .option('--no-model', 'run only the code pre-pass on the inventory and the tools')
    .option('--provider <name>', 'anthropic or openai (default: the first whose key is set)')
    .option('--replay <file>', 'replay recorded answers instead of calling a model')
    .option('--agent <name>', 'the agent name (default: the folder of the inventory)')
    .option('--force', 'replace an existing proposal; the approvals in it are lost')
    .action(async (options: ExtractOptions) => {
      setExit(await extractCommand(options, io));
    });

  extract
    .command('approve')
    .description('List the decisions left, or approve dimensions (--dimension) or every entry (--all)')
    .argument('<proposal>', 'the proposal file')
    .option(
      '--dimension <id>',
      'approve this dimension and the values that inherit its flag; repeat it',
      collect,
    )
    .option('--all', 'approve every entry and print the count')
    .option('--to <file>', 'write the approved proposal here, in the same folder, instead of over it')
    .action(async (path: string, options: ApproveOptions) => {
      setExit(await approveCommand(path, options, io));
    });

  extract
    .command('map')
    .description('Write the space map of the approved axis dimensions, for driftbench space')
    .argument('<proposal>', 'the proposal file')
    .option('--to <file>', 'where to write the space map (YAML)')
    .option('--all', 'take every axis value, approved or not')
    .action(async (path: string, options: { to?: string; all?: boolean }) => {
      setExit(await mapCommand(path, options, io));
    });
}

/**
 * Exit 0 when the proposal is written and every section answered, 1 when it is written but a section failed
 * or an entry was refused (both are listed), 2 on a usage or input error (nothing is written).
 */
export async function extractCommand(
  options: ExtractOptions,
  io: Io,
  deps: ExtractDeps = {},
): Promise<number> {
  const prompts = options.prompt ?? [];
  const missing = [
    prompts.length > 0 ? undefined : "'--prompt <file>'",
    options.inventory ? undefined : "'--inventory <file>'",
    options.out ? undefined : "'--out <file>'",
  ].filter((name) => name !== undefined);
  if (!options.inventory || !options.out || missing.length > 0) {
    io.err(`error: required option${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not specified\n`);
    return 2;
  }
  if (options.model === false && options.replay) {
    io.err('error: --no-model and --replay cannot be used together\n');
    return 2;
  }

  const out = resolve(io.cwd, options.out);
  if (!options.force && (await exists(out))) {
    io.err(`${show(out, io)} already exists: pass --force to replace it (the approvals in it are lost).\n`);
    return 2;
  }

  const files: Array<{ kind: SourceKind; path: string }> = [
    ...prompts.map((path) => ({ kind: 'prompt' as const, path: resolve(io.cwd, path) })),
    { kind: 'inventory', path: resolve(io.cwd, options.inventory) },
    ...(options.tools ? [{ kind: 'tools' as const, path: resolve(io.cwd, options.tools) }] : []),
  ];
  const sources: SourceText[] = [];
  const shown = new Map<string, string>();
  for (const file of files) {
    try {
      sources.push({ kind: file.kind, path: label(out, file.path), text: await readFile(file.path, 'utf8') });
      shown.set(label(out, file.path), show(file.path, io));
    } catch (cause) {
      io.err(`Cannot read ${show(file.path, io)}: ${reason(cause)}\n`);
      return 2;
    }
  }

  let port: ModelPort | undefined;
  if (options.model !== false) {
    if (options.replay) {
      const recording = resolve(io.cwd, options.replay);
      const loaded = await loadRecording(recording);
      if (!loaded.ok) {
        io.err(`Cannot use the recording ${show(recording, io)}: ${loaded.message}\n`);
        return 2;
      }
      port = recordingPort(loaded.recording);
    } else {
      try {
        port = deps.port ?? portFromEnv({ env: deps.env, provider: options.provider });
      } catch (cause) {
        if (!(cause instanceof ModelError)) throw cause;
        io.err(`${cause.message}. Pass --no-model to run the code pre-pass only.\n`);
        return 2;
      }
    }
  }

  const agent = options.agent ?? basename(dirname(resolve(io.cwd, options.inventory)));
  const result = await extractMap({ agent, sources, port, now: deps.now });
  if (!result.ok) {
    for (const error of result.errors) {
      const source = shown.get(error.source) ?? (error.source || '(input)');
      io.err(`✗ ${source}  ${error.path || '(file)'}  ${error.code}  ${error.message}\n`);
    }
    io.err('The inputs are invalid, so no proposal was written.\n');
    return 2;
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderProposal(result.proposal));
  io.out(report(result, out, io));
  const failed = result.sections.some((run) => run.status === 'failed');
  return failed || result.refusals.length > 0 ? 1 : 0;
}

/**
 * Exit 0 after listing or approving, 1 when the proposal is invalid (an entry without evidence, a quote not
 * found in its source, a broken reference), 2 when the file cannot be found.
 */
export type ApproveOptions = {
  all?: boolean;
  /** Dimensions to approve, by id. */
  dimension?: string[];
  /** Write the result here instead of over the proposal. In the proposal's folder: quotes stay found. */
  to?: string;
};

/**
 * Exit 0 after listing or approving, 1 when the proposal is invalid (an entry without evidence, a quote not
 * found in its source, a broken reference) or names an unknown dimension, 2 when the file cannot be found
 * or the options do not fit.
 */
export async function approveCommand(path: string, options: ApproveOptions, io: Io): Promise<number> {
  const file = resolve(io.cwd, path);
  const name = show(file, io);
  if (!(await exists(file))) {
    io.err(`Cannot find ${name}.\n`);
    return 2;
  }
  const dimensions = options.dimension ?? [];
  if (options.all && dimensions.length > 0) {
    io.err('error: --all and --dimension cannot be used together\n');
    return 2;
  }
  const target = options.to ? resolve(io.cwd, options.to) : file;
  if (options.to && dirname(target) !== dirname(file)) {
    io.err('error: --to must stay in the folder of the proposal, where its source paths resolve\n');
    return 2;
  }
  const loaded = await loadProposal(file);
  if (!loaded.ok) {
    io.err(`✗ ${name}\n${loaded.errors.map(issueLine).join('')}`);
    io.err('The proposal is invalid, so nothing was approved.\n');
    return 1;
  }

  if (options.all) {
    const approved = approveAll(loaded.text);
    if (!approved.ok) {
      io.err(`✗ ${name}\n${approved.errors.map(issueLine).join('')}`);
      return 1;
    }
    await writeFile(target, approved.text);
    io.out(
      `Approved ${approved.approved} ${plural(approved.approved, 'flag', 'flags')} in ${show(target, io)}; ${approved.already} ${approved.already === 1 ? 'was' : 'were'} already set.\n`,
    );
    return 0;
  }

  if (dimensions.length > 0) {
    const approved = approveDimensions(loaded.text, dimensions);
    if (!approved.ok) {
      io.err(`✗ ${name}\n${approved.errors.map(issueLine).join('')}`);
      return 1;
    }
    await writeFile(target, approved.text);
    const already = approved.already.length > 0 ? ` Already approved: ${approved.already.join(', ')}.` : '';
    io.out(
      `Approved ${approved.approved.length} ${plural(approved.approved.length, 'dimension', 'dimensions')} in ${show(target, io)}: ${approved.approved.join(', ') || 'none'}.${already}\n`,
    );
    return 0;
  }

  const counts = countEntries(loaded.proposal);
  const grid = axisGrid(loaded.proposal);
  const axes = loaded.proposal.dimensions.filter((dimension) => dimension.role === 'axis').length;
  const gridLine = `Axes: ${axes} of ${counts.dimensions} dimensions, a full grid of ${grid.cells} ${plural(grid.cells, 'cell', 'cells')} (the space commands accept ${grid.limit}).`;
  const pending = pendingEntries(loaded.proposal);
  if (pending.length === 0) {
    io.out(`${name}: all ${counts.total} decisions are made.\n${gridLine}\n`);
    return 0;
  }
  const width = Math.max(...pending.map((entry) => entry.kind.length));
  const lines = pending.flatMap((entry) => {
    const head = `  ${entry.kind.padEnd(width)}  ${entry.label}  ${entry.detail}`;
    const quote = entry.source
      ? [`  ${' '.repeat(width)}  ${entry.source}: "${shortQuote(entry.quote ?? '')}"`]
      : [];
    return [head, ...quote];
  });
  io.out(
    [
      `${name}: ${pending.length} of ${counts.total} decisions are open (${counts.dimensions} dimensions, ${counts.constraints} constraints, ${counts.phrases} phrases${counts.relations > 0 ? `, ${counts.relations} relations` : ''}${(counts.numeric_settings ?? 0) > 0 ? `, ${counts.numeric_settings} numeric settings` : ''}).`,
      gridLine,
      ...lines,
      'Approve a dimension and its values with --dimension <id>, or every entry with --all. In the file, set',
      'approved: true; a value may set its own flag, and role: axis or detail decides what enters the space map.',
      '',
    ].join('\n'),
  );
  return 0;
}

/**
 * `driftbench extract map`: the space map of a proposal's approved axis dimensions, for the space commands.
 * Exit 0 written, 1 when the proposal is invalid or the map is (no approved axis, or every cell forbidden),
 * 2 when the file cannot be found.
 */
export async function mapCommand(
  path: string,
  options: { to?: string; all?: boolean },
  io: Io,
): Promise<number> {
  const file = resolve(io.cwd, path);
  if (!(await exists(file))) {
    io.err(`Cannot find ${show(file, io)}.\n`);
    return 2;
  }
  if (!options.to) {
    io.err("error: required option '--to <file>' not specified\n");
    return 2;
  }
  const loaded = await loadProposal(file);
  if (!loaded.ok) {
    io.err(`✗ ${show(file, io)}\n${loaded.errors.map(issueLine).join('')}`);
    return 1;
  }
  const out = resolve(io.cwd, options.to);
  const map = toSpaceMap(loaded.proposal, { approvedOnly: !options.all });
  if (map.inventory !== undefined) {
    map.inventory = label(out, resolve(dirname(file), map.inventory));
  }
  const checked = validateSpaceMap(map, show(out, io));
  if (!checked.ok) {
    const why =
      map.dimensions.length === 0
        ? '  (no approved axis dimension)\n'
        : checked.errors.map(issueLine).join('');
    io.err(`✗ the space map of ${show(file, io)} is invalid\n${why}`);
    return 1;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    formatSpaceMap(map, [
      `The space map of ${basename(file)}: its ${options.all ? '' : 'approved '}axis dimensions and their constraints.`,
      'Written by driftbench extract map; edit the proposal and write it again rather than editing this file.',
    ]),
  );
  const cells = map.dimensions.reduce((product, dimension) => product * dimension.values.length, 1);
  io.out(
    `Wrote ${show(out, io)}: ${map.dimensions.length} axes (${map.dimensions.map((d) => d.id).join(', ')}), ${map.constraints.length} constraints, a full grid of ${cells} ${plural(cells, 'cell', 'cells')}.\n`,
  );
  return 0;
}

function report(result: Extract<ExtractResult, { ok: true }>, out: string, io: Io): string {
  const { proposal, prepass } = result;
  const counts = countEntries(proposal);
  const axes = proposal.dimensions.filter((dimension) => dimension.role === 'axis').map((d) => d.id);
  const { cells } = axisGrid(proposal);
  const lines = [
    `Wrote ${show(out, io)}: ${proposal.dimensions.length} dimensions, ${counts.values} values, ${counts.constraints} constraints, ${counts.phrases} phrases${counts.relations > 0 ? `, ${counts.relations} relations` : ''}, none approved.`,
    `  Code pre-pass: ${prepass.dimensions} dimensions, ${prepass.values} values, ${prepass.constraints} constraints${prepass.relations > 0 ? `, ${prepass.relations} relations` : ''}.`,
    `  Roles: ${axes.length} axes (${axes.join(', ')}), ${proposal.dimensions.length - axes.length} details; the axes make a full grid of ${cells} ${plural(cells, 'cell', 'cells')}.`,
  ];
  if (result.sections.length === 0) {
    lines.push('  No model call: the code pre-pass alone (--no-model).');
  } else {
    const { family, model } = proposal.produced_by;
    lines.push(`  Model ${family} ${model}: ${result.sections.length} sections, ${result.calls} calls.`);
    const width = Math.max(...result.sections.map((run) => run.section.length));
    for (const run of result.sections) {
      const what =
        run.status === 'done'
          ? `added ${run.accepted} ${plural(run.accepted, 'entry', 'entries')}`
          : `failed: ${run.error}${run.excerpt ? ` (answer: "${run.excerpt}")` : ''}`;
      lines.push(`    ${run.section.padEnd(width)}  ${what}`);
    }
  }
  if (result.refusals.length > 0) {
    lines.push('Refused, not in the proposal:');
    for (const refusal of result.refusals) {
      lines.push(`  ${refusal.section}  ${refusal.entry}  ${refusal.reason}`);
    }
  }
  if (result.duplicates.length > 0) {
    lines.push(`Skipped ${result.duplicates.length} already proposed: ${result.duplicates.join('; ')}`);
  }
  if (result.notes.length > 0) {
    lines.push('Notes:');
    for (const note of result.notes) lines.push(`  ${note}`);
  }
  lines.push(
    `Next: driftbench extract approve ${show(out, io)} lists the decisions; approve by --dimension <id> or --all.`,
    '',
  );
  return lines.join('\n');
}

/** The path a proposal records for a source: relative to the proposal's folder, with forward slashes. */
function label(out: string, path: string): string {
  const rel = relative(dirname(out), path);
  return isAbsolute(rel) ? path : rel.split(sep).join('/');
}

function issueLine(issue: ProposalIssue): string {
  return `  ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`;
}

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
