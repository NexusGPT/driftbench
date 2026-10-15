import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import {
  buildInstances,
  earlierOutput,
  FamilyError,
  type FamilyIssue,
  familyReport,
  formatJson,
  type Instance,
  type LoadedFamily,
  loadFamily,
  type ReviewStatus,
  reviewStatus,
  seedFolderName,
  unapprovedPhrases,
  VERIFY_REPORT_NAME,
  type VerifyReport,
  verifyInstances,
  writeInstances,
  writePendingReview,
} from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { type CampaignDeps, defaultDeps, parseTarget, resolveAdapter, showTarget } from './campaign';

type InstancesOptions = { n: string; seed: string; out: string; force?: boolean; json?: boolean };
type VerifyOptions = { reference: string; concurrency: string; json?: boolean };
type ReviewOptions = { write?: boolean; json?: boolean };

/**
 * `driftbench family`: code-agent task families. `instances` builds N instances of a family from a seed,
 * each with its corner-case variants and expectations the family's oracle computed before any run, and
 * checks the style invariant on every one. `verify` runs the reference build on every instance (the
 * cheat() rule): an instance it fails is an oracle or a reference defect and never ships. `review` shows
 * or writes the review a person signs once per family.
 */
export function registerFamilyCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  const family = program
    .command('family')
    .description('Code-agent task families: build instances from a seed, verify them on the reference build');

  family
    .command('instances')
    .description('Build N instances of a family, each with corner-case variants and oracle expectations')
    .argument('<family>', 'the family folder, or its family.yaml')
    .requiredOption('--n <n>', 'how many instances, at least 1')
    .requiredOption('--seed <s>', 'the integer seed every draw comes from')
    .requiredOption('--out <dir>', 'the folder to write the instances and family-report.json into')
    .option('--force', 'replace the output of an earlier run in the folder')
    .option('--json', 'print the report as JSON')
    .action(async (path: string, options: InstancesOptions) => {
      setExit(await familyInstancesCommand(path, options, io));
    });

  family
    .command('verify')
    .description('Run the reference build on every instance; an instance it fails is never shipped')
    .argument('<dir>', 'the folder family instances wrote')
    .requiredOption('--reference <adapter[:agent]>', 'the reference build, such as process:acme-ops')
    .option('--concurrency <n>', 'how many specs run at once', '4')
    .option('--json', 'print the report as JSON')
    .action(async (dir: string, options: VerifyOptions) => {
      setExit(await familyVerifyCommand(dir, options, io, deps));
    });

  family
    .command('review')
    .description(
      'Show where the review of a family stands; --write writes a pending one for a person to sign',
    )
    .argument('<family>', 'the family folder, or its family.yaml')
    .option('--write', 'write a pending review with the current hashes, unless a current signed one exists')
    .option('--json', 'print the status as JSON')
    .action(async (path: string, options: ReviewOptions) => {
      setExit(await familyReviewCommand(path, options, io));
    });
}

/** Loads a family or prints why it does not load; undefined means exit 2. */
async function loadOrSay(path: string, io: Io): Promise<LoadedFamily | undefined> {
  const result = await loadFamily(resolve(io.cwd, path));
  if (result.ok) return result.loaded;
  io.err(`✗ ${display(result.path, io)} is not a valid family:\n`);
  for (const issue of result.issues) io.err(`  ${where(issue)}  ${issue.message}\n`);
  return undefined;
}

/**
 * Exit 0 when every instance is written; 1 when the family or its oracle has a defect (an oracle that
 * fails or answers outside the format, an invalid spec, a style knob that changes the expected outcome):
 * nothing is written; 2 on bad input: an invalid family, an unapproved phrase, a review that is missing,
 * invalid or stale, a bad number, an earlier output without --force.
 */
