import { appendFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { TokenPrices } from '@agent-nexus/driftbench-core';
import { type PointerScanOptions, pointer, type ScanEstateResult } from '@agent-nexus/driftbench-estate';
import type { FetchLike } from '@agent-nexus/driftbench-generate';
import { exists, reason, show, writeOut } from '../files';
import type { Io } from '../io';

/** The scan options that switch the pointer reader on. */
export type EstatePointerOptions = {
  pointer?: boolean;
  /** A YAML file of label sets; without it the shipped agent-rules set is used. */
  labels?: string;
  cassette?: string;
  /** Call the labelers on a cassette miss and write the answer. Without it a miss is an error. */
  record?: boolean;
  /** `<class>:<client>[:<model>]`, once or repeated. Without any, the default stack. */
  labeler?: string[];
  labelerThreshold?: string;
  labelerPassAt?: string;
  labelerFailAt?: string;
  labelerMarginCut?: string;
  /** The name of the environment variable that holds the bearer token of an http labeler. */
  labelerKey?: string;
  jobs?: string;
  /** A table of USD per million tokens (YAML), to price the tokens the labelers used. */
  prices?: string;
  ledger?: string;
  ledgerCheck?: boolean;
  /** Write the ledger. Without it, the ledger is read and left as it is. */
  update?: boolean;
};

export type PointerHandle = {
  scan: PointerScanOptions;
  /** The classes and clients that read the prose, in one line. */
  describe: string;
  /** After the scan: write the cassette and the ledger, or check the ledger. Returns an exit code. */
  finish(result: ScanEstateResult): Promise<number>;
};

/** The default number of requests in flight at once. */
export const DEFAULT_JOBS = 4;

function fraction(value: string | undefined, flag: string, io: Io): number | undefined | null {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (value.trim() === '' || !Number.isFinite(number) || number < 0 || number > 1) {
    io.err(`error: ${flag} is a number from 0 to 1, not "${value}"\n`);
    return null;
  }
  return number;
}

/** Writes a file whole or not at all: to a neighbour, then a rename. */
async function writeAtomic(path: string, text: string, io: Io): Promise<boolean> {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, text);
    await rename(temporary, path);
    return true;
  } catch (cause) {
    io.err(`Cannot write ${show(path, io)}: ${reason(cause)}\n`);
    return false;
  }
}

/** The environment with the anthropic key behind a getter, read from the real environment when asked. */
function lazyKey(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.create(env, {
    ANTHROPIC_API_KEY: { enumerable: true, get: () => env.ANTHROPIC_API_KEY },
  }) as Record<string, string | undefined>;
}

