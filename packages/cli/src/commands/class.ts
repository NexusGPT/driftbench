import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { loadSpecFile, type Spec } from '@agent-nexus/driftbench-core';
import {
  classes,
  createAnthropicPort,
  createOpenAiPort,
  familyOf,
  ModelError,
  type ModelPort,
} from '@agent-nexus/driftbench-generate';
import type { Command } from 'commander';
import { stringify } from 'yaml';
import type { Io } from '../io';
import { optionNumber } from '../number';
import { noStoreAt } from '../store-path';
import { type CampaignDeps, defaultDeps } from './campaign';

/**
 * `driftbench class`: utterance classes. `plan` prints the covering array of a class file; `realise` writes one
 * candidate per planned row with a realiser model, gates each one, and freezes the accepted realisations;
 * `audit` has labellers of two model families label the accepted items; `expand` writes one copy of a spec per
 * frozen realisation of each block that names a class; `envelope` reports the class blocks of a campaign.
 * Every model seat can run from a cassette: without `--record` nothing reaches a provider and no key is read.
 */

const SEAT_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
/** Post-gate t-way coverage under which `class realise` exits 1. */
const MIN_COVERAGE = 0.95;

type PlanFlags = { t?: string; seed: string; rows?: string; json?: boolean };
type RealiseFlags = PlanFlags & {
  out: string;
  realiser: string;
  judge: string;
  style?: string;
  cassette?: string;
  record?: boolean;
  attempts: string;
};
type AuditFlags = {
  set: string;
  labeller: string[];
  cassette?: string;
  record?: boolean;
  out?: string;
  json?: boolean;
};
type ExpandFlags = { classes: string; out: string; json?: boolean };
type EnvelopeFlags = { store: string; json?: boolean };

export function registerClassCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  const cls = program
    .command('class')
    .description('Utterance classes: plan, realise and gate, audit, expand into specs, report the envelope');

  const planOptions = (command: Command) =>
    command
      .option('--t <n>', 'strength of the covering array; the class file says, default 2')
      .option('--seed <n>', 'seed of the tie-breaks', '1')
      .option('--rows <n>', 'rows wanted: the array is extended past its own size');

  planOptions(
    cls
      .command('plan')
      .description('Print the covering array of a class file and the tuples it covers')
      .argument('<class>', 'the class file'),
  )
    .option('--json', 'print the plan as JSON')
    .action(async (path: string, options: PlanFlags) => {
      setExit(await classPlanCommand(path, options, io));
    });

  planOptions(
    cls
      .command('realise')
      .description('Realise every planned row with a model, gate each candidate, and freeze the accepted set')
      .argument('<class>', 'the class file'),
  )
    .requiredOption('--out <file>', 'the frozen set to write, such as classes/refund.set.json')
    .requiredOption(
      '--realiser <provider:model>',
      'the model that writes candidates: anthropic, openai or gemini',
    )
    .requiredOption('--judge <provider:model>', 'the equivalence judge')
    .option('--style <provider:model>', 'the per-axis style check; the judge without it')
    .option('--cassette <file>', 'recorded answers: replayed, and written to with --record')
    .option('--record', 'ask the live models for answers the cassette lacks, and keep them')
    .option('--attempts <n>', 'attempts per planned row, the first included', '3')
    .option('--json', 'print the gate summary as JSON')
    .action(async (path: string, options: RealiseFlags) => {
      setExit(await classRealiseCommand(path, options, io));
    });

  cls
    .command('audit')
    .description('Have labellers of two model families label every accepted item; the union rule decides')
    .argument('<class>', 'the class file')
    .requiredOption('--set <file>', 'the frozen set')
    .requiredOption(
      '--labeller <provider:model>',
      'a labeller; give two of different families',
      (value: string, all: string[]) => [...all, value],
      [] as string[],
    )
    .option('--cassette <file>', 'recorded answers: replayed, and written to with --record')
    .option('--record', 'ask the live models for answers the cassette lacks, and keep them')
    .option('--out <file>', 'write the audit as JSON to this file')
    .option('--json', 'print the audit as JSON')
    .action(async (path: string, options: AuditFlags) => {
      setExit(await classAuditCommand(path, options, io));
    });

  cls
    .command('expand')
    .description('Write one copy of each spec per frozen realisation of every block that names a class')
    .argument('<specs...>', 'spec files or folders')
    .requiredOption('--classes <dir>', 'the folder of class files and their frozen sets (*.set.json)')
    .requiredOption('--out <dir>', 'the folder to write the copies into')
    .option('--json', 'print what was written as JSON')
    .action(async (paths: string[], options: ExpandFlags) => {
      setExit(await classExpandCommand(paths, options, io));
    });

  cls
    .command('envelope')
    .description(
      'Report each class block of a campaign over its realisations, apart from single-string blocks',
    )
    .argument('[campaignId]', 'the campaign; the latest campaign of the store without it')
    .requiredOption('--store <file>', 'the store that holds the runs')
    .option('--json', 'print the report as JSON')
    .action(async (campaignId: string | undefined, options: EnvelopeFlags) => {
      setExit(await classEnvelopeCommand(campaignId, options, io, deps));
    });
}