export async function familyInstancesCommand(
  path: string,
  options: InstancesOptions,
  io: Io,
): Promise<number> {
  const n = whole(options.n, 'n', 1);
  const seed = whole(options.seed, 'seed', 0);
  for (const parsed of [n, seed]) {
    if (typeof parsed === 'string') {
      io.err(`${parsed}\n`);
      return 2;
    }
  }
  const loaded = await loadOrSay(path, io);
  if (!loaded) return 2;
  const unapproved = unapprovedPhrases(loaded.family);
  if (unapproved.length > 0) {
    io.err(
      `✗ ${loaded.family.id} uses phrases no person approved: ${unapproved.join(', ')}. An instance holds approved phrases only.\n`,
    );
    return 2;
  }
  const review = await reviewStatus(loaded);
  if (review.state !== 'signed' && review.state !== 'pending') {
    io.err(`✗ ${reviewLine(review, io)}\n`);
    return 2;
  }
  const outDir = resolve(io.cwd, options.out);
  const earlier = await earlierOutput(outDir);
  if (earlier.length > 0 && !options.force) {
    io.err(
      `${display(outDir, io)} holds the output of an earlier run (${earlier.join(', ')}). Pass --force to replace it.\n`,
    );
    return 2;
  }

  const build = {
    n: n as number,
    seed: seed as number,
    review: review.state,
    // The seed folder sits beside the variant's spec, in its instance folder; the spec names it relative to itself.
    seedFrom: (_instance: string, variant: string) => `./${seedFolderName(variant)}`,
  };
  let instances: Instance[];
  try {
    instances = await buildInstances(loaded, build);
  } catch (cause) {
    if (!(cause instanceof FamilyError)) throw cause;
    io.err(`✗ ${loaded.family.id} has a defect; nothing is written: ${cause.message}\n`);
    return 1;
  }
  const broken = instances.flatMap((instance) =>
    instance.style.broken.map((entry) => ({ instance: instance.name, ...entry })),
  );
  if (broken.length > 0) {
    io.err(
      `✗ A style knob changes the expected outcome, so the oracle or the family is wrong; nothing is written:\n`,
    );
    for (const entry of broken.slice(0, 20)) {
      io.err(`  ${entry.instance} ${entry.variant}: ${entry.knob} = ${entry.value}: ${entry.problem}\n`);
    }
    if (broken.length > 20) io.err(`  and ${broken.length - 20} more\n`);
    return 1;
  }

  const report = familyReport(loaded, instances, build);
  await writeInstances(outDir, loaded, instances, report, {
    force: options.force === true,
    header: `Generated by driftbench family instances ${portable(relative(io.cwd, loaded.path))} --n ${build.n} --seed ${build.seed}.`,
  });
  if (options.json) {
    io.out(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  const styles = instances.reduce((sum, instance) => sum + instance.style.alternatives, 0);
  io.out(`Family ${loaded.family.id}: ${build.n} instances, seed ${build.seed}, ${report.specs} specs.\n`);
  for (const instance of report.instances) {
    io.out(
      `  ${instance.name}  seed ${instance.seed}  ${knobLine(instance.knobs)}  ${instance.variants.map((v) => v.id).join(', ')}\n`,
    );
  }
  io.out(`Style invariant: ${styles} style alternatives rebuilt; none changed the expected outcome.\n`);
  io.out(`${reviewLine(review, io)}\n`);
  io.out(`Wrote ${report.specs} specs and family-report.json to ${display(outDir, io)}.\n`);
  return 0;
}

/**
 * Exit 0 when the reference passes every spec under the folder; 1 when it fails one, or one is invalid
 * (each listed: an oracle or a reference defect, never shipped); 3 when none fails but the reference could not
 * run one (a block not run: unverified, counted apart, never shipped); 2 on bad input: no adapter for the
 * reference, no spec under the folder, a bad number.
 */
export async function familyVerifyCommand(
  dir: string,
  options: VerifyOptions,
  io: Io,
  deps: CampaignDeps = defaultDeps,
): Promise<number> {
  const concurrency = whole(options.concurrency, 'concurrency', 1);
  if (typeof concurrency === 'string') {
    io.err(`${concurrency}\n`);
    return 2;
  }
  const root = resolve(io.cwd, dir);
  try {
    if (!(await stat(root)).isDirectory()) {
      io.err(`Family path is not a folder: ${display(root, io)}.\n`);
      return 2;
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    io.err(
      `Family folder does not exist: ${display(root, io)}. Write instances with driftbench family instances first.\n`,
    );
    return 2;
  }
  const target = parseTarget(options.reference);
  const adapter = await resolveAdapter(target, () => deps.adapterFor(target), io);
  if (!adapter) {
    return 2;
  }
  const report = await verifyInstances(root, {
    adapter,
    target,
    checks: deps.checks,
    artifacts: deps.artifacts ?? defaultReaders(),
    cwd: io.cwd,
    ...(concurrency === undefined ? {} : { concurrency }),
    now: () => deps.now(),
  });
  if (report.specs === 0) {
    io.err(
      `No spec found under ${display(root, io)}. Write instances with driftbench family instances first.\n`,
    );
    return 2;
  }
  await writeFile(join(root, VERIFY_REPORT_NAME), formatJson(report));
  const pending = await pendingReviewNote(root, report);
  if (options.json) {
    io.out(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.out(`Verify ${display(root, io)} on the reference ${showTarget(target)}: ${report.specs} specs.\n`);
    for (const result of report.results) {
      if (result.state === 'pass') {
        io.out(`  ✓ ${result.file}\n`);
        continue;
      }
      io.out(
        `  ${result.state === 'not_run' ? '-' : '✗'} ${result.file}  ${result.state === 'not_run' ? 'not run' : result.state}${result.error ? `: ${result.error}` : ''}\n`,
      );
      for (const failing of result.failing.slice(0, 8)) {
        io.out(
          `      block ${failing.block}${failing.blockId ? ` (${failing.blockId})` : ''} ${failing.id}: ${failing.evidence}\n`,
        );
      }
      if (result.failing.length > 8) io.out(`      and ${result.failing.length - 8} more\n`);
    }
    const unverified = report.unverified ?? [];
    if (report.rejected.length === 0 && unverified.length === 0) {
      io.out(
        `✓ The reference passes all ${report.specs} specs: ${report.shipped.length} instances may ship.\n`,
      );
    } else if (report.rejected.length === 0) {
      io.out(
        `- The reference could not run ${unverified.length} instances (a block not run: a Given it cannot apply), so they are not verified and not shipped: ${unverified.join(', ')}. ${report.shipped.length} instances pass every variant.\n`,
      );
    } else {
      io.out(
        `✗ The reference fails ${report.results.filter((result) => result.state !== 'pass' && result.state !== 'not_run').length} of ${report.specs} specs. Each is an oracle or a reference defect: one of the two is wrong about the task. These instances are not shipped: ${report.rejected.join(', ')}.\n`,
      );
      if (report.shipped.length > 0)
        io.out(`  ${report.shipped.length} instances pass every variant: ${report.shipped.join(', ')}.\n`);
      if (unverified.length > 0)
        io.out(
          `  ${unverified.length} instances could not be run by the reference: ${unverified.join(', ')}.\n`,
        );
    }
    if (pending) io.out(`${pending}\n`);
    io.out(`Wrote ${display(join(root, VERIFY_REPORT_NAME), io)}.\n`);
  }
  // 1 when the reference fails an instance; 3 when none fails but one could not be run (never shipped either).
  return report.rejected.length > 0 ? 1 : (report.unverified ?? []).length > 0 ? 3 : 0;
}

/** A line when the instances were built while the family review was pending: release waits for it too. */
async function pendingReviewNote(root: string, report: VerifyReport): Promise<string | undefined> {
  const text = await readFile(join(root, 'family-report.json'), 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text) as { review?: unknown; family?: unknown };
    if (parsed.review !== 'pending') return undefined;
    return `Release also waits for a person to sign the review of ${String(parsed.family)} (${report.shipped.length} instances wait on it).`;
  } catch {
    return undefined;
  }
}

/**
 * Exit 0 when a signed review holds for the family as it is; 1 when a person still has to sign; 2 on bad
 * input or an invalid review file. --write replaces a missing, invalid, stale or pending review with a
 * pending one for the family as it stands; it never touches a signed review that still holds.
 */
export async function familyReviewCommand(path: string, options: ReviewOptions, io: Io): Promise<number> {
  const loaded = await loadOrSay(path, io);
  if (!loaded) return 2;
  let status = await reviewStatus(loaded);
  if (options.write && status.state !== 'signed') {
    await writePendingReview(loaded);
    status = await reviewStatus(loaded);
  }
  if (status.state === 'invalid') {
    io.err(`✗ ${reviewLine(status, io)}\n`);
    return 2;
  }
  if (options.json)
    io.out(
      `${JSON.stringify({ family: loaded.family.id, state: status.state, path: status.path }, null, 2)}\n`,
    );
  else io.out(`${reviewLine(status, io)}\n`);
  return status.state === 'signed' ? 0 : 1;
}

function reviewLine(status: ReviewStatus, io: Io): string {
  const file = display(status.path, io);
  switch (status.state) {
    case 'missing':
      return `The family has no review file ${file}. Write one with driftbench family review <family> --write; a person signs it.`;
    case 'invalid':
      return `The review file ${file} is invalid: ${status.message}.`;
    case 'stale':
      return `The review ${file} was signed for another version: ${status.changed.join(' and ')} changed since. A person reviews the family again (driftbench family review <family> --write).`;
    case 'pending':
      return `Review: pending. ${file} is not signed yet; the instances record it, and a person signs it before release.`;
    case 'signed':
      return `Review: signed by ${status.review.signed_by} on ${status.review.signed_on}.`;
  }
}

function knobLine(knobs: Readonly<Record<string, string | number>>): string {
  return Object.entries(knobs)
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');
}

function where(issue: FamilyIssue): string {
  return issue.path === '' ? '(file)' : issue.path;
}

function whole(text: string | undefined, name: string, minimum: number): number | string | undefined {
  if (text === undefined) return undefined;
  const value = optionNumber(text);
  if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(value) || value < minimum) {
    return `--${name} must be a whole number of at least ${minimum}, got "${text}".`;
  }
  return value;
}

function display(path: string, io: Io): string {
  const shown = relative(io.cwd, path);
  return shown === '' ? '.' : shown.startsWith('..') || isAbsolute(shown) ? path : shown;
}

function portable(path: string): string {
  return path.split(sep).join('/');
}
