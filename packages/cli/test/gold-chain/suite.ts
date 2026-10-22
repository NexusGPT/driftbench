import { appendFileSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type EstateMap,
  loadEstateMap,
  loadPlan,
  pointer,
  readerFor,
  renderEstateMap,
  type ScanEstateResult,
  scanEstate,
  variables,
} from '@agent-nexus/driftbench-estate';
import { validateVariableStore } from '@agent-nexus/driftbench-space';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  type EstateName,
  estateFiles,
  GOLD_ESTATE_KEY,
  GOLD_SET_YAML,
  type GoldUnit,
  goldLabeller,
  loadGold,
} from '../../../estate/test/gold/gold';
import { type Comparison, normalForm, type Role } from '../../../estate/test/gold/normal-form';
import { idsProblems, labelsProblems } from '../../../estate/test/gold/steps';
import { loadTruth, type Truth } from '../../../estate/test/gold/truth';
import { type Io, main } from '../../src/index';
import { LAYOUT } from './layout';
import { ASK_MODEL, askPort, loadAsks } from './limits-ask';
import { appliedScopes } from './scopes';

/**
 * The chain of one gold estate, from the ids to the links, with no model call. Each step reads what the step
 * before wrote and fails by its name. The estate is a fictional Claude Code estate laid out from the flat gold
 * files; the labels come from gold5.json, the numbers, scopes, asks and planted rules from the truth file of
 * the estate (examples/estates/gold5/TRUTH-SCHEMA.md), which another lane wrote from the prose alone. The
 * runs use the stand-in runtime and the stand-in judge of the Northwind fixture.
 */

vi.setConfig({ testTimeout: 900_000, hookTimeout: 120_000 });

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const FAKE = join(FIXTURE, 'live/fake/claude.mjs');
const FAKE_JUDGE = join(FIXTURE, 'live/fake/judge.cjs');
const JUDGE = ['--judge', 'claude:haiku', '--judge-command', FAKE_JUDGE, '--judge-budget', '1'];
const SHOWN = 200;
const INSTRUCTION = new Set(['rule', 'prohibition', 'gate']);

/**
 * The known gaps of the gate (known-gaps.json), held as a strict ratchet: for steps 2, 3 and 4 the problems found
 * must equal the listed ones exactly, in both directions. A new problem fails, and so does a fixed one until the
 * file is tightened in the same change. The file also holds the not-passed steps of each estate and the measured
 * figures of the producer on the original 38-limit truth.
 */
type Known = {
  notPassed: string[];
  limits38: { truth: number; found: number; produced: number };
  gaps: Record<string, string[]>;
};
const KNOWN = JSON.parse(readFileSync(new URL('./known-gaps.json', import.meta.url), 'utf8')) as Record<
  EstateName,
  Known
>;

/**
 * The limits that were added to the truth after the producer's first recordings (the units the producer had
 * returned as extras, judged by a blind check). Every other limit is the 38-limit truth that was written before
 * any recording. The record of both is in examples/estates/gold5/TRUTH-NOTES.md ("Revision: blind re-check of the
 * added limits") and TRUTH-SCHEMA.md (history of the limits).
 */
const ADDED_AFTER_RECORDING = new Set([
  '2ihgfbfpwv',
  '5fheyswkjr',
  'dptij3uzkt',
  'ozfstdpufc',
  'xalkekvnkq',
  'emimqrmqo6',
  'nmk2xrp2r3',
  '4delmkvg75',
  '2yxq6pbpcn',
  'ttzfbmyzfz',
  'erb2rbwa26',
  'lwci7tropa',
  'kn447e23qp',
  'bidpovjlre',
  'txtsbyxu6a',
  'x2yw2rftbc',
  '7xzbzyq5no',
]);

type Atom = EstateMap['atoms'][number];
type Spec = {
  id: string;
  blocks: Array<{ id?: string; when?: { user?: string } }>;
  metadata: {
    estate: { atoms: string[]; planRow: string; testType: string };
    links?: Array<{ block: string; to: { kind: string; rule?: string; ledger?: string }; relation: string }>;
  };
};
type Generated = { path: string; folder: string; spec: Spec };
type Proof = {
  counts: Record<'blocks' | 'linked' | 'flipped' | 'verified' | 'refuted' | 'unproved', number> & {
    unlinkedFlips: number;
  };
  agrees: boolean;
};