/** Reads the label sets, the labelers, the cassette and the last ledger. Undefined after telling the user what is wrong. */
export async function openPointer(
  options: EstatePointerOptions,
  io: Io,
  env: Record<string, string | undefined>,
  fetch?: FetchLike,
  root: string = io.cwd,
): Promise<PointerHandle | undefined> {
  if (!options.cassette) {
    io.err('error: --pointer needs --cassette <file>: the file that holds the recorded answers\n');
    return undefined;
  }
  // The settings file at the root of the estate; each command-line option wins over its key.
  const read = await pointer.readPointerSettings(root);
  if (!read.ok) {
    io.err(`Cannot use the pointer settings of ${pointer.SETTINGS_FILE}:\n`);
    for (const error of read.errors) io.err(`  ${error}\n`);
    return undefined;
  }
  const settings = read.settings;
  if (settings.keys.length > 0)
    io.out(`Pointer settings from ${pointer.SETTINGS_FILE}: ${settings.keys.join(', ')}.\n`);
  const specs: pointer.LabelerSpec[] = [];
  const labelers = options.labeler?.length
    ? options.labeler
    : (settings.labeler ?? pointer.DEFAULT_LABELER_SPECS);
  for (const text of labelers) {
    const parsed = pointer.parseLabelerSpec(text);
    if (!parsed.ok) {
      io.err(`error: --labeler ${parsed.message}\n`);
      return undefined;
    }
    specs.push(parsed.spec);
  }
  const flags = {
    threshold: fraction(options.labelerThreshold, '--labeler-threshold', io),
    passAt: fraction(options.labelerPassAt, '--labeler-pass-at', io),
    failAt: fraction(options.labelerFailAt, '--labeler-fail-at', io),
    marginCut: fraction(options.labelerMarginCut, '--labeler-margin-cut', io),
  };
  if (Object.values(flags).some((value) => value === null)) return undefined;
  const fromFile = settings.threshold ?? {};
  const threshold = flags.threshold ?? fromFile.labeler;
  const passAt = flags.passAt ?? fromFile.passAt;
  const failAt = flags.failAt ?? fromFile.failAt;
  const marginCut = flags.marginCut ?? fromFile.marginCut;
  let jobs = DEFAULT_JOBS;
  if (options.jobs !== undefined) {
    jobs = Number(options.jobs);
    if (!Number.isInteger(jobs) || jobs < 1 || jobs > 64) {
      io.err(`error: --jobs is a whole number from 1 to 64, not "${options.jobs}"\n`);
      return undefined;
    }
  }
  let setsText = pointer.AGENT_RULES_SET;
  const labelsPath = options.labels
    ? resolve(io.cwd, options.labels)
    : settings.labels && 'path' in settings.labels
      ? resolve(root, settings.labels.path)
      : undefined;
  if (labelsPath) {
    try {
      setsText = await readFile(labelsPath, 'utf8');
    } catch (cause) {
      io.err(`Cannot read the label sets ${show(labelsPath, io)}: ${reason(cause)}\n`);
      return undefined;
    }
  } else if (settings.labels && 'text' in settings.labels) setsText = settings.labels.text;
  const sets = pointer.parseLabelSets(setsText);
  if (!sets.ok) {
    const where = labelsPath
      ? ` in ${show(labelsPath, io)}`
      : settings.labels
        ? ` in ${pointer.SETTINGS_FILE}`
        : '';
    io.err(`Cannot use the label sets${where}: ${sets.message}\n`);
    return undefined;
  }
  const record = options.record === true;
  const built = await pointer.buildLabelling(specs, {
    // The anthropic key is read when a request leaves, not here: a run that sends nothing never reads it.
    env: lazyKey(env),

    record,
    // A module named in the settings file sits beside the estate; one named by --labeler, beside the shell.
    cwd: options.labeler?.length ? io.cwd : root,
    ...(threshold === undefined ? {} : { threshold }),
    ...(passAt === undefined ? {} : { passAt }),
    ...(failAt === undefined ? {} : { failAt }),
    ...(marginCut === undefined ? {} : { marginCut }),
    ...(options.labelerKey ? { keyVariable: options.labelerKey } : {}),
    ...(fetch ? { fetch } : {}),
  });
  if (!built.ok) {
    io.err(`error: ${built.message}\n`);
    return undefined;
  }
  const cassettePath = resolve(io.cwd, options.cassette);
  let cassette = new pointer.Cassette();
  if (await exists(cassettePath)) {
    try {
      cassette = pointer.Cassette.parse(await readFile(cassettePath, 'utf8'));
    } catch (cause) {
      io.err(`Cannot use the cassette ${show(cassettePath, io)}: ${reason(cause)}\n`);
      return undefined;
    }
  } else if (!record) {
    io.err(`Cannot find the cassette ${show(cassettePath, io)}: record it with --record\n`);
    return undefined;
  }
  if (record) {
    // Each answer is appended as it arrives, so a run that stops keeps what it paid for.
    await mkdir(dirname(cassettePath), { recursive: true });
    cassette.onPut = (entry) => appendFileSync(cassettePath, `${pointer.canonical(entry)}\n`);
  }
  const ledgerPath = options.ledger
    ? resolve(io.cwd, options.ledger)
    : settings.ledger
      ? resolve(root, settings.ledger)
      : undefined;
  let previous: pointer.Ledger | undefined;
  let previousText: string | undefined;
  if (ledgerPath && (await exists(ledgerPath))) {
    previousText = await readFile(ledgerPath, 'utf8');
    previous = pointer.parseLedger(previousText);
    if (!previous) {
      io.err(`Cannot use the ledger ${show(ledgerPath, io)}: it is not a ledger\n`);
      return undefined;
    }
  }
  if (options.ledgerCheck && !ledgerPath) {
    io.err('error: --ledger-check needs --ledger <file>\n');
    return undefined;
  }
  if (options.update && !ledgerPath) {
    io.err('error: --update needs --ledger <file>: the ledger it writes\n');
    return undefined;
  }
  if (options.update && options.ledgerCheck) {
    io.err('error: --update writes the ledger and --ledger-check writes nothing: pass one of them\n');
    return undefined;
  }
  const labelling = built.labelling;
  return {
    describe: labelling.describe,
    scan: {
      sets: sets.sets,
      labelling,
      cassette,
      mode: record ? 'record' : 'replay',
      jobs,
      onPlan: (plan) => {
        if (!record || plan.members.every((member) => member.windows === member.cached)) return;
        io.out(
          `Pointer plan: ${plan.units} units in ${plan.files} files, ${plan.carried} already labelled by the ledger.\n`,
        );
        for (const member of plan.members) {
          io.out(
            `  ${className(member.cls)} ${member.id} ${member.model}: ${member.windows} requests, ${member.cached} in the cassette, ${member.characters} characters to send.\n`,
          );
        }
      },
      ...(previous ? { previous } : {}),
    },
    async finish(result) {
      const done = result.pointer;
      if (!done) return 0;
      // The cassette on disk holds the appended answers in the order they arrived; rewrite it sorted.
      if (record && done.recorded > 0 && !(await writeAtomic(cassettePath, cassette.render(), io))) return 2;
      if (!ledgerPath) return 0;
      const text = pointer.renderLedger(done.ledger);
      if (options.ledgerCheck) {
        if (text === previousText) return 0;
        io.err(`The ledger ${show(ledgerPath, io)} is out of date: rescan with --update and commit it\n`);
        return 1;
      }
      if (options.update) return (await writeOut(ledgerPath, text, io)) ? 0 : 2;
      if (text !== previousText)
        io.out(`The ledger ${show(ledgerPath, io)} is not written: pass --update to write it.\n`);
      return 0;
    },
  };
}

