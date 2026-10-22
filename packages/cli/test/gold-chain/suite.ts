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
import { idsProblems, labelsProblems } from '../../../estate/test/gold/steps';
import { loadTruth, type Truth } from '../../../estate/test/gold/truth';
import { type Io, main } from '../../src/index';
import { LAYOUT } from './layout';

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
const SHOWN = 12;
const INSTRUCTION = new Set(['rule', 'prohibition', 'gate']);

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

  const rows: Array<{ step: string; tie: string; verified: 'yes' | 'NO' }> = [];
  async function prove(step: string, check: () => Promise<string>): Promise<void> {
    const row: { step: string; tie: string; verified: 'yes' | 'NO' } = { step, tie: '', verified: 'NO' };
    rows.push(row);
    row.tie = await check();
    row.verified = 'yes';
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
        // A unit takes one label and one target: the first scope of a condition unit applies, and a unit whose gold
        // label is an instruction stays an instruction (it is covered as one), so its scopes are skipped.
        const applied = new Map<string, Truth['scopes'][number]>();
        for (const scope of truth.scopes) {
          const label = byId.get(scope.unit)?.label ?? '';
          if (!applied.has(scope.unit) && !INSTRUCTION.has(label)) applied.set(scope.unit, scope);
        }
        const scopes = [...applied.values()].map((scope) => ({
          unit: place(scope.unit),
          target: place(scope.target),
        }));
        const reader = readerFor('claude-code', { ignore: [] });
        if (reader === undefined) throw new Error('the claude-code reader is missing');
        const parsed = pointer.parseLabelSets(GOLD_SET_YAML);
        if (!parsed.ok) throw new Error(parsed.message);
        const labeller = goldLabeller(
          gold.map((unit) => ({ ...unit, file: LAYOUT[estate][unit.file] ?? unit.file })),
          [],
          scopes,
        );
        const scan = await scanEstate({
          root: estateDir,
          reader,
          rootLabel: 'estate',
          ceiling: 40_000,
          pointer: {
            sets: parsed.sets,
            labelling: pointer.singleLabelling(labeller),
            cassette: new pointer.Cassette(),
            mode: 'record',
            estateKey: GOLD_ESTATE_KEY,
          },
        });
        chain.scan = scan;
        const done = must(scan.pointer, '2');
        const problems: string[] = [];
        for (const failure of done.failed) problems.push(`window failed: ${failure}`);
        for (const refusal of [...done.refusals, ...done.atomRefusals]) problems.push(`refused: ${refusal}`);

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
        expect(problems, report('labels to atoms', problems)).toEqual([]);
        chain.ledgerOf = ledgerOf;
        chain.atomOf = new Map(
          [...ledgerOf].flatMap(([goldId, ledgerId]) => {
            const atom = atomOf.get(ledgerId);
            return atom ? [[goldId, atom] as const] : [];
          }),
        );
        await writeFile(join(work, 'map.yaml'), renderEstateMap(scan.map));
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

        // The limits of the truth file become the numeric conditions of the atoms they govern.
        let skippedLimits = 0;
        const governed = new Map<string, Truth['limits'][number]>();
        for (const limit of truth.limits) {
          // An atom has one condition, and a unit without an instruction atom has none: the first limit of an atom
          // applies, the others are counted in the result line.
          if (!atomOf.has(limit.governs) || governed.has(limit.governs)) skippedLimits++;
          else governed.set(limit.governs, limit);
        }
        const limited: EstateMap = {
          ...approved,
          atoms: approved.atoms.map((atom) => {
            const entry = [...governed].find(([id]) => atomOf.get(id)?.id === atom.id)?.[1];
            if (!entry) return atom;
            const unit = entry.unit_of === undefined ? {} : { unit: entry.unit_of };
            const condition = { limit: entry.limit, comparison: entry.comparison, ...unit };
            return { ...atom, fields: { ...atom.fields, condition } };
          }),
        };
        const withLimits = variables.estateToVariables(limited, resolver);
        const conditions = withLimits.store.variables.filter((variable) =>
          variable.id.startsWith('condition.'),
        );
        if (conditions.length !== governed.size) {
          problems.push(`${conditions.length} condition variables for ${governed.size} governed atoms`);
        }
        const shape = (limit: number, comparison: string | undefined): string => `${limit} ${comparison}`;
        const wanted = [...governed.values()].map((entry) => shape(entry.limit, entry.comparison)).sort();
        const found = conditions
          .map((variable) =>
            shape(variable.boundaries?.[0]?.limit ?? Number.NaN, variable.boundaries?.[0]?.comparison),
          )
          .sort();
        if (wanted.join('|') !== found.join('|')) {
          problems.push(`condition boundaries ${found.join(', ')} vs the limits ${wanted.join(', ')}`);
        }
        const valid = validateVariableStore(withLimits.store);
        if (!valid.ok)
          problems.push(`the store is invalid: ${valid.errors.map((e) => e.message).join('; ')}`);
        expect(problems, report('variables', problems)).toEqual([]);
        return `${values.size} instruction values, ${conditions.length} conditions (${skippedLimits} limits skipped)`;
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
          // The planner combines atoms by the axes of a row, not by the section they sit in: each atom of a group
          // must be named by some row, and the widest row is reported.
          for (const id of atoms) {
            if (id === undefined) problems.push(`same_row ${at}: a unit has no instruction atom`);
            else if (!named.has(id)) problems.push(`same_row ${at}: no plan row names ${id}`);
          }
        });
        for (const planted of truth.planted_rules) {
          const atom = atomOf.get(planted.unit);
          if (atom && !named.has(atom.id))
            problems.push(`planted ${planted.unit}: no plan row names ${atom.id}`);
        }
        expect(problems, report('plan', problems)).toEqual([]);
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

    it('step 7 table: every step above is verified', () => {
      const lines = rows.map((row) => `${row.step.padEnd(14)} ${row.verified.padEnd(4)} ${row.tie}`);
      console.log(`gold estate ${estate}\n${lines.join('\n')}`);
      expect(rows.length).toBe(6);
      expect(rows.filter((row) => row.verified !== 'yes').map((row) => row.step)).toEqual([]);
    });
  });
}
