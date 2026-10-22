import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadEstateMap, Plan, readerFor } from '@agent-nexus/driftbench-estate';
import {
  defaultStateLibrary,
  ESTATE_COMPLETE_DIR,
  ESTATE_INCOMPLETE_DIR,
  ESTATE_ORDER_FILE,
  ESTATE_REPORT_FILE,
  type EstateGenerateResult,
  EstateInputError,
  formatJson,
  generateEstateSuite,
  PhraseBank,
  readEstateYaml,
  renderEstateSummary,
  SessionIndex,
  STATE_LIBRARY_FILE,
  STATIC_DIR,
  stateIdsOf,
  UNIT_DIR,
  type YamlSchema,
} from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import { exists } from '../files';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { mapCacheOptions } from './map-cache';
import { readBlockSections, SECTIONS_OPTION } from './sections-option';

export type EstateGenerateOptions = {
  map: string;
  plan: string;
  out: string;
  seed?: string;
  phrases?: string;
  sessions?: string;
  force?: boolean;
  json?: boolean;
  /** False with --no-fallback: no code-written ask, no outcome read from the atoms. */
  fallback?: boolean;
  /** False with --no-judge: a domain predicate no code checks stays a gap. */
  judge?: boolean;
  focus?: string;
  /** The state library of the run (`estate run --states`); else the one this command writes. */
  states?: string;
  /** Section registries of prompts of the estate, `--sections`. */
  sections?: string[];
};

/** The phrase bank and the session index the command looks for beside the map when none is named. */
export const DEFAULT_PHRASES = 'phrases.yaml';
export const DEFAULT_SESSIONS = join('sessions', 'index.yaml');
/** The state library the command looks for beside the map when none is named. */
export const DEFAULT_STATES = join('live', 'states', 'library.json');

/**
 * Adds `estate generate` to `driftbench estate`: the approved plan rows of an estate become task specs, by
 * code only, with no model call. The ask comes from the phrase bank, the Then from the atoms' evidence.
 */
export function registerEstateGenerateCommand(
  estate: Command,
  io: Io,
  setExit: (code: number) => void,
): void {
  estate
    .command('generate')
    .description('Generate task specs from an approved estate plan, by code: one or more specs per plan row')
    .requiredOption('--map <file>', 'the approved estate map')
    .requiredOption('--plan <file>', 'the estate plan made from that map')
    .requiredOption('--out <dir>', `the folder to write the specs and ${ESTATE_REPORT_FILE} into`)
    .option('--seed <n>', 'the integer seed of every phrase choice (default 1)')
    .option('--phrases <file>', `the approved phrase bank (default ${DEFAULT_PHRASES} beside the map)`)
    .option(
      '--sessions <file>',
      `the index of recorded sessions for replay rows (default ${DEFAULT_SESSIONS} beside the map, when present)`,
    )
    .option(
      '--no-fallback',
      'write no ask by code and read no outcome from the atoms: a row the bank does not cover stays incomplete',
    )
    .option('--no-judge', 'judge no domain predicate: one that no code checks stays needs-registered-check')
    .option(
      '--focus <file>',
      `atom ids, one per line, whose complete specs come first in ${ESTATE_ORDER_FILE} (then guards, gates, invariants)`,
    )
    .option(
      '--states <file>',
      `the state library the runs will use (estate run --states): a row is planned only for the session states and events it holds; default ${DEFAULT_STATES} beside the map, when present, else the library this command writes to ${STATE_LIBRARY_FILE}`,
    )
    .option('--sections <registry>', SECTIONS_OPTION, (value: string, previous: string[] = []) => [
      ...previous,
      value,
    ])
    .option('--force', 'replace the output of an earlier run in the folder')
    .option('--json', 'print the report as JSON')
    .action(async (options: EstateGenerateOptions) => {
      setExit(await estateGenerateCommand(options, io));
    });
}

/**
 * Exit 0 when every approved row gave complete specs, 1 when the suite is written with incomplete specs,
 * rows waiting for approval or a generator defect (each listed), 2 on a usage or input error (nothing is
 * written): an invalid map, plan, bank or session index, inputs that do not fit together, a bad seed, an
 * earlier output without --force.
 */