async function loadOrSay(path: string, io: Io): Promise<classes.UtteranceClass | undefined> {
  const loaded = await classes.loadClassFile(resolve(io.cwd, path));
  if (!loaded.ok) {
    io.err(`✗ ${path} is not a valid class file:\n`);
    for (const e of loaded.errors) io.err(`  ${e.path === '' ? '(file)' : e.path}  ${e.message}\n`);
    return undefined;
  }
  for (const w of loaded.warnings) io.err(`! ${w.path}  ${w.message}\n`);
  return loaded.class;
}

function whole(text: string | undefined, flag: string, min: number, io: Io): number | undefined | null {
  if (text === undefined) return undefined;
  const value = optionNumber(text);
  if (!Number.isInteger(value) || value < min) {
    io.err(`${flag} takes a whole number of at least ${min}, not "${text}".\n`);
    return null;
  }
  return value;
}

function planFlags(options: PlanFlags, io: Io): classes.PlanOptions | undefined {
  const t = whole(options.t, '--t', 1, io);
  const seed = whole(options.seed, '--seed', 0, io);
  const rows = whole(options.rows, '--rows', 1, io);
  if (t === null || seed === null || rows === null) return undefined;
  return { ...(t === undefined ? {} : { t }), seed: seed ?? 1, ...(rows === undefined ? {} : { rows }) };
}

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

/** `class plan`. Exit 0, or 2 on bad input. */
export async function classPlanCommand(path: string, options: PlanFlags, io: Io): Promise<number> {
  const plan = planFlags(options, io);
  const cls = plan && (await loadOrSay(path, io));
  if (!plan || !cls) return 2;
  let rows: classes.Row[];
  try {
    rows = classes.planClass(cls, plan);
  } catch (cause) {
    io.err(`✗ ${(cause as Error).message}\n`);
    return 2;
  }
  const t = plan.t ?? cls.strength;
  const coverage = classes.coverageOf(cls, rows, t);
  const axes = classes.classAxes(cls);
  if (options.json) {
    io.out(
      `${JSON.stringify({ class: cls.id, hash: classes.classHash(cls), axes, t, rows, coverage }, null, 2)}\n`,
    );
    return 0;
  }
  io.out(
    `Class ${cls.id} (hash ${classes.classHash(cls)}): ${axes.map((a) => `${a.name} ${a.values.length}`).join(', ')}.\n`,
  );
  io.out(
    `Strength ${t}: ${rows.length} rows cover ${coverage.covered} of ${coverage.required} ${t}-way tuples (${pct(coverage.share)}).\n`,
  );
  for (const [i, row] of rows.entries())
    io.out(`  ${String(i + 1).padStart(3)}  ${classes.cellKey(cls, row)}\n`);
  return 0;
}

