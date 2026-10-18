import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonicalJson, validateSpec } from '@agent-nexus/driftbench-core';
import { stringify } from 'yaml';
import { formatJson } from '../enumerate/json';
import { rngFor, streamSeed } from '../seed/random';
import { compileBlock } from './compile';
import { alternatives, drawKnobs, FamilyError, type Knobs } from './knobs';
import type { LoadedFamily } from './load';
import {
  activeBlocks,
  baseSlots,
  renderFiles,
  renderInstruction,
  renderPlanted,
  type SeedFiles,
} from './render';
import { type CornerKind, OracleOutput } from './schema';
import { applyCorner, chooseCorners, generateTables, type Tables } from './tables';

/** The review state an instance records: signed, or pending until a person signs the family's review. */
export type ReviewState = 'signed' | 'pending';

/** One block of a variant as the oracle and the family decide it: what the style invariant compares. */
export type BlockExpectation = { id: string; stage?: string; expect: Record<string, unknown> };

export type Variant = {
  /** base, a corner id, or planted. */
  id: string;
  corner?: string;
  planted?: true;
  spec: Record<string, unknown>;
  seed: SeedFiles;
  blocks: BlockExpectation[];
};

export type StyleCheck = { knob: string; value: string | number; variant: string; problem: string };

export type Instance = {
  /** i01, i02, ...: the folder of the instance. */
  name: string;
  index: number;
  /** The integer seed every draw of the instance comes from. */
  seed: number;
  knobs: Knobs;
  corners: string[];
  variants: Variant[];
  style: { alternatives: number; broken: StyleCheck[] };
};

export type BuildOptions = {
  /** How many instances, from 1. */
  n: number;
  /** The run seed; each instance's seed is derived from it and the instance number. */
  seed: number;
  review: ReviewState;
  /**
   * Where the workspace folder of a variant with binary files sits, as a spec's `workspace_seed.from` holds
   * it: relative to the spec file.
   */
  seedFrom: (instance: string, variant: string) => string;
};

/** The folder of a variant's workspace when it holds a file that is not text, inside the instance folder. */
export function seedFolderName(variant: string): string {
  return `.seed-${variant}`;
}

export function instanceName(index: number, n: number): string {
  return `i${String(index).padStart(Math.max(2, String(n).length), '0')}`;
}

/** The seed of instance `index` (from 1) of a run with this seed. */
export function instanceSeed(runSeed: number, index: number): number {
  return streamSeed(runSeed, `instance:${index}`);
}

type VariantPlan = { id: string; corner?: CornerKind; planted?: true };

function plan(loaded: LoadedFamily, knobs: Knobs, corners: readonly CornerKind[]): VariantPlan[] {
  const planted = loaded.family.planted;
  return [
    { id: 'base' },
    ...corners.map((corner) => ({ id: corner.id, corner })),
    ...(planted && knobs[planted.knob] === 'with' ? [{ id: 'planted', planted: true as const }] : []),
  ];
}

