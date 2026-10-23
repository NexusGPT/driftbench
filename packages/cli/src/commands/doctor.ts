import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type DoctorResult,
  diagnoseSetup,
  parseSetupText,
  type ResolvedSetupSource,
  runtimeProfile,
  type SetupDocument,
} from '@agent-nexus/driftbench-core';
import { type EstateReaderOptions, readerFor } from '@agent-nexus/driftbench-estate';
import type { Command } from 'commander';
import { stringify } from 'yaml';
import type { Io } from '../io';

export type DoctorOptions = { setup?: string; write?: string; check?: boolean; json?: boolean };

/** Programmatic doctor entry: all detection goes through readerFor, with policy enforced by core. */
export async function inspectSetup(
  root: string,
  setup?: SetupDocument,
  file?: string,
): Promise<DoctorResult> {
  return diagnoseSetup(
    root,
    async (id, folder, source, snapshotRoots) => {
      const options: EstateReaderOptions & { setupSource?: ResolvedSetupSource; snapshotRoots?: Record<string, string> } = { setupSource: source, snapshotRoots };
      return readerFor(id, options)?.read(folder);
    },
    setup,
    file,
  );
}

/** `driftbench doctor`: inspect, write an exclusive draft, or compare the saved drift baseline. */
export async function doctorCommand(path: string, options: DoctorOptions, io: Io): Promise<number> {
  const root = resolve(io.cwd, path);
  const file = resolve(root, options.setup ?? 'driftbench.setup.yaml');
  if (!(await stat(root).catch(() => undefined))?.isDirectory()) {
    io.err(`driftbench: doctor root is not a directory: ${root}\n`);
    return 2;
  }
  if (options.check && options.write) {
    io.err('driftbench: --check and --write cannot be combined.\n');
    return 2;
  }
  let setup: SetupDocument | undefined;
  try {
    const text = await readFile(file, 'utf8').catch((cause: NodeJS.ErrnoException) => {
      if (
        cause.code === 'ENOENT' &&
        !options.check &&
        (options.setup === undefined || options.setup === 'driftbench.setup.yaml')
      )
        return undefined;
      throw cause;
    });
    if (text !== undefined) {
      const preliminary = parseSetupText(text);
      if (!preliminary.ok) {
        io.err(`driftbench: invalid setup: ${JSON.stringify(preliminary.errors)}\n`);
        return 2;
      }
      const profile = preliminary.setup.runtime ? runtimeProfile(preliminary.setup.runtime) : undefined;
      const parsed = profile ? parseSetupText(text, profile) : preliminary;
      if (!parsed.ok) {
        io.err(`driftbench: invalid setup: ${JSON.stringify(parsed.errors)}\n`);
        return 2;
      }
      setup = parsed.setup;
    }
    if (options.check && !setup?.drift) {
      io.err('driftbench: --check needs a saved setup with a drift baseline.\n');
      return 2;
    }
    const result = await inspectSetup(root, setup, file);
    if (options.write)
      await writeFile(resolve(root, options.write), stringify(result.draft), { flag: 'wx', mode: 0o600 });
    if (options.json) io.out(`${JSON.stringify(result, null, 2)}\n`);
    else {
      io.out(`Runtime: ${result.draft.runtime ?? 'unknown'}\n`);
      for (const claim of result.detections)
        io.out(
          `${claim.field}: ${claim.value} (confidence ${claim.confidence})\n${claim.evidence.map((evidence) => `  ${evidence.source}:${evidence.file}: ${evidence.reason}`).join('\n')}\n`,
        );
      io.out(
        `Coverage: ${result.coverage.status}; read ${result.coverage.read}; covered ${result.coverage.covered}; unknown ${result.coverage.unknown.length}\n`,
      );
      for (const unknown of result.coverage.unknown) io.out(`Unknown: ${unknown}\n`);
      for (const skip of result.coverage.skipped) io.out(`Skipped: ${skip.what}: ${skip.reason}\n`);
      io.out(`Drift: ${result.drift.status}\n`);
      for (const change of result.drift.changes) io.out(`${change.kind}: ${change.source}:${change.path}\n`);
      for (const step of result.nextSteps)
        io.out(
          `${step.action}: ${step.usd === null ? 'price unknown' : `$${step.usd.toFixed(4)}`} (${step.allowed ? 'allowed' : 'blocked'}): ${step.reason}\n`,
        );
      for (const advice of result.advice) io.out(`${advice}\n`);
      if (!options.check)
        io.out(
          `\nDraft setup${options.write ? ` written to ${resolve(root, options.write)}` : ''}:\n${stringify(result.draft)}`,
        );
    }
    return options.check && result.drift.status !== 'pass' ? 1 : 0;
  } catch (cause) {
    io.err(`driftbench: doctor: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
}

export function registerDoctorCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  program
    .command('doctor')
    .description('Detect an agent setup, preview coverage and prices, and guard against drift.')
    .argument('[path]', 'Folder to inspect', '.')
    .option('--setup <file>', 'Setup file relative to the inspected folder', 'driftbench.setup.yaml')
    .option('--write <file>', 'Write a draft relative to the inspected folder; never overwrite')
    .option('--check', 'Fail when the saved setup baseline and folder disagree')
    .option('--json', 'Print structured detections, coverage, prices, advice and draft')
    .action(async (path: string, options: DoctorOptions) => {
      setExit(await doctorCommand(path, options, io));
    });
}
