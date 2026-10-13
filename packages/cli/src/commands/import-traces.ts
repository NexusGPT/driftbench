import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  type PriceTable,
  readTraces,
  readTracesText,
  TRACE_SOURCES,
  type Trace,
  type TraceSource,
} from '@agent-nexus/driftbench-adapters';
import { approveDrafts, draftSpec, pendingDrafts } from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import { exists, reason, showPath as show } from '../files';
import type { Io } from '../io';
import { pushCommand } from './registry';

export type ImportTracesOptions = {
  from?: string;
  out?: string;
  prices?: string;
  redact?: boolean;
  force?: boolean;
  select?: string;
  dataset?: string;
  store?: string;
};

export type ImportDeps = {
  /** Standard input, for `-`. Tests pass their own. */
  readStdin?: () => Promise<string>;
};

/**
 * `driftbench import traces` drafts specs from production traces: OpenTelemetry (GenAI semantic
 * conventions), a Nexus trace export, or a recorded Claude Code session. `driftbench import approve` lists
 * or approves the drafts. Both join the `import` command when another module registered it (the table
 * import), else they register it.
 */
export function registerTraceImportCommands(program: Command, io: Io, setExit: (code: number) => void): void {
  const command =
    program.commands.find((existing) => existing.name() === 'import') ??
    program.command('import').description('Turn tables or production traces into spec files');
  command
    .command('traces')
    .description(
      'Draft one spec per traced conversation: each observed user turn a block, the observed state before it the Given; no expect, approved: false',
    )
    .argument('<path>', 'a trace file, a folder of them, or - for standard input (otel and nexus)')
    .option('--from <source>', `where the traces come from: ${TRACE_SOURCES.join(', ')}`)
    .option('--out <dir>', 'the folder to write the draft specs to')
    .option(
      '--prices <file>',
      'JSON prices per million tokens by model, {"model": {"input": 2, "output": 8}}',
    )
    .option('--no-redact', 'keep personal data; by default the intake privacy rules redact it')
    .option('--force', 'replace drafts that already exist')
    .option('--select <ids>', 'draft only these traces: comma-separated trace ids')
    .option('--dataset <name>', 'after drafting, push the drafts as the next version of this dataset')
    .option('--store <file>', 'the store that keeps the dataset version (with --dataset)')
    .action(async (path: string, options: ImportTracesOptions) => {
      setExit(await importTracesCommand(path, options, io));
    });
  command
    .command('approve')
    .description('List the imported drafts not approved yet; --all approves them')
    .argument('<path>', 'a draft spec or a folder of them')
    .option('--all', 'approve every draft and print the count')
    .action(async (path: string, options: { all?: boolean }) => {
      setExit(await approveDraftsCommand(path, options, io));
    });
}