/** Builds one variant: seed files, oracle, instructions, expectations, and the spec, which must validate. */
async function buildVariant(
  loaded: LoadedFamily,
  context: { name: string; seed: number; runSeed: number; knobs: Knobs; tables: Tables; review: ReviewState },
  variant: VariantPlan,
  seedFrom: BuildOptions['seedFrom'],
): Promise<Variant> {
  const { family } = loaded;
  const { knobs, seed } = context;
  let tables = context.tables;
  if (variant.corner) {
    const applied = applyCorner(tables, variant.corner, seed);
    if (!applied)
      throw new FamilyError(`the corner ${variant.corner.id} does not apply to instance ${context.name}`);
    tables = applied;
  }
  const files = renderFiles(loaded, tables, knobs, seed);
  const slots0 = baseSlots(family, knobs);
  if (variant.planted && family.planted) {
    const path = family.planted.file;
    if (Object.hasOwn(files.text, path) || Object.hasOwn(files.binary, path)) {
      throw new FamilyError(`the planted file ${path} is already a seed file`);
    }
    files.text[path] = renderPlanted(family, slots0);
  }

  const blocks = activeBlocks(family, knobs);
  // A block may hold only in some instances; each instance still holds at least one.
  if (blocks.length === 0)
    throw new FamilyError(`the knobs of ${context.name} leave it no block: every block's condition fails`);
  const ids = blocks.map((block) => block.id);
  let raw: unknown;
  try {
    raw = await loaded.oracle({
      files: { ...files.text },
      binary: { ...files.binary },
      knobs: { ...knobs },
      blocks: ids,
    });
  } catch (cause) {
    throw new FamilyError(`the oracle failed on ${context.name} ${variant.id}: ${describe(cause)}`);
  }
  const parsed = OracleOutput.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new FamilyError(
      `the oracle returned an outcome the format refuses on ${context.name} ${variant.id}: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`,
    );
  }
  const output = parsed.data;
  const extra = Object.keys(output.blocks).filter((id) => !ids.includes(id));
  if (extra.length > 0)
    throw new FamilyError(`the oracle answered for blocks the instance does not hold: ${extra.join(', ')}`);
  const slots = { ...slots0, ...output.slots };

  const expectations: BlockExpectation[] = [];
  const specBlocks: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const expected = output.blocks[block.id];
    if (!expected) throw new FamilyError(`the oracle gave no outcome for the block ${block.id}`);
    const fixed = block.expect ?? {};
    const derived = compileBlock(expected, family.checks, family.others_untouched);
    const expect: Record<string, unknown> = {
      ...(block.stage ? { stage: block.stage } : {}),
      ...fixed,
      ...derived,
    };
    const must = [...asList(fixed.must), ...asList(derived.must)];
    if (must.length > 0) expect.must = must;
    if (variant.planted && family.planted && family.planted.block === block.id) {
      expect.must_not = [...asList(fixed.must_not), ...family.planted.must_not];
      if (family.planted.safety) {
        expect.safety = { ...(isRecord(fixed.safety) ? fixed.safety : {}), ...family.planted.safety };
      }
    }
    expectations.push({ id: block.id, ...(block.stage ? { stage: block.stage } : {}), expect });
    specBlocks.push({
      id: block.id,
      user: renderInstruction(family, block, knobs, slots),
      expect,
      ...(block.budget ? { budget: block.budget } : {}),
    });
  }

  const hasBinary = Object.keys(files.binary).length > 0;
  const spec: Record<string, unknown> = {
    id: `${family.id}-${context.name}-${variant.id}`,
    version: '1',
    kind: 'task',
    title: `${family.title} (${context.name}, ${variant.id})`,
    description: family.description,
    ...(family.spec.channel ? { channel: family.spec.channel } : {}),
    ...(family.spec.lang ? { lang: family.spec.lang } : {}),
    tier: family.spec.tier ?? 'generated',
    tags: [...(family.spec.tags ?? []), `family:${family.id}`],
    ...(family.spec.covers ? { covers: [...family.spec.covers] } : {}),
    target: { ...family.target },
    workspace_seed: hasBinary ? { from: seedFrom(context.name, variant.id) } : { files: { ...files.text } },
    ...(family.spec.stages ? { stages: [...family.spec.stages] } : {}),
    blocks: specBlocks,
    metadata: {
      family: {
        id: family.id,
        family_sha256: loaded.familySha256,
        oracle_sha256: loaded.oracleSha256,
        review: context.review,
        instance: context.name,
        instance_seed: seed,
        run_seed: context.runSeed,
        knobs: { ...knobs },
        variant: variant.id,
        ...(variant.corner ? { corner: variant.corner.id } : {}),
      },
    },
  };
  const checked = validateSpec(spec, `${context.name}/${variant.id}`);
  if (!checked.ok) {
    const issue = checked.errors[0];
    throw new FamilyError(
      `instance ${context.name} ${variant.id} is not a valid spec: ${issue?.path ?? ''} ${issue?.code ?? ''} ${issue?.message ?? ''}`,
    );
  }
  return {
    id: variant.id,
    ...(variant.corner ? { corner: variant.corner.id } : {}),
    ...(variant.planted ? { planted: true as const } : {}),
    spec,
    seed: files,
    blocks: expectations,
  };
}

/**
 * The style invariant: a style knob never changes the expected outcome. Each style knob is moved to each
 * other value the constraints allow, the rest of the draw held; every variant is rebuilt from the same
 * instance seed and its expectations must equal the ones of the drawn instance.
 */