type Seat = { provider: (typeof SEAT_PROVIDERS)[number]; model: string };

function parseSeat(text: string, flag: string, io: Io): Seat | undefined {
  const at = text.indexOf(':');
  const provider = text.slice(0, at) as Seat['provider'];
  const model = text.slice(at + 1);
  if (at < 1 || model === '' || !SEAT_PROVIDERS.includes(provider)) {
    io.err(`${flag} takes <provider:model> with provider ${SEAT_PROVIDERS.join(', ')}, not "${text}".\n`);
    return undefined;
  }
  return { provider, model };
}

function familyOfSeat(seat: Seat): string {
  if (seat.provider === 'anthropic') return 'anthropic';
  if (seat.provider === 'gemini') return 'google';
  return familyOf(seat.model, 'https://api.openai.com/v1');
}

/** The live port of a seat. Reads its key from the environment and never prints it. */
function livePort(seat: Seat): ModelPort {
  if (seat.provider === 'anthropic') {
    return createAnthropicPort({ env: { ...process.env, ANTHROPIC_MODEL: seat.model } });
  }
  if (seat.provider === 'gemini') {
    return createOpenAiPort({
      env: {
        OPENAI_API_KEY: process.env.GEMINI_API_KEY,
        OPENAI_MODEL: seat.model,
        OPENAI_BASE_URL: GEMINI_BASE,
        OPENAI_FAMILY: 'google',
      },
    });
  }
  return createOpenAiPort({
    env: { ...process.env, OPENAI_MODEL: seat.model, OPENAI_FAMILY: familyOfSeat(seat) },
  });
}

/** The ports of the seats: from the cassette, with the live port behind it under --record. */
async function seatPorts(
  seats: Seat[],
  options: { cassette?: string; record?: boolean },
  io: Io,
): Promise<{ ports: ModelPort[]; cassette: classes.Cassette; save: () => Promise<void> } | undefined> {
  const path = options.cassette === undefined ? undefined : resolve(io.cwd, options.cassette);
  if (!options.record && path === undefined) {
    io.err('Give --cassette to replay recorded answers, or --record to ask the live models.\n');
    return undefined;
  }
  const cassette = path === undefined ? new classes.Cassette() : await classes.readCassette(path);
  const ports: ModelPort[] = [];
  for (const seat of seats) {
    let inner: ModelPort | undefined;
    if (options.record) {
      try {
        inner = livePort(seat);
      } catch (cause) {
        io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
        return undefined;
      }
    }
    ports.push(cassette.port({ family: familyOfSeat(seat), model: seat.model, ...(inner ? { inner } : {}) }));
  }
  return {
    ports,
    cassette,
    save: async () => {
      if (path !== undefined && options.record) await classes.writeCassette(path, cassette);
    },
  };
}

function modelFailure(cause: unknown, io: Io): number {
  if (cause instanceof ModelError) {
    io.err(`A model call failed (${cause.code}): ${cause.message}\n`);
    return 2;
  }
  throw cause;
}

/**
 * `class realise`. Exit 0 when every planned row has an accepted realisation and the post-gate coverage is at
 * least 95%; 1 when the set is written short of that; 2 on bad input or a model call that failed (a replay
 * that meets a request the cassette lacks included).
 */
