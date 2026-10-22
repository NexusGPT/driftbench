import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { type EstateName, estateFolder, type GoldUnit } from './gold';

/**
 * The truth file of a gold estate (examples/estates/gold5/TRUTH-SCHEMA.md): what the gold labels do not hold.
 * It is written from the prose alone by a lane that has not read the harness, and every entry names a unit by
 * its gold id.
 */
const Id = z.string().regex(/^[a-z0-9]{10}$/, 'a gold unit id is ten lower case letters or digits');

export const REPLY_ACTS = ['answer', 'clarify', 'refuse', 'report', 'draft', 'acknowledge'] as const;

const Limit = z.strictObject({
  unit: Id,
  limit: z.number().finite(),
  comparison: z.enum(['lt', 'le', 'gt', 'ge']),
  unit_of: z.string().min(1).optional(),
  governs: Id,
});

const Scope = z.strictObject({ unit: Id, target: Id });

const PlantedRule = z.strictObject({
  unit: Id,
  ask: z.string().min(1),
  reply_act: z.enum(REPLY_ACTS),
  near_miss: z.string().min(1).optional(),
});

const Plan = z.strictObject({
  cover: z.array(Id),
  exclude: z.array(Id),
  same_row: z.array(z.array(Id).min(2).max(4)).max(6),
});

const Truth = z.strictObject({
  version: z.literal(1),
  estate: z.enum(['A', 'B', 'C']),
  gold5Sha256: z.string().regex(/^[a-f0-9]{64}$/),
  limits: z.array(Limit),
  scopes: z.array(Scope),
  planted_rules: z.array(PlantedRule).min(8).max(12),
  plan: Plan,
});
export type Truth = z.infer<typeof Truth>;

/** The gold files that hold the standing instructions: their rules have no skill to carry them. */
export const STANDING_FILES: Readonly<Record<EstateName, string>> = {
  A: 'A-standing-instructions.md',
  B: 'B-standing-instructions.md',
  C: 'C-main-prompt-with-channel-tabs.md',
};

const INSTRUCTION = new Set(['rule', 'prohibition', 'gate']);
const NOT_INSTRUCTION = new Set(['example', 'description', 'none']);

/** The truth of an estate, read and checked against the gold: the problems it has, or the truth. */
export async function loadTruth(
  estate: EstateName,
  gold: readonly GoldUnit[],
  path: string = join(estateFolder(estate), 'truth.yaml'),
): Promise<{ truth: Truth; problems: string[] }> {
  const text = await readFile(path, 'utf8');
  const parsed = Truth.safeParse(parseYaml(text));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`truth.yaml of estate ${estate} does not fit the schema:\n${issues.join('\n')}`);
  }
  const truth = parsed.data;
  const byId = new Map(gold.filter((unit) => unit.estate === estate).map((unit) => [unit.id, unit]));
  const problems: string[] = [];
  const unitOf = (where: string, id: string): GoldUnit | undefined => {
    const unit = byId.get(id);
    if (!unit) problems.push(`${where}: ${id} is no unit of estate ${estate}`);
    return unit;
  };
  const labelOf = (unit: GoldUnit): string => (unit.agreed && unit.label !== null ? unit.label : 'none');
  if (truth.estate !== estate) problems.push(`estate: ${truth.estate} in the file of estate ${estate}`);
  truth.limits.forEach((entry, at) => {
    unitOf(`limits.${at}.unit`, entry.unit);
    unitOf(`limits.${at}.governs`, entry.governs);
  });
  truth.scopes.forEach((entry, at) => {
    const condition = unitOf(`scopes.${at}.unit`, entry.unit);
    const target = unitOf(`scopes.${at}.target`, entry.target);
    if (condition && target && condition.file !== target.file) {
      problems.push(`scopes.${at}: ${entry.unit} and ${entry.target} are in two files`);
    }
    if (target && !INSTRUCTION.has(labelOf(target))) {
      problems.push(`scopes.${at}.target: ${entry.target} has the gold label ${labelOf(target)}`);
    }
  });
  const planted = new Set<string>();
  truth.planted_rules.forEach((entry, at) => {
    const unit = unitOf(`planted_rules.${at}.unit`, entry.unit);
    if (planted.has(entry.unit)) problems.push(`planted_rules.${at}: ${entry.unit} twice`);
    planted.add(entry.unit);
    if (!unit) return;
    if (!INSTRUCTION.has(labelOf(unit))) {
      problems.push(`planted_rules.${at}: ${entry.unit} has the gold label ${labelOf(unit)}`);
    }
    if (unit.file === STANDING_FILES[estate]) {
      problems.push(`planted_rules.${at}: ${entry.unit} is in the standing file ${unit.file}`);
    }
  });
  truth.plan.cover.forEach((id, at) => {
    const unit = unitOf(`plan.cover.${at}`, id);
    if (unit && !INSTRUCTION.has(labelOf(unit))) {
      problems.push(`plan.cover.${at}: ${id} has the gold label ${labelOf(unit)}`);
    }
  });
  truth.plan.exclude.forEach((id, at) => {
    const unit = unitOf(`plan.exclude.${at}`, id);
    if (unit && !NOT_INSTRUCTION.has(labelOf(unit))) {
      problems.push(`plan.exclude.${at}: ${id} has the gold label ${labelOf(unit)}`);
    }
  });
  truth.plan.same_row.forEach((group, at) => {
    group.forEach((id, item) => {
      unitOf(`plan.same_row.${at}.${item}`, id);
    });
  });
  return { truth, problems };
}
