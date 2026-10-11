import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { type LoadedSpec, loadSpecs } from '@driftbench/core';
import {
  COMPLETE_DIR,
  formatJson,
  generateSuite,
  INCOMPLETE_DIR,
  loadApprovedMap,
  REPORT_FILE,
  renderSummary,
} from '@driftbench/generate';
import type { Command } from 'commander';
import type { Io } from '../io';

export type GenerateCommandOptions = {
  map: string;
  out: string;
  t?: string;
  seed?: string;
  max?: string;
  baseline?: string[];
  force?: boolean;
  json?: boolean;
};

/**
 * `driftbench generate --map <approved map> --out <dir>`: code enumerates blocks and combinations from the
 * approved map (stage graph paths, a t-wise covering array, boundary values, one probe per deviation
 * class, metamorphic families) and writes them as specs, with `generate-report.json`. No model is called.
 */
export function registerGenerateCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('generate')
    .description('Generate specs from an approved map, by code: graph paths, t-wise rows, boundaries, probes')
    .requiredOption('--map <file>', 'the approved map (a proposal whose every entry is approved)')
    .requiredOption('--out <dir>', 'the folder to write the specs and generate-report.json into')
    .option('--t <n>', 'the strength of the covering array (default 3)')
    .option('--seed <n>', 'the integer seed of every seeded choice (default 1)')
    .option('--max <n>', 'the most specs per seeder')
    .option('--baseline <path>', 'specs to measure on the same map for comparison; repeat it', collect)
    .option('--force', 'replace the output of an earlier run in the folder')
    .option('--json', 'print the report as JSON')
    .action(async (options: GenerateCommandOptions) => {
      setExit(await generateCommand(options, io));
    });
}

/**
 * Exit 0 when the suite is written and every block has an approved phrase and a Then, 1 when it is written
 * with incomplete specs, a seeder cut by --max, or a generator defect (all listed), 2 on a usage or input error
 * (nothing is written): an invalid or unapproved map, a bad number, an earlier output without --force.
 */
export async function generateCommand(options: GenerateCommandOptions, io: Io): Promise<number> {
  const t = whole(options.t, 't', 1);
  const seed = whole(options.seed, 'seed', 0);
  const max = whole(options.max, 'max', 1);
  for (const parsed of [t, seed, max]) {
    if (typeof parsed === 'string') {
      io.err(`${parsed}\n`);
      return 2;
    }
  }
  const mapPath = resolve(io.cwd, options.map);
  const outPath = resolve(io.cwd, options.out);

  const loaded = await loadApprovedMap(mapPath);
  if (!loaded.ok) {
    io.err(`✗ ${display(mapPath, io)}  ${loaded.code}\n`);
    for (const issue of loaded.issues)
      io.err(`  ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
    io.err(`${capital(loaded.message)}.\n`);
    return 2;
  }

  let baseline: { label: string; specs: LoadedSpec['spec'][] } | undefined;
  if (options.baseline && options.baseline.length > 0) {
    const results = await loadSpecs(options.baseline.map((path) => resolve(io.cwd, path)));
    const valid = results.filter((result): result is LoadedSpec => result.ok);
    const refused = results.length - valid.length;
    if (results.length === 0 || refused > 0) {
      io.err(
        results.length === 0
          ? 'No spec found under --baseline.\n'
          : `${refused} baseline spec(s) are invalid; run driftbench spec validate on them.\n`,
      );
      return 2;
    }
    baseline = { label: options.baseline.join(' '), specs: valid.map((result) => result.spec) };
  }

  const reportPath = join(outPath, REPORT_FILE);
  if (await exists(reportPath)) {
    if (!options.force) {
      io.err(
        `${display(reportPath, io)} already exists: an earlier run wrote this folder. Pass --force to replace its output.\n`,
      );
      return 2;
    }
    for (const entry of [COMPLETE_DIR, INCOMPLETE_DIR, REPORT_FILE]) {
      await rm(join(outPath, entry), { recursive: true, force: true });
    }
  }

  let result: ReturnType<typeof generateSuite>;
  try {
    result = generateSuite(loaded.prepared, {
      ...(typeof t === 'number' ? { t } : {}),
      ...(typeof seed === 'number' ? { seed } : {}),
      ...(typeof max === 'number' ? { max } : {}),
      mapPath: portable(relative(outPath, mapPath)),
      ...(baseline ? { baseline } : {}),
    });
  } catch (cause) {
    io.err(`Cannot generate: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }

  for (const file of result.files) {
    const target = join(outPath, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.text);
  }

  const report = result.report;
  if (options.json) io.out(formatJson(report));
  else io.out(`${renderSummary(report)}Wrote ${result.files.length} files to ${display(outPath, io)}.\n`);
  const cut = Object.values(report.seeders).some((entry) => entry.cut);
  const defects = report.invalid.length > 0 || report.lint.length > 0;
  return report.summary.incomplete > 0 || cut || defects ? 1 : 0;
}

function whole(text: string | undefined, name: string, minimum: number): number | string | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(value) || value < minimum) {
    return `--${name} must be a whole number of at least ${minimum}, got "${text}".`;
  }
  return value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function display(path: string, io: Io): string {
  const shown = relative(io.cwd, path);
  return shown === '' ? '.' : shown.startsWith('..') || isAbsolute(shown) ? path : shown;
}

function portable(path: string): string {
  return path.split(sep).join('/');
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