export async function estateGenerateCommand(options: EstateGenerateOptions, io: Io): Promise<number> {
  let seed: number | undefined;
  if (options.seed !== undefined) {
    const value = optionNumber(options.seed);
    if (!/^\d+$/.test(options.seed.trim()) || !Number.isSafeInteger(value)) {
      io.err(`--seed must be a whole number of at least 0, got "${options.seed}".\n`);
      return 2;
    }
    seed = value;
  }
  const mapPath = resolve(io.cwd, options.map);
  const planPath = resolve(io.cwd, options.plan);
  const outPath = resolve(io.cwd, options.out);
  const phrasesPath = resolve(io.cwd, options.phrases ?? join(dirname(mapPath), DEFAULT_PHRASES));
  let sessionsPath: string | undefined;
  if (options.sessions !== undefined) sessionsPath = resolve(io.cwd, options.sessions);
  else {
    const beside = join(dirname(mapPath), DEFAULT_SESSIONS);
    if (await exists(beside)) sessionsPath = beside;
  }

  const loaded = await loadEstateMap(mapPath, mapCacheOptions());
  if (!loaded.ok) {
    io.err(`✗ ${display(mapPath, io)}  the estate map is refused\n`);
    for (const issue of loaded.errors)
      io.err(`  ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`);
    return 2;
  }
  const plan = await readYaml(planPath, Plan, 'plan', io);
  // No bank beside the map (and none named): generate with an empty one, so a model-free run still gets
  // the gap report. With the fallback on, code writes every ask; with --no-fallback, each live row names
  // the approved phrase it needs. A bank named and missing is an input error.
  const noBank = options.phrases === undefined && !(await exists(phrasesPath));
  const bank = noBank
    ? PhraseBank.parse({
        version: 1,
        estate: basename(dirname(mapPath)),
        mapHash: loaded.map.hash,
        situations: [],
      })
    : await readYaml(phrasesPath, PhraseBank, 'phrase bank', io);
  if (noBank && !options.json) {
    io.out(
      options.fallback === false
        ? `No phrase bank at ${display(phrasesPath, io)}: generating with an empty one; each live row names the phrase it needs.\n`
        : `No phrase bank at ${display(phrasesPath, io)}: code writes every ask from the atoms.\n`,
    );
  }
  let focus: string[] | undefined;
  if (options.focus !== undefined) {
    const focusPath = resolve(io.cwd, options.focus);
    try {
      focus = (await readFile(focusPath, 'utf8'))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'));
    } catch (cause) {
      io.err(
        `✗ ${display(focusPath, io)}  the focus list cannot be read: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      return 2;
    }
    const known = new Set(loaded.map.atoms.map((atom) => atom.id));
    const unknown = focus.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      io.err(
        `✗ ${display(focusPath, io)}  ${unknown.length} focus id${unknown.length === 1 ? ' is' : 's are'} no atom of the map: ${unknown.join(', ')}\n`,
      );
      return 2;
    }
  }
  const sessions =
    sessionsPath === undefined ? undefined : await readYaml(sessionsPath, SessionIndex, 'session index', io);
  if (!plan || !bank || (sessionsPath !== undefined && !sessions)) return 2;

  // The files of the estate as a run copies them: a read is expected only of one of them. Without the
  // estate folder (the map moved), the files the map knows. A folder that holds none of the files the
  // atoms were read from is not the estate: the map was copied away from it.
  let files: string[] | undefined;
  const root = resolve(dirname(mapPath), loaded.map.root);
  const lister = readerFor(loaded.map.runtime, { ignore: loaded.map.ignore ?? [] });
  const listed =
    lister?.listFiles && (await stat(root).catch(() => undefined))?.isDirectory()
      ? await lister.listFiles(root)
      : undefined;
  const sources = new Set(loaded.map.atoms.map((atom) => atom.provenance.file));
  if (listed?.some((file) => sources.has(file))) {
    files = listed;
  } else if (!options.json) {
    io.out(
      `The estate folder ${display(root, io)} ${listed ? 'holds none of the files the map was read from' : 'cannot be listed'}: reads are checked against the files the map knows.\n`,
    );
  }

  // The prompts of the estate with a section registry, named as the atoms name their files: from the root.
  const sections =
    (options.sections ?? []).length > 0
      ? await readBlockSections(options.sections ?? [], root, io)
      : undefined;
  if ((options.sections ?? []).length > 0 && !sections) return 2;

  // The state library the runs use: the one named, or the one this command writes beside the specs. A row whose
  // cell needs a session state or an event the library lacks waits, named, never as a spec that stops at its turn.
  let stateIds: ReturnType<typeof stateIdsOf>;
  let statesPath: string | undefined;
  if (options.states !== undefined) statesPath = resolve(io.cwd, options.states);
  else {
    const beside = join(dirname(mapPath), DEFAULT_STATES);
    if (await exists(beside)) statesPath = beside;
  }
  const written = statesPath === undefined ? defaultStateLibrary() : undefined;
  if (statesPath !== undefined) {
    stateIds = stateIdsOf(await readFile(statesPath, 'utf8').catch(() => ''));
    if (!stateIds) {
      io.err(
        `✗ ${display(statesPath, io)}  the state library cannot be read: one JSON object with states and events\n`,
      );
      return 2;
    }
  } else stateIds = written?.ids;
  const reportPath = join(outPath, ESTATE_REPORT_FILE);
  let result: EstateGenerateResult;
  try {
    result = generateEstateSuite(
      { map: loaded.map, plan, bank, ...(sessions ? { sessions } : {}) },
      {
        ...(seed === undefined ? {} : { seed }),
        ...(options.fallback === false ? { fallback: false } : {}),
        ...(options.judge === false ? { judge: false } : {}),
        ...(files ? { files } : {}),
        ...(focus ? { focus } : {}),
        ...(sections ? { sections } : {}),
        ...(stateIds ? { stateIds } : {}),
        paths: {
          map: portable(relative(outPath, mapPath)),
          plan: portable(relative(outPath, planPath)),
          phrases: noBank ? '(none)' : portable(relative(outPath, phrasesPath)),
          ...(sessionsPath === undefined ? {} : { sessions: portable(relative(outPath, sessionsPath)) }),
        },
      },
    );
  } catch (cause) {
    if (cause instanceof EstateInputError) {
      io.err(`The inputs do not fit together: ${cause.message}.\n`);
      for (const issue of cause.issues) io.err(`  ${issue.path}  ${issue.message}\n`);
      return 2;
    }
    io.err(`Cannot generate: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }

  if (await exists(reportPath)) {
    if (!options.force) {
      io.err(
        `${display(reportPath, io)} already exists: an earlier run wrote this folder. Pass --force to replace its output.\n`,
      );
      return 2;
    }
    for (const entry of [
      ESTATE_COMPLETE_DIR,
      ESTATE_INCOMPLETE_DIR,
      ESTATE_REPORT_FILE,
      ESTATE_ORDER_FILE,
      STATIC_DIR,
      UNIT_DIR,
      'states',
    ]) {
      await rm(join(outPath, entry), { recursive: true, force: true });
    }
  }
  for (const file of [...result.files, ...(written?.files ?? [])]) {
    const target = join(outPath, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.text);
  }

  const report = result.report;
  // Rows that wait for a session state or an event the library lacks: counted and named, so nobody misses them.
  const waitingForStates = report.incomplete.filter((entry) =>
    entry.reasons.some((reason) => reason.marker === 'needs-state-operation'),
  );
  if (waitingForStates.length > 0) {
    const values = [
      ...new Set(
        waitingForStates.flatMap((entry) =>
          entry.reasons
            .filter((reason) => reason.marker === 'needs-state-operation')
            .map((reason) => reason.detail),
        ),
      ),
    ].sort();
    io.err(
      `${new Set(waitingForStates.map((entry) => entry.row)).size} rows need states not in the library: ${values.join(', ')}. Pass --states <library> that holds them, or add them to ${STATE_LIBRARY_FILE}.\n`,
    );
  }
  if (options.json) io.out(formatJson(report));
  else
    io.out(`${renderEstateSummary(report)}Wrote ${result.files.length} files to ${display(outPath, io)}.\n`);
  const defects = report.invalid.length > 0 || report.lint.length > 0;
  return report.summary.incomplete > 0 || report.waiting.length > 0 || defects ? 1 : 0;
}

async function readYaml<T>(
  path: string,
  schema: YamlSchema<T>,
  what: string,
  io: Io,
): Promise<T | undefined> {
  const read = await readEstateYaml(path, schema);
  if (read.ok) return read.value;
  io.err(`✗ ${display(path, io)}  the ${what} cannot be read or is invalid\n`);
  for (const issue of read.issues) io.err(`  ${issue.path || '(file)'}  ${issue.message}\n`);
  return undefined;
}

function display(path: string, io: Io): string {
  const shown = relative(io.cwd, path);
  return shown === '' ? '.' : shown.startsWith('..') || isAbsolute(shown) ? path : shown;
}

function portable(path: string): string {
  return path.split(sep).join('/');
}