async function checkStyle(
  loaded: LoadedFamily,
  instance: Omit<Instance, 'style'>,
  plans: readonly VariantPlan[],
  options: BuildOptions,
): Promise<Instance['style']> {
  const { family } = loaded;
  const broken: StyleCheck[] = [];
  let count = 0;
  const styles = Object.entries(family.knobs)
    .filter(([, knob]) => knob.class === 'style')
    .map(([name]) => name)
    .sort();
  for (const knob of styles) {
    for (const value of alternatives(family, instance.knobs, knob)) {
      count += 1;
      const knobs = { ...instance.knobs, [knob]: value };
      let tables: Tables;
      try {
        tables = generateTables(family, instance.seed, knobs);
      } catch (cause) {
        broken.push({ knob, value, variant: '(tables)', problem: describe(cause) });
        continue;
      }
      const moved = plan(
        loaded,
        knobs,
        plans.flatMap((entry) => (entry.corner ? [entry.corner] : [])),
      );
      if (moved.map((entry) => entry.id).join() !== plans.map((entry) => entry.id).join()) {
        broken.push({ knob, value, variant: '(variants)', problem: 'the variants of the instance change' });
        continue;
      }
      for (const entry of plans) {
        const original = instance.variants.find((variant) => variant.id === entry.id);
        try {
          const rebuilt = await buildVariant(
            loaded,
            {
              name: instance.name,
              seed: instance.seed,
              runSeed: options.seed,
              knobs,
              tables,
              review: options.review,
            },
            entry,
            options.seedFrom,
          );
          if (canonicalJson(rebuilt.blocks) !== canonicalJson(original?.blocks)) {
            broken.push({
              knob,
              value,
              variant: entry.id,
              problem: firstDifference(original?.blocks ?? [], rebuilt.blocks),
            });
          }
        } catch (cause) {
          broken.push({ knob, value, variant: entry.id, problem: describe(cause) });
        }
      }
    }
  }
  return { alternatives: count, broken };
}

/** Where two expectation lists first differ, for a reader. */
function firstDifference(a: readonly BlockExpectation[], b: readonly BlockExpectation[]): string {
  if (a.length !== b.length) return `${a.length} blocks become ${b.length}`;
  for (const [index, block] of a.entries()) {
    const other = b[index];
    if (canonicalJson(block) === canonicalJson(other)) continue;
    for (const key of new Set([...Object.keys(block.expect), ...Object.keys(other?.expect ?? {})])) {
      if (canonicalJson(block.expect[key]) !== canonicalJson(other?.expect[key])) {
        return `the block ${block.id} expects another ${key}`;
      }
    }
    return `the block ${block.id} changes`;
  }
  return 'the expectations change';
}

/** Builds one instance: knobs, tables, corner variants, the planted variant, and the style invariant. */
export async function buildInstance(
  loaded: LoadedFamily,
  index: number,
  options: BuildOptions,
): Promise<Instance> {
  const seed = instanceSeed(options.seed, index);
  const name = instanceName(index, options.n);
  const knobs = drawKnobs(loaded.family, rngFor(seed, 'knobs'));
  const tables = generateTables(loaded.family, seed, knobs);
  const corners = chooseCorners(loaded.family, tables, seed);
  const plans = plan(loaded, knobs, corners);
  const variants: Variant[] = [];
  for (const entry of plans) {
    variants.push(
      await buildVariant(
        loaded,
        { name, seed, runSeed: options.seed, knobs, tables, review: options.review },
        entry,
        options.seedFrom,
      ),
    );
  }
  const instance = { name, index, seed, knobs, corners: corners.map((corner) => corner.id), variants };
  return { ...instance, style: await checkStyle(loaded, instance, plans, options) };
}

export async function buildInstances(loaded: LoadedFamily, options: BuildOptions): Promise<Instance[]> {
  if (!Number.isInteger(options.n) || options.n < 1)
    throw new FamilyError('n must be a whole number of at least 1');
  const out: Instance[] = [];
  for (let index = 1; index <= options.n; index += 1) out.push(await buildInstance(loaded, index, options));
  return out;
}

export const REPORT_NAME = 'family-report.json';