/** Exit 0 when every draft is written, 2 on a usage or input error (nothing written). */
export async function importTracesCommand(
  path: string,
  options: ImportTracesOptions,
  io: Io,
  deps: ImportDeps = {},
): Promise<number> {
  if (!options.from || !(TRACE_SOURCES as readonly string[]).includes(options.from)) {
    io.err(`error: --from takes ${TRACE_SOURCES.join(', ')}\n`);
    return 2;
  }
  if (!options.out) {
    io.err("error: required option '--out <dir>' not specified\n");
    return 2;
  }
  if (options.dataset && !options.store) {
    io.err('error: --dataset needs --store <file>\n');
    return 2;
  }
  const from = options.from as TraceSource;
  let prices: PriceTable | undefined;
  if (options.prices) {
    try {
      prices = JSON.parse(await readFile(resolve(io.cwd, options.prices), 'utf8')) as PriceTable;
    } catch (cause) {
      io.err(`Cannot read the prices ${options.prices}: ${reason(cause)}\n`);
      return 2;
    }
  }

  let traces: Trace[];
  let issues: string[];
  let where: string;
  try {
    if (path === '-') {
      if (from === 'claude-code') {
        io.err('A Claude Code session is read from its file: pass the path, not -.\n');
        return 2;
      }
      const text = await (deps.readStdin ?? readStdin)();
      ({ traces, issues } = readTracesText(text, from, prices ? { prices } : {}));
      where = 'standard input';
    } else {
      const read = await readTraces(resolve(io.cwd, path), from, prices ? { prices } : {});
      ({ traces, issues } = read);
      where = `${read.files.length} ${read.files.length === 1 ? 'file' : 'files'}`;
    }
  } catch (cause) {
    io.err(`Cannot read the traces at ${path}: ${reason(cause)}\n`);
    return 2;
  }
  if (traces.length === 0) {
    io.err(`No trace found in ${path}${issues.length > 0 ? `: ${issues.join('; ')}` : ''}.\n`);
    return 2;
  }
  if (options.select !== undefined) {
    const ids = options.select
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '');
    const unknown = ids.filter((id) => !traces.some((trace) => trace.id === id));
    if (unknown.length > 0) {
      io.err(`error: no trace named ${unknown.join(', ')} in ${where}: nothing written\n`);
      return 2;
    }
    traces = traces.filter((trace) => ids.includes(trace.id));
  }

  const out = resolve(io.cwd, options.out);
  const drafts = [];
  for (const trace of traces) {
    if (!trace.turns.some((turn) => turn.user.trim() !== '')) {
      issues.push(`${trace.id}: no user turn, no draft`);
      continue;
    }
    drafts.push(
      draftSpec(trace, {
        // Taken from the trace, never the clock: the same traces always draft the same bytes.
        importedAt: trace.startedAt ?? 'not-given',
        redact: options.redact !== false,
        ...(path === '-' ? {} : { file: path }),
      }),
    );
  }
  if (!options.force) {
    for (const draft of drafts) {
      const file = join(out, `${draft.id}.yaml`);
      if (await exists(file)) {
        io.err(`${show(file, io)} already exists: pass --force to replace it (its review is lost).\n`);
        return 2;
      }
    }
  }
  await mkdir(out, { recursive: true });
  for (const draft of drafts) await writeFile(join(out, `${draft.id}.yaml`), draft.text);

  const turns = traces.reduce((sum, trace) => sum + trace.turns.length, 0);
  const redacted = drafts.reduce((sum, draft) => sum + draft.redacted, 0);
  const lines = [
    `Read ${traces.length} ${traces.length === 1 ? 'trace' : 'traces'} from ${where} (${from}): ${turns} turns.`,
    `Wrote ${drafts.length} draft ${drafts.length === 1 ? 'spec' : 'specs'} to ${show(out, io)}, none approved: ${drafts.reduce((sum, draft) => sum + draft.blocks, 0)} blocks, no expect yet.`,
    options.redact === false
      ? '  Personal data kept (--no-redact).'
      : `  Personal data redacted: ${redacted} ${redacted === 1 ? 'value' : 'values'}.`,
    ...issues.map((issue) => `  note: ${issue}`),
    `Next: write each block's expect from the agent spec, then driftbench import approve ${show(out, io)} --all.`,
  ];
  io.out(`${lines.join('\n')}\n`);
  if (options.dataset) {
    return pushCommand('dataset', options.dataset, out, { store: options.store as string }, io);
  }
  return 0;
}

/** Exit 0 after listing or approving, 1 when a file is not an imported draft, 2 when the path is missing. */
export async function approveDraftsCommand(
  path: string,
  options: { all?: boolean },
  io: Io,
): Promise<number> {
  const target = resolve(io.cwd, path);
  const info = await stat(target).catch(() => undefined);
  if (!info) {
    io.err(`Cannot find ${path}.\n`);
    return 2;
  }
  const files = info.isDirectory()
    ? (await readdir(target))
        .filter((name) => /\.ya?ml$/.test(name))
        .sort()
        .map((name) => join(target, name))
    : [target];
  const pending: string[] = [];
  let approved = 0;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    let waiting: boolean;
    try {
      waiting = pendingDrafts(text);
    } catch (cause) {
      io.err(`✗ ${show(file, io)}: ${reason(cause)}\n`);
      return 1;
    }
    if (!waiting) continue;
    if (options.all) {
      await writeFile(file, approveDrafts(text).text);
      approved += 1;
    } else {
      pending.push(show(file, io));
    }
  }
  if (options.all) {
    io.out(`Approved ${approved} ${approved === 1 ? 'draft' : 'drafts'} of ${files.length}.\n`);
  } else if (pending.length === 0) {
    io.out(`${path}: all ${files.length} ${files.length === 1 ? 'draft is' : 'drafts are'} approved.\n`);
  } else {
    io.out(
      `${pending.length} of ${files.length} drafts are not approved yet:\n${pending.map((file) => `  ${file}\n`).join('')}`,
    );
  }
  return 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