const report = (step: string, problems: string[]): string => {
  const more = problems.length > SHOWN ? ['...'] : [];
  return [`${step}: ${problems.length} problems`, ...problems.slice(0, SHOWN), ...more].join('\n');
};

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else found.push(path);
  }
  return found.sort();
}

async function loadMap(path: string): Promise<EstateMap> {
  const loaded = await loadEstateMap(path);
  if (!loaded.ok) throw new Error(`${path}: ${loaded.errors.map((issue) => issue.message).join('; ')}`);
  return loaded.map;
}

export function goldChain(estate: EstateName, truthPath?: string): void {
  let work = '';
  let estateDir = '';
  const chain: {
    gold?: GoldUnit[];
    truth?: Truth;
    scan?: ScanEstateResult;
    /** Gold unit id to the ledger id of the scan, and to the instruction atom of that unit. */
    ledgerOf?: Map<string, string>;
    atomOf?: Map<string, Atom>;
    approved?: EstateMap;
    specs?: Generated[];
    phrases?: string;
  } = {};

  const rows: Array<{ step: string; tie: string; verified: 'yes' | 'gap' | 'NO' }> = [];
  const gapped = new Set<string>();
  async function prove(step: string, check: () => Promise<string>): Promise<void> {
    const row: { step: string; tie: string; verified: 'yes' | 'gap' | 'NO' } = {
      step,
      tie: '',
      verified: 'NO',
    };
    rows.push(row);
    row.tie = await check();
    row.verified = gapped.has(step) ? 'gap' : 'yes';
  }

  /** The problems of a step with known gaps must equal the listed gaps exactly (see KNOWN). */
  function holdGaps(step: string, problems: string[]): void {
    const known = KNOWN[estate].gaps[step] ?? [];
    const sorted = (list: string[]): string[] => [...list].sort();
    expect(
      sorted(problems),
      `${report(step, problems)}\nThe problems of this step differ from packages/cli/test/gold-chain/known-gaps.json. A problem that is no longer found is a gap fixed: remove it from the file in the same change.`,
    ).toEqual(sorted(known));
    if (known.length > 0) gapped.add(step);
  }

  async function cli(argv: string[]) {
    const output = { out: '', err: '' };
    const io: Io = {
      out: (text) => {
        output.out += text;
      },
      err: (text) => {
        output.err += text;
      },
      cwd: work,
    };
    const code = await main(argv, io);
    return { code, ...output };
  }

  const must = <T>(value: T | undefined, step: string): T => {
    if (value === undefined)
      throw new Error(`step ${step} left nothing for this step to read: it did not finish`);
    return value;
  };

  /** The place of a gold unit in the laid-out estate, as the labeller keys it. */
  const placeOf = (unit: GoldUnit): string => `${LAYOUT[estate][unit.file]}#${unit.n}`;

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), `driftbench-gold-chain-${estate}-`));
    estateDir = join(work, 'estate');
    vi.stubEnv('DRIFTBENCH_MAP_CACHE', join(work, 'map-cache'));
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(work, { recursive: true, force: true });
  });

  describe(`the gold chain of estate ${estate}, from the ids to the links, with no model call`, () => {
    it('step 1 ids: the release cutter and ledger reproduce the gold ids', async () => {
      await prove('1 ids', async () => {
        const problems = await idsProblems(estate);
        expect(problems, report('ids', problems)).toEqual([]);
        return 'gold ids = ledger ids at estate key phase5-growth';
      });
    });

    it('step 2 labels: the gold labels give exactly the instruction atoms of the gold, with their scopes', async () => {
      await prove('2 labels', async () => {
        const flat = await labelsProblems(estate);
        expect(flat, report('labels', flat)).toEqual([]);

        const gold = (await loadGold()).filter((unit) => unit.estate === estate);
        const { truth, problems: truthProblems } = await loadTruth(estate, gold, truthPath);
        expect(truthProblems, report('truth', truthProblems)).toEqual([]);
        chain.gold = gold;
        chain.truth = truth;

        // The estate: the flat files, laid out where the Claude Code reader reads them.
        for (const file of await estateFiles(estate)) {
          const target = join(estateDir, LAYOUT[estate][file.path] ?? '');
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, file.text);
        }
        const byId = new Map(gold.map((unit) => [unit.id, unit]));
        const place = (id: string): string => placeOf(byId.get(id) as GoldUnit);
        // The pointer reader gives a unit one label and one target. The first scope of a condition unit is applied;
        // every other scope is a gap of the product and fails the step, naming the unit and its target.
        const { applied, dropped } = appliedScopes(gold, truth.scopes);
        const scopes = [...applied.values()].map((scope) => ({
          unit: place(scope.unit),
          target: place(scope.target),
        }));
        const reader = readerFor('claude-code', { ignore: [] });
        if (reader === undefined) throw new Error('the claude-code reader is missing');
        const planted = goldLabeller(
          gold.map((unit) => ({ ...unit, file: LAYOUT[estate][unit.file] ?? unit.file })),
          [],
          scopes,
        );
        const parsed = pointer.parseLabelSets(GOLD_SET_YAML);
        if (!parsed.ok) throw new Error(parsed.message);
        const scan = await scanEstate({
          root: estateDir,
          reader,
          rootLabel: 'estate',
          ceiling: 40_000,
          pointer: {
            sets: parsed.sets,
            labelling: pointer.singleLabelling(planted),
            cassette: new pointer.Cassette(),
            mode: 'record',
            estateKey: GOLD_ESTATE_KEY,
          },
        });
        chain.scan = scan;
        const done = must(scan.pointer, '2');
        const problems: string[] = [];
        for (const failure of done.failed) problems.push(`window failed: ${failure}`);

        const ledgerAt = new Map(
          done.ledger.entries
            .filter((entry) => entry.status === 'live')
            .map((entry) => [`${entry.path}#${entry.index + 1}`, entry.id]),
        );
        const ledgerOf = new Map<string, string>();
        for (const unit of gold) {
          const id = ledgerAt.get(placeOf(unit));
          if (id === undefined) problems.push(`${placeOf(unit)}: no ledger unit`);
          else ledgerOf.set(unit.id, id);
        }
        const asCondition = new Set(applied.keys());
        const instructions = scan.map.atoms.filter((atom) => atom.kind === 'instruction');
        const atomOf = new Map<string, Atom>();
        for (const atom of instructions) atomOf.set(String(atom.fields?.unit), atom);
        for (const unit of gold) {
          const wants = unit.agreed && INSTRUCTION.has(unit.label ?? '') && !asCondition.has(unit.id);
          const atom = atomOf.get(ledgerOf.get(unit.id) ?? '');
          if (wants && !atom)
            problems.push(`${placeOf(unit)}: gold label ${unit.label} built no instruction atom`);
          if (!wants && atom)
            problems.push(`${placeOf(unit)}: an instruction atom for gold label ${unit.label}`);
          const polarity = unit.label === 'prohibition' ? 'prohibition' : 'obligation';
          if (wants && atom && atom.fields?.polarity !== polarity) {
            problems.push(
              `${placeOf(unit)}: polarity ${String(atom.fields?.polarity)}, gold label ${unit.label}`,
            );
          }
        }
        for (const scope of applied.values()) {
          const target = atomOf.get(ledgerOf.get(scope.target) ?? '');
          const condition = byId.get(scope.unit);
          const said = (condition?.text ?? '').trim();
          if (!target) problems.push(`scope ${scope.unit}: the target ${scope.target} has no atom`);
          else if (!(target.situation ?? '').includes(said)) {
            problems.push(`scope ${scope.unit}: the situation of ${target.id} lacks the condition text`);
          }
        }
        problems.push(...dropped);
        chain.ledgerOf = ledgerOf;
        chain.atomOf = new Map(
          [...ledgerOf].flatMap(([goldId, ledgerId]) => {
            const atom = atomOf.get(ledgerId);
            return atom ? [[goldId, atom] as const] : [];
          }),
        );
        await writeFile(join(work, 'map.yaml'), renderEstateMap(scan.map));
        holdGaps('2 labels', problems);
        return `${chain.atomOf.size} instruction atoms, ${applied.size} of ${truth.scopes.length} scopes applied`;
      });
    });

    it('step 3 variables: the store holds every instruction atom, quoted by its ledger id, and the limits', async () => {
      await prove('3 variables', async () => {
        const gold = must(chain.gold, '2');
        const truth = must(chain.truth, '2');
        const scan = must(chain.scan, '2');
        const ledgerOf = must(chain.ledgerOf, '2');
        const atomOf = must(chain.atomOf, '2');
        const approving = await cli([
          'estate',
          'approve',
          join(work, 'map.yaml'),
          '--all',
          '--to',
          join(work, 'approved.yaml'),
        ]);
        expect(approving.err).toBe('');
        expect(approving.code).toBe(0);
        const approved = await loadMap(join(work, 'approved.yaml'));
        chain.approved = approved;

        const texts = new Map<string, string>();
        for (const path of Object.values(LAYOUT[estate])) {
          texts.set(path, await readFile(join(estateDir, path), 'utf8'));
        }
        const ledger = must(scan.pointer, '2').ledger;
        const resolver = variables.provenanceResolver(texts, { ledger, estateKey: GOLD_ESTATE_KEY });
        const fed = variables.estateToVariables(approved, resolver);
        const instructionIds = new Set([...atomOf.values()].map((atom) => atom.id));
        const refused = fed.refused.filter((entry) => instructionIds.has(entry.atom));
        const problems: string[] = refused.map((entry) => `refused ${entry.atom}: ${entry.reason}`);
        const axis = fed.store.variables.find((variable) => variable.id === 'atoms.instruction');
        const values = new Map((axis?.values ?? []).map((value) => [value.id, value]));
        for (const unit of gold) {
          const atom = atomOf.get(unit.id);
          if (!atom) continue;
          const value = values.get(atom.id);
          const source = value?.provenance?.[0];
          const quoted = source?.kind === 'quote' ? source.ledger : undefined;
          if (!value) problems.push(`${placeOf(unit)}: ${atom.id} is no value of atoms.instruction`);
          else if (quoted !== ledgerOf.get(unit.id)) {
            problems.push(`${placeOf(unit)}: the quote of ${atom.id} names ledger ${String(quoted)}`);
          }
        }
        if (values.size !== atomOf.size) {
          problems.push(`atoms.instruction has ${values.size} values, ${atomOf.size} atoms`);
        }

        // The limits come from one structured request for each instruction or gate atom, replayed from the cassette of the
        // estate. They are compared with the limits of the truth file: each truth limit must be produced on the atom it
        // governs, and no other limit may be produced. A unit that differs only in the words of the unit is noted.
        // The key is the normal form of the limit (estate/test/gold/normal-form.ts): on a prohibition a trigger is
        // read as the compliant range of the act, so both readings of one fact give one key.
        const labelOfAtom = (atomId: string): string => {
          const goldId = [...atomOf].find(([, atom]) => atom.id === atomId)?.[0];
          return gold.find((unit) => unit.id === goldId)?.label ?? '';
        };
        const key = (atomId: string, limit: number, comparison: string, role: string): string => {
          const read = normalForm(
            { limit, comparison: comparison as Comparison, role: role as Role },
            labelOfAtom(atomId) === 'prohibition',
          );
          return `${atomId} | ${read.limit} ${read.comparison} ${read.role}`;
        };
        const wanted = new Map<string, Truth['limits'][number]>();
        for (const limit of truth.limits) {
          const atom = atomOf.get(limit.governs);
          if (!atom) {
            problems.push(
              `limit not placeable: ${limit.unit} (${limit.limit} ${limit.comparison}) governs ${limit.governs}, a unit with no instruction atom`,
            );
            continue;
          }
          wanted.set(key(atom.id, limit.limit, limit.comparison, limit.role), limit);
        }
        const asks = loadAsks(estate, ASK_MODEL);
        const spent = { input: 0, output: 0, requests: 0 };
        const atomUnits = new Map([...atomOf].map(([goldId, atom]) => [atom.id, goldId]));
        const asked = await variables.produceLimits(approved, {
          texts,
          ask: askPort(estate, ASK_MODEL, asks, spent),
          include: (atom) => atomUnits.has(atom.id),
        });
        for (const entry of asked.unreadable) {
          problems.push(`answer unreadable on ${atomUnits.get(entry.atom)}: ${entry.reason}`);
        }
        const produced = new Map<string, { atomId: string; unit?: string }>();
        for (const [atomId, list] of asked.limits) {
          for (const found of list) {
            produced.set(key(atomId, found.limit, found.comparison, found.role), {
              atomId,
              ...(found.unit === undefined ? {} : { unit: found.unit }),
            });
          }
        }
        const planted = [...produced.keys()].find((k) => wanted.has(k));
        if (planted !== undefined) produced.delete(planted);
        const limited = variables.withLimits(approved, asked.limits);
        const withLimits = variables.estateToVariables(limited, resolver);
        const conditions = withLimits.store.variables.filter((variable) =>
          variable.id.startsWith('condition.'),
        );
        let unitNotes = 0;
        for (const [k, limit] of wanted) {
          const got = produced.get(k);
          if (!got) {
            problems.push(
              `limit missing: ${limit.unit} (${limit.limit} ${limit.comparison} ${limit.role}) on ${limit.governs} was not produced`,
            );
          } else if (limit.unit_of !== undefined && got.unit !== limit.unit_of) unitNotes++;
        }
        for (const [k, got] of produced) {
          if (!wanted.has(k)) {
            problems.push(
              `limit not in the truth: ${k.replace(`${got.atomId} | `, '')} produced on ${atomUnits.get(got.atomId)}`,
            );
          }
        }
        const refusedAtoms = new Set(withLimits.refused.map((entry) => entry.atom));
        const others = approved.atoms
          .filter((atom) => !atomUnits.has(atom.id) && !refusedAtoms.has(atom.id))
          .reduce((sum, atom) => sum + variables.conditionsOf(atom).length, 0);
        const producedCount = [...asked.limits.values()].reduce((sum, list) => sum + list.length, 0);
        if (conditions.length !== producedCount + others) {
          problems.push(
            `${conditions.length} condition variables for ${producedCount} produced limits and ${others} of code`,
          );
        }
        const valid = validateVariableStore(withLimits.store);
        if (!valid.ok)
          problems.push(`the store is invalid: ${valid.errors.map((e) => e.message).join('; ')}`);
        const original = [...wanted].filter(([, limit]) => !ADDED_AFTER_RECORDING.has(limit.unit));
        expect(
          {
            truth: original.length,
            found: original.filter(([k]) => produced.has(k)).length,
            produced: produced.size,
          },
          'the producer on the 38-limit truth (truth limits, found, produced) differs from known-gaps.json',
        ).toEqual(KNOWN[estate].limits38);
        holdGaps('3 variables', problems);
        const found = [...wanted.keys()].filter((k) => produced.has(k)).length;
        return `${values.size} instruction values, ${found} of ${wanted.size} truth limits produced, ${producedCount - found} extra, ${unitNotes} with another unit text`;
      });
    });

    it('step 4 plan: the space map and the plan cover the instruction atoms of the truth, and no other', async () => {
      await prove('4 plan', async () => {
        const truth = must(chain.truth, '2');
        const approved = must(chain.approved, '3');
        const atomOf = must(chain.atomOf, '2');
        const mapped = await cli([
          'estate',
          'map',
          join(work, 'approved.yaml'),
          '--to',
          join(work, 'space.yaml'),
          '--agent',
          `gold-${estate.toLowerCase()}`,
        ]);
        expect(mapped.err).toBe('');
        expect(mapped.code).toBe(0);
        const planned = await cli([
          'estate',
          'plan',
          join(work, 'approved.yaml'),
          '--space',
          join(work, 'space.yaml'),
          '--out',
          join(work, 'plan.yaml'),
        ]);
        expect(planned.err).toBe('');
        expect(planned.code).toBe(0);
        const loaded = await loadPlan(join(work, 'plan.yaml'));
        if (!loaded.ok) throw new Error(loaded.errors.map((issue) => issue.message).join('; '));
        const plan = loaded.plan;
        expect(plan.mapHash).toBe(approved.hash);

        const problems: string[] = [];
        const named = new Set(plan.rows.flatMap((row) => row.atomIds));
        for (const id of truth.plan.cover) {
          const atom = atomOf.get(id);
          if (!atom) problems.push(`cover ${id}: no instruction atom`);
          else if (!named.has(atom.id)) problems.push(`cover ${id}: no plan row names ${atom.id}`);
        }
        for (const id of truth.plan.exclude) {
          const atom = atomOf.get(id);
          if (atom) problems.push(`exclude ${id}: it has the instruction atom ${atom.id}`);
        }
        truth.plan.same_row.forEach((group, at) => {
          const atoms = group.map((id) => atomOf.get(id)?.id);
          const together = plan.rows.some((row) =>
            atoms.every((id) => id !== undefined && row.atomIds.includes(id)),
          );
          if (!together) {
            const widest = Math.max(
              0,
              ...plan.rows.map(
                (row) => atoms.filter((id) => id !== undefined && row.atomIds.includes(id)).length,
              ),
            );
            problems.push(
              `same_row ${at}: no plan row names ${group.join(', ')} together (widest row holds ${widest} of ${group.length})`,
            );
          }
        });
        for (const planted of truth.planted_rules) {
          const atom = atomOf.get(planted.unit);
          if (atom && !named.has(atom.id))
            problems.push(`planted ${planted.unit}: no plan row names ${atom.id}`);
        }
        holdGaps('4 plan', problems);
        const widest = Math.max(...plan.rows.map((row) => row.atomIds.length));
        return `plan ${plan.rows.length} rows (widest names ${widest} atoms) over map ${approved.hash.slice(0, 12)}`;
      });
    });

    it('step 5 blocks: each planted rule has a complete spec whose block carries its ask and its link', async () => {
      await prove('5 blocks', async () => {
        const truth = must(chain.truth, '2');
        const approved = must(chain.approved, '3');
        const atomOf = must(chain.atomOf, '2');
        const ledgerOf = must(chain.ledgerOf, '2');
        const situations = truth.planted_rules.flatMap((planted, at) => {
          const atom = atomOf.get(planted.unit);
          if (!atom) return [];
          const trigger = {
            id: `ask-${at + 1}`,
            title: `An ask that sets off rule ${at + 1}`,
            use: 'trigger',
          };
          const outside = { id: `near-${at + 1}`, title: `An ask next to rule ${at + 1}`, use: 'near_miss' };
          const phrase = (text: string) => [{ text, lang: 'en', approved: true }];
          return [
            { ...trigger, atoms: [atom.id], phrases: phrase(planted.ask) },
            ...(planted.near_miss === undefined
              ? []
              : [{ ...outside, atoms: [atom.id], phrases: phrase(planted.near_miss) }]),
          ];
        });
        const bank = {
          version: 1,
          estate: `gold-${estate.toLowerCase()}`,
          mapHash: approved.hash,
          workspaces: [],
          situations,
          deviations: [],
        };
        chain.phrases = join(work, 'phrases.yaml');
        await writeFile(chain.phrases, stringifyYaml(bank));

        const approving = await cli(['estate', 'plan', 'approve', join(work, 'plan.yaml'), '--all']);
        expect(approving.err).toBe('');
        expect(approving.code).toBe(0);
        const out = join(work, 'generated');
        const generated = await cli([
          'estate',
          'generate',
          '--map',
          join(work, 'approved.yaml'),
          '--plan',
          join(work, 'plan.yaml'),
          '--out',
          out,
          '--phrases',
          chain.phrases,
        ]);
        expect(generated.err).toBe('');
        expect(generated.code).toBeLessThanOrEqual(1);
        const specs: Generated[] = [];
        for (const path of (await filesUnder(out)).filter((file) => file.endsWith('.yaml'))) {
          const spec = parseYaml(await readFile(path, 'utf8')) as Spec;
          const folder = relative(out, path).split('/').slice(0, 2).join('/');
          specs.push({ path, folder, spec });
        }
        chain.specs = specs;

        const problems: string[] = [];
        for (const planted of truth.planted_rules) {
          const atom = atomOf.get(planted.unit);
          if (!atom) continue;
          const naming = specs.filter((entry) => entry.spec.metadata.estate.atoms.includes(atom.id));
          const complete = naming.filter((entry) => entry.folder.startsWith('specs/live'));
          const asked = complete.filter((entry) =>
            entry.spec.blocks.some((b) => b.when?.user === planted.ask),
          );
          if (asked.length === 0) {
            const where = naming.map((entry) => entry.folder).join(', ');
            problems.push(
              `${planted.unit}: no complete live spec asks "${planted.ask}" (specs naming ${atom.id}: ${where})`,
            );
            continue;
          }
          const linked = asked.some((entry) =>
            (entry.spec.metadata.links ?? []).some(
              (link) =>
                link.relation === 'verifies' &&
                link.to.rule === atom.id &&
                link.to.ledger === ledgerOf.get(planted.unit),
            ),
          );
          if (!linked)
            problems.push(`${planted.unit}: no spec links its ask block to ${atom.id} with the ledger id`);
        }
        expect(problems, report('blocks', problems)).toEqual([]);
        return `${specs.length} specs, ${specs.filter((s) => s.folder.startsWith('specs/live')).length} live complete`;
      });
    });

    it('step 6 links: deleting a planted rule flips the blocks that link it, and no other', async () => {
      await prove('6 links', async () => {
        const truth = must(chain.truth, '2');
        const atomOf = must(chain.atomOf, '2');
        const specs = must(chain.specs, '5');
        const phrases = must(chain.phrases, '5');
        const problems: string[] = [];
        let verified = 0;
        for (const [at, planted] of truth.planted_rules.entries()) {
          const atom = atomOf.get(planted.unit);
          if (!atom) continue;
          const paths = specs
            .filter((entry) => entry.folder.startsWith('specs/live'))
            .filter((entry) => entry.spec.metadata.estate.atoms.includes(atom.id))
            .map((entry) => entry.path);
          const mutant = join(work, `mutant-${at + 1}`);
          const made = await cli([
            'estate',
            'mutate',
            join(work, 'approved.yaml'),
            '--atom',
            atom.id,
            '--delete',
            '--to',
            mutant,
          ]);
          if (made.code !== 0) {
            problems.push(`${planted.unit}: mutate exited ${made.code}: ${made.err.trim()}`);
            continue;
          }
          const env = [
            `FAKE_MAP=${join(work, 'approved.yaml')}`,
            `FAKE_PHRASES=${phrases}`,
            `FAKE_GRAMMAR=${join(work, 'no-grammar.json')}`,
          ].flatMap((pair) => ['--set-env', pair]);
          const run = async (root: string, store: string, extra: string[]) =>
            cli([
              'estate',
              'run',
              ...paths,
              '--estate',
              root,
              '--runtime',
              'claude-code',
              '--command',
              FAKE,
              ...env,
              '--store',
              store,
              ...JUDGE,
              ...extra,
            ]);
          const before = await run(estateDir, join(work, `original-${at + 1}.db`), [
            '--map',
            join(work, 'approved.yaml'),
          ]);
          const after = await run(mutant, join(work, `mutant-${at + 1}.db`), []);
          if (before.err !== '' || after.err !== '') {
            problems.push(`${planted.unit}: run said ${before.err.trim()} ${after.err.trim()}`);
            continue;
          }
          const proved = await cli([
            'estate',
            'prove',
            ...paths,
            '--mutant',
            mutant,
            '--original',
            join(work, `original-${at + 1}.db`),
            '--mutated',
            join(work, `mutant-${at + 1}.db`),
            '--json',
          ]);
          if (proved.code === 2) {
            problems.push(`${planted.unit}: prove said ${proved.err.trim()}`);
            continue;
          }
          const proof = JSON.parse(proved.out) as Proof;
          const counts = proof.counts;
          if (counts.verified < 1)
            problems.push(`${planted.unit}: no link verified (${JSON.stringify(counts)})`);
          if (counts.refuted > 0) problems.push(`${planted.unit}: ${counts.refuted} links refuted`);
          if (counts.unlinkedFlips > 0)
            problems.push(`${planted.unit}: ${counts.unlinkedFlips} blocks flip with no link`);
          verified += counts.verified;
        }
        expect(problems, report('links', problems)).toEqual([]);
        return `${verified} links verified over ${truth.planted_rules.length} planted rules`;
      });
    });

    it('step 7 table: every step is verified, or its gaps are exactly the known ones', () => {
      const lines = rows.map((row) => `${row.step.padEnd(14)} ${row.verified.padEnd(4)} ${row.tie}`);
      const open = rows.filter((row) => row.verified === 'gap').map((row) => row.step);
      const verdict =
        open.length === 0
          ? `GATE B: PASSED, estate ${estate}`
          : `GATE B: NOT PASSED at steps ${open.map((step) => step.split(' ')[0]).join(', ')}, estate ${estate}`;
      console.log(`gold estate ${estate}\n${lines.join('\n')}\n${verdict}`);
      const summary = process.env.GITHUB_STEP_SUMMARY;
      if (summary !== undefined && summary !== '') {
        appendFileSync(summary, `${verdict}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
      }
      expect(rows.length).toBe(6);
      expect(rows.filter((row) => row.verified === 'NO').map((row) => row.step)).toEqual([]);
      expect(open).toEqual(KNOWN[estate].notPassed);
    });
  });
}