export async function classRealiseCommand(path: string, options: RealiseFlags, io: Io): Promise<number> {
  const plan = planFlags(options, io);
  const attempts = whole(options.attempts, '--attempts', 1, io);
  const realiserSeat = parseSeat(options.realiser, '--realiser', io);
  const judgeSeat = parseSeat(options.judge, '--judge', io);
  const styleSeat = options.style === undefined ? judgeSeat : parseSeat(options.style, '--style', io);
  if (!plan || attempts === null || !realiserSeat || !judgeSeat || !styleSeat) return 2;
  const cls = await loadOrSay(path, io);
  if (!cls) return 2;
  const seats = await seatPorts([realiserSeat, judgeSeat, styleSeat], options, io);
  if (!seats) return 2;
  const [realiser, judge, style] = seats.ports as [ModelPort, ModelPort, ModelPort];
  let result: classes.RealiseResult;
  try {
    result = await classes.realiseClass(cls, {
      ...plan,
      realiser,
      models: { judge, style },
      ...(attempts === undefined ? {} : { attempts }),
    });
  } catch (cause) {
    return modelFailure(cause, io);
  } finally {
    await seats.save();
  }
  const out = resolve(io.cwd, options.out);
  await writeFile(out, `${JSON.stringify(result.set, null, 2)}\n`);
  const gate = result.set.gate;
  const ok = gate.unfilled === 0 && gate.coverage.share >= MIN_COVERAGE;
  if (options.json) {
    io.out(`${JSON.stringify({ set: result.set.set, gate, live: seats.cassette.live }, null, 2)}\n`);
    return ok ? 0 : 1;
  }
  const rejected = Object.entries(gate.rejectedBy)
    .sort((a, b) => b[1] - a[1])
    .map(([stage, n]) => `${stage} ${n}`)
    .join(', ');
  io.out(
    `Class ${cls.id}: ${gate.planned} planned rows, ${gate.candidates} candidates, ${gate.accepted} accepted, ${gate.unfilled} rows unfilled.\n`,
  );
  io.out(`Rejected by: ${rejected === '' ? 'none' : rejected}.\n`);
  io.out(
    `Post-gate coverage: ${gate.coverage.covered} of ${gate.coverage.required} ${gate.coverage.t}-way tuples (${pct(gate.coverage.share)}). Vendi ${gate.vendi.toFixed(2)} (reported, not gated).\n`,
  );
  io.out(
    `Frozen set ${result.set.set}: ${relative(io.cwd, out)}. Name it in a block as when.class: { id: ${cls.id}, set: ${result.set.set} }.\n`,
  );
  if (seats.cassette.live > 0) io.out(`${seats.cassette.live} live model calls recorded.\n`);
  return ok ? 0 : 1;
}

async function readSetOrSay(
  path: string,
  cls: classes.UtteranceClass,
  io: Io,
): Promise<classes.RealisationSet | undefined> {
  let set: classes.RealisationSet;
  try {
    set = await classes.readSet(resolve(io.cwd, path));
  } catch (cause) {
    io.err(`Cannot read the set ${path}: ${(cause as Error).message}\n`);
    return undefined;
  }
  const check = classes.verifySet(set, cls);
  if (!check.ok) {
    io.err(`✗ ${path} is refused:\n${check.errors.map((e) => `  ${e}\n`).join('')}`);
    return undefined;
  }
  return set;
}