const className = (cls: pointer.LabelerClass): string => (cls === 'system1' ? 'system 1' : 'system 2');

/** The cost of one side of a run (the requests sent, or the answers replayed): USD over the priced models. */
type Side = { usd: number; priced: number; missing: Set<string>; any: boolean };

/** What a run cost in USD, for what it sent and for what it replayed, and the models it used. */
type Spend = { sent: Side; recorded: Side; used: Set<string> };

const newSide = (): Side => ({ usd: 0, priced: 0, missing: new Set(), any: false });
const newSpend = (): Spend => ({ sent: newSide(), recorded: newSide(), used: new Set() });

/** USD for tokens at a model's price, or undefined when the table has no price for the model. */
function usdOf(prices: TokenPrices | undefined, model: string, input: number, output: number) {
  const price = prices && Object.hasOwn(prices.models, model) ? prices.models[model] : undefined;
  return price ? (input * price.input + output * price.output) / 1_000_000 : undefined;
}

const dollars = (usd: number): string => `${usd.toFixed(4)} USD`;

/** Adds the tokens of one labeler to a side, and returns their USD, or undefined when the model has no price. */
function addTo(
  side: Side,
  prices: TokenPrices | undefined,
  model: string,
  input: number,
  output: number,
): number | undefined {
  side.any = true;
  const usd = usdOf(prices, model, input, output);
  if (usd === undefined) side.missing.add(model);
  else {
    side.usd += usd;
    side.priced++;
  }
  return usd;
}

/**
 * The lines of the tokens each labeler used: the requests sent, the answers replayed from the cassette (their
 * tokens come from the recording), and the cost of both when a price table is given.
 */
function tokenLines(
  entries: readonly pointer.LabelerUsage[],
  topic: string,
  prices: TokenPrices | undefined,
  spend: Spend,
): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    const who = `${topic}${className(entry.cls)} ${entry.id} ${entry.model}`;
    if (entry.calls > 0 || entry.input + entry.output > 0) {
      lines.push(`  Tokens, ${who}: ${entry.input} in, ${entry.output} out, ${entry.calls} requests sent.`);
      spend.used.add(entry.model);
      const usd = addTo(spend.sent, prices, entry.model, entry.input, entry.output);
      if (usd !== undefined) lines.push(`  Cost, ${who}: ${dollars(usd)}.`);
    }
    if (entry.replayed > 0) {
      lines.push(
        `  Tokens replayed from the cassette, ${who}: ${entry.replayedInput} in, ${entry.replayedOutput} out, ${entry.replayed} requests.`,
      );
      spend.used.add(entry.model);
      const usd = addTo(spend.recorded, prices, entry.model, entry.replayedInput, entry.replayedOutput);
      if (usd !== undefined) lines.push(`  Cost when recorded, ${who}: ${dollars(usd)}.`);
    }
  }
  return lines;
}

/**
 * The closing lines of the cost: for each side the total and the models it leaves out, or that no cost is
 * known when the table prices none of them, or how to get a price. A field of the table that the cost does not
 * use is named.
 */
function costLines(
  spend: Spend,
  prices: TokenPrices | undefined,
  indent: string,
  names: { sent: string; recorded: string },
): string[] {
  if (!spend.sent.any && !spend.recorded.any) return [];
  if (!prices) return [`${indent}No prices given: pass --prices <file> to see the cost in USD.`];
  const lines: string[] = [];
  const sides = [
    { side: spend.sent, name: names.sent },
    { side: spend.recorded, name: names.recorded },
  ];
  for (const { side, name } of sides) {
    if (!side.any) continue;
    const models = [...side.missing].sort();
    lines.push(
      side.priced === 0
        ? `${indent}No cost is known: the price table has no price for ${models.join(', ')}.`
        : `${indent}${name}: ${dollars(side.usd)}${models.length > 0 ? `, without ${models.join(', ')}` : ''}.`,
    );
  }
  for (const model of [...spend.used].sort()) {
    const price = Object.hasOwn(prices.models, model) ? prices.models[model] : undefined;
    if (price && price.cached_input > 0)
      lines.push(
        `${indent}Note: the price table gives cached_input for ${model}. It is not used: the labelers report no cached tokens.`,
      );
  }
  return lines;
}