export type FamilyReport = {
  family: string;
  family_sha256: string;
  oracle_sha256: string;
  review: ReviewState;
  seed: number;
  n: number;
  specs: number;
  instances: Array<{
    name: string;
    seed: number;
    knobs: Knobs;
    corners: string[];
    variants: Array<{ id: string; file: string }>;
    style_alternatives_checked: number;
  }>;
  knob_counts: Record<string, Record<string, number>>;
  corner_counts: Record<string, number>;
};

export function familyReport(
  loaded: LoadedFamily,
  instances: readonly Instance[],
  options: BuildOptions,
): FamilyReport {
  const knobCounts: Record<string, Record<string, number>> = {};
  const cornerCounts: Record<string, number> = {};
  for (const kind of loaded.family.corners.kinds) cornerCounts[kind.id] = 0;
  for (const instance of instances) {
    for (const [knob, value] of Object.entries(instance.knobs)) {
      const counts = knobCounts[knob] ?? {};
      counts[String(value)] = (counts[String(value)] ?? 0) + 1;
      knobCounts[knob] = counts;
    }
    for (const corner of instance.corners) cornerCounts[corner] = (cornerCounts[corner] ?? 0) + 1;
  }
  return {
    family: loaded.family.id,
    family_sha256: loaded.familySha256,
    oracle_sha256: loaded.oracleSha256,
    review: options.review,
    seed: options.seed,
    n: options.n,
    specs: instances.reduce((sum, instance) => sum + instance.variants.length, 0),
    instances: instances.map((instance) => ({
      name: instance.name,
      seed: instance.seed,
      knobs: instance.knobs,
      corners: instance.corners,
      variants: instance.variants.map((variant) => ({
        id: variant.id,
        file: `${instance.name}/${variant.id}.yaml`,
      })),
      style_alternatives_checked: instance.style.alternatives,
    })),
    knob_counts: knobCounts,
    corner_counts: cornerCounts,
  };
}

/** The entries an earlier run wrote into an output folder: instance folders and the report. */
export async function earlierOutput(dir: string): Promise<string[]> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  return entries
    .filter((entry) => /^i\d{2,}$/.test(entry) || entry === REPORT_NAME || entry === VERIFY_REPORT_NAME)
    .sort();
}

export const VERIFY_REPORT_NAME = 'verify-report.json';

/** Writes the instances, one folder each, and the report. With `force`, the entries of an earlier run go first. */
export async function writeInstances(
  dir: string,
  loaded: LoadedFamily,
  instances: readonly Instance[],
  report: FamilyReport,
  options: { force: boolean; header: string },
): Promise<string[]> {
  const earlier = await earlierOutput(dir);
  if (earlier.length > 0) {
    if (!options.force) {
      throw new FamilyError(
        `${dir} holds the output of an earlier run (${earlier.join(', ')}); pass --force to replace it`,
      );
    }
    for (const entry of earlier) await rm(join(dir, entry), { recursive: true, force: true });
  }
  const written: string[] = [];
  for (const instance of instances) {
    for (const variant of instance.variants) {
      const file = join(dir, instance.name, `${variant.id}.yaml`);
      await mkdir(dirname(file), { recursive: true });
      const header = `# ${options.header}\n# Family ${loaded.family.id}, instance ${instance.name} (seed ${instance.seed}), variant ${variant.id}. Regenerate it; do not edit it.\n`;
      await writeFile(file, `${header}${stringify(variant.spec, { lineWidth: 0 })}`);
      written.push(file);
      if (Object.keys(variant.seed.binary).length > 0) {
        const folder = join(dir, instance.name, seedFolderName(variant.id));
        for (const [path, content] of [
          ...Object.entries(variant.seed.text),
          ...Object.entries(variant.seed.binary),
        ]) {
          await mkdir(dirname(join(folder, path)), { recursive: true });
          await writeFile(join(folder, path), content);
        }
      }
    }
  }
  const reportPath = join(dir, REPORT_NAME);
  await writeFile(reportPath, formatJson(report));
  written.push(reportPath);
  return written;
}

/** True when the path is a folder that holds anything. */
export async function isNonEmptyFolder(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isDirectory()) return false;
  return (await readdir(path)).length > 0;
}

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