/** `class audit`. Exit 0 when at most one item is invalid by the union rule, 1 when more are, 2 on bad input. */
export async function classAuditCommand(path: string, options: AuditFlags, io: Io): Promise<number> {
  const seats = options.labeller.map((text) => parseSeat(text, '--labeller', io));
  if (seats.some((seat) => seat === undefined)) return 2;
  const families = new Set((seats as Seat[]).map(familyOfSeat));
  if (seats.length < 2 || families.size < 2) {
    io.err(
      'Give two --labeller options of different model families, such as anthropic:<model> and openai:<model>.\n',
    );
    return 2;
  }
  const cls = await loadOrSay(path, io);
  if (!cls) return 2;
  const set = await readSetOrSay(options.set, cls, io);
  if (!set) return 2;
  const ports = await seatPorts(seats as Seat[], options, io);
  if (!ports) return 2;
  let audit: classes.AuditResult;
  try {
    audit = await classes.auditItems(cls, set, ports.ports);
  } catch (cause) {
    await ports.save();
    return modelFailure(cause, io);
  }
  await ports.save();
  if (options.out) await writeFile(resolve(io.cwd, options.out), `${JSON.stringify(audit, null, 2)}\n`);
  if (options.json) {
    io.out(`${JSON.stringify(audit, null, 2)}\n`);
    return audit.pass ? 0 : 1;
  }
  io.out(
    `Audit of ${audit.class} set ${audit.set}: ${audit.invalid} of ${audit.items} items invalid by the union rule (bar: at most ${audit.maxInvalid}). ${audit.pass ? 'Pass' : 'Fail'}.\n`,
  );
  for (const [labeller, n] of Object.entries(audit.byLabeller).sort())
    io.out(`  ${labeller}: ${n} invalid\n`);
  io.out(`  labellers disagree on ${audit.disagreements} items\n`);
  for (const row of audit.rows.filter((r) => r.invalid)) {
    io.out(
      `  ✗ ${row.item} ${JSON.stringify(row.text)}: ${row.labels
        .filter((l) => l.valid !== true)
        .map((l) => `${l.labeller}: ${l.reason}`)
        .join(' | ')}\n`,
    );
  }
  if (ports.cassette.live > 0) io.out(`${ports.cassette.live} live model calls recorded.\n`);
  return audit.pass ? 0 : 1;
}

/** The class files and frozen sets of a folder, by class id. */
async function classFolder(
  dir: string,
  io: Io,
): Promise<Map<string, { set: classes.RealisationSet; class: classes.UtteranceClass }> | undefined> {
  const root = resolve(io.cwd, dir);
  let names: string[];
  try {
    names = (await readdir(root)).sort();
  } catch (cause) {
    io.err(`Cannot read ${dir}: ${(cause as Error).message}\n`);
    return undefined;
  }
  const byId = new Map<string, classes.UtteranceClass>();
  for (const name of names.filter((n) => /\.ya?ml$/.test(n))) {
    const loaded = await classes.loadClassFile(join(root, name));
    if (loaded.ok) byId.set(loaded.class.id, loaded.class);
  }
  const out = new Map<string, { set: classes.RealisationSet; class: classes.UtteranceClass }>();
  for (const name of names.filter((n) => n.endsWith('.set.json'))) {
    const set = await classes.readSet(join(root, name));
    const cls = byId.get(set.class);
    if (!cls) {
      io.err(`${name}: no class file for ${set.class} in ${dir}\n`);
      return undefined;
    }
    out.set(set.class, { set, class: cls });
  }
  return out;
}

/** `class expand`. Exit 0 when every class block expanded, 2 on bad input or a refused set. */
export async function classExpandCommand(paths: string[], options: ExpandFlags, io: Io): Promise<number> {
  const sets = await classFolder(options.classes, io);
  if (!sets) return 2;
  const { findSpecFiles } = await import('@agent-nexus/driftbench-core');
  const files = await findSpecFiles(paths.map((p) => resolve(io.cwd, p)));
  const out = resolve(io.cwd, options.out);
  await mkdir(out, { recursive: true });
  const written: { spec: string; copies: string[] }[] = [];
  let failed = false;
  for (const file of files) {
    const loaded = await loadSpecFile(file);
    if (!loaded.ok) {
      io.err(`✗ ${relative(io.cwd, file)} is not a valid spec\n`);
      failed = true;
      continue;
    }
    const expansion = classes.expandClassSpec(loaded.spec, sets);
    if (!expansion.ok) {
      io.err(`✗ ${relative(io.cwd, file)}:\n${expansion.errors.map((e) => `  ${e}\n`).join('')}`);
      failed = true;
      continue;
    }
    if (expansion.classBlocks === 0) continue;
    const copies: string[] = [];
    for (const spec of expansion.specs) {
      await writeFile(join(out, `${spec.id}.yaml`), stringify(spec as Spec));
      copies.push(spec.id);
    }
    written.push({ spec: loaded.spec.id, copies });
  }
  if (failed) return 2;
  if (options.json) {
    io.out(`${JSON.stringify({ out: relative(io.cwd, out), written }, null, 2)}\n`);
    return 0;
  }
  const total = written.reduce((s, w) => s + w.copies.length, 0);
  io.out(`${total} copies of ${written.length} specs written to ${relative(io.cwd, out) || '.'}.\n`);
  for (const w of written) io.out(`  ${w.spec}: ${w.copies.length} copies\n`);
  return 0;
}