/**
 * What the labelers used in one scan, in lines for `estate build`, which keeps the rest of the scan output
 * to itself: the requests sent and the answers replayed with their tokens, then the cost when prices are given.
 */
export function usageSummary(result: ScanEstateResult, prices: TokenPrices | undefined): string[] {
  const entries = [...(result.pointer?.usage ?? []), ...(result.documentRoles?.usage ?? [])];
  if (entries.length === 0) return [];
  const sum = (pick: (entry: pointer.LabelerUsage) => number) =>
    entries.reduce((total, entry) => total + pick(entry), 0);
  const sent = sum((entry) => entry.calls);
  const replayed = sum((entry) => entry.replayed);
  const parts = [
    sent > 0
      ? `${sent} requests sent (${sum((entry) => entry.input)} in, ${sum((entry) => entry.output)} out)`
      : '0 requests sent',
    ...(replayed > 0
      ? [
          `${replayed} answers replayed from the cassette (${sum((entry) => entry.replayedInput)} in, ${sum((entry) => entry.replayedOutput)} out)`,
        ]
      : []),
  ];
  const spend = newSpend();
  for (const entry of entries) {
    if (entry.calls > 0 || entry.input + entry.output > 0) {
      spend.used.add(entry.model);
      addTo(spend.sent, prices, entry.model, entry.input, entry.output);
    }
    if (entry.replayed > 0) {
      spend.used.add(entry.model);
      addTo(spend.recorded, prices, entry.model, entry.replayedInput, entry.replayedOutput);
    }
  }
  return [
    `   Labelers: ${parts.join('; ')}.`,
    ...costLines(spend, prices, '   ', { sent: 'Cost', recorded: 'Cost when recorded' }),
  ];
}

/** The lines a scan prints about the pointer reader: counts and tokens, never a unit. */
export function pointerLines(result: ScanEstateResult, describe: string, prices?: TokenPrices): string[] {
  const done = result.pointer;
  if (!done) return [];
  const live = done.ledger.entries.filter((entry) => entry.status === 'live').length;
  const lines = [
    `  Pointer reader: ${describe}.`,
    `  Units: ${live} in ${done.cuts.size} files; ${done.carried} kept from the ledger, ${done.decided} labelled by this run (${done.decidedBy.system1} by system 1, ${done.decidedBy.system2} by system 2${done.fellBack > 0 ? `, ${done.fellBack} of them because the other labeler gave no opinion` : ''}), ${done.unlabeled} unlabeled${done.split > 0 ? `; the runs of one labeler disagreed on ${done.split} units` : ''}${done.spanSplit > 0 ? `; the runs drew the spans of ${done.spanSplit} units differently, and the first run's spans stand` : ''}; ${done.atoms} atoms${done.dropped.length > 0 ? `; ${done.dropped.length} notes (spans or links) were dropped, listed below` : ''}.`,
    `  Requests: ${done.windows} answered, ${done.calls} sent, ${done.recorded} recorded.`,
  ];
  const spend = newSpend();
  lines.push(...tokenLines(done.usage, '', prices, spend));
  const events = Object.entries(done.events).filter(([, count]) => count > 0);
  lines.push(
    `  Units since the last ledger: ${events.map(([event, count]) => `${event} ${count}`).join(', ')}.`,
  );
  const roles = result.documentRoles;
  if (roles) {
    lines.push(
      `  Document roles: ${Object.keys(roles.labelled).length} files labelled by the document-roles set; requests ${roles.windows} answered, ${roles.calls} sent, ${roles.recorded} recorded.`,
    );
    lines.push(...tokenLines(roles.usage, 'document roles, ', prices, spend));
    for (const failure of roles.failed) lines.push(`    document-role window failed: ${failure}`);
  }
  lines.push(
    ...costLines(spend, prices, '  ', { sent: 'Cost in all', recorded: 'Cost when recorded in all' }),
  );
  for (const failure of done.failed) lines.push(`    window failed: ${failure}`);
  for (const refusal of [...done.refusals, ...done.atomRefusals]) lines.push(`    refused: ${refusal}`);
  for (const note of done.dropped) lines.push(`    dropped: ${note}`);
  for (const note of done.outOfStep ?? []) lines.push(`    out of step: ${note}`);
  for (const note of done.reasked ?? []) lines.push(`    asked again: ${note}`);
  return lines;
}