const interval = (i: { lower: number; upper: number }) => `[${i.lower.toFixed(3)}, ${i.upper.toFixed(3)}]`;

/** `class envelope`. Exit 0, or 2 on bad input or a store without that campaign. */
export async function classEnvelopeCommand(
  campaignId: string | undefined,
  options: EnvelopeFlags,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  const at = resolve(io.cwd, options.store);
  if (noStoreAt(at, options.store, io)) return 2;
  let store: Awaited<ReturnType<CampaignDeps['openStore']>>;
  try {
    store = await deps.openStore(at);
  } catch (cause) {
    io.err(`Cannot open the store at ${options.store}: ${(cause as Error).message}\n`);
    return 2;
  }
  try {
    const campaigns = await store.listCampaigns();
    const campaign =
      campaignId === undefined ? campaigns[0] : campaigns.find((c) => c.campaignId === campaignId);
    if (!campaign) {
      io.err(
        campaignId === undefined
          ? `${options.store} holds no campaign.\n`
          : `${options.store} holds no campaign ${campaignId}.\n`,
      );
      return 2;
    }
    const report = await classes.classReportOfStore(store, campaign.campaignId);
    if (options.json) {
      io.out(`${JSON.stringify({ campaignId: campaign.campaignId, ...report }, null, 2)}\n`);
      return 0;
    }
    io.out(`Campaign ${campaign.campaignId}: ${report.classes.length} class blocks.\n`);
    for (const c of report.classes) {
      const e = c.envelope;
      io.out(
        `\n${c.class} (set ${c.set}), block ${c.block} of ${c.specs.join(', ')}: ${e.passes} of ${e.runs} runs pass over ${e.n} realisations, rate ${e.rate.toFixed(3)} ${interval(e.interval)} (Wilson on n_eff ${e.effectiveN.toFixed(1)}, design effect ${e.designEffect.toFixed(2)}).\n`,
      );
      io.out(
        `  MinP ${e.minP.toFixed(3)}; phrasing share ${e.phrasingShare === undefined ? 'n/a (one run per realisation)' : e.phrasingShare.toFixed(3)}; detectable drop ${e.mde.toFixed(3)}.\n`,
      );
      io.out('  By axis value:\n');
      for (const v of e.byValue) io.out(`    ${v.value}  ${v.passes}/${v.runs}  ${v.rate.toFixed(3)}\n`);
      io.out(`  Lowest cells (${e.cells.length} in all; --json lists every one):\n`);
      for (const cell of e.cells.slice(0, 3)) {
        io.out(
          `    ${cell.cell}  ${cell.passes}/${cell.runs}  ${cell.rate.toFixed(3)} ${interval(cell.wilson)}\n`,
        );
      }
      if (e.suspects.length > 0) {
        io.out(
          `  Suspects (held by no realisation that passed every run): ${e.suspects.map((s) => `${s.tuple} ${s.failRate.toFixed(2)}`).join('; ')}\n`,
        );
      }
    }
    const s = report.single;
    io.out(
      `\nSingle-string blocks (never averaged with a class): ${s.runs === 0 ? 'none' : `${s.passes} of ${s.runs} pass, rate ${(s.rate as number).toFixed(3)}, over ${s.specs} specs`}.\n`,
    );
    if (report.unscored > 0)
      io.out(`${report.unscored} class runs left out: the class block was not run or blocked.\n`);
    return 0;
  } finally {
    await store.close();
  }
}
