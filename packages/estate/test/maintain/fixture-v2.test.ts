import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  diffEstateMaps,
  diffGuardStates,
  type EstateDiff,
  estateImpact,
  loadEstateMap,
  loadEstateTests,
  loadGuardState,
  parseEstateDiff,
  pointer,
  renderImpact,
  scanEstate,
} from '../../src/index';
import type { EstateMap } from '../../src/schema';
import { FIXTURE, HAND_ROLES, NOW, replayPointer } from '../support';

const V2 = fileURLToPath(new URL('../../../../examples/estates/fixture-v2/', import.meta.url));
const OLD_PATH = 'examples/estates/fixture/approved.yaml';
const NEW_PATH = 'examples/estates/fixture-v2/map.yaml';

const R7 = 'instruction.standing.r7-when-a-shipment-is-late';
const ROUTE = 'route.standing.an-ask-to-plan-the-delivery';
const R2 = 'instruction.standing.r2-never-send-an-email-to';
const R18 = 'instruction.standing.r18-never-approve-a-credit-note';
const FILL = 'register.weekly-report.fill-the-template-in-this-order';
const LEDGER = 'guard.settings.posttooluse-bash-guard-ledger-guard-py';

async function map(path: string): Promise<EstateMap> {
  const loaded = await loadEstateMap(path);
  if (!loaded.ok) throw new Error(`${path}: ${loaded.errors.map((error) => error.message).join('; ')}`);
  return loaded.map;
}

async function fresh(): Promise<EstateDiff> {
  const before = await map(join(FIXTURE, 'approved.yaml'));
  const after = await map(join(V2, 'map.yaml'));
  const oldState = await loadGuardState(join(V2, 'maintain', 'guard-state.v1.yaml'), before, true);
  const newState = await loadGuardState(join(V2, 'guard-state.yaml'), after, true);
  if (!oldState.ok || !newState.ok) throw new Error('the guard states do not fit their maps');
  const ledger = async (path: string) => {
    const parsed = pointer.parseLedger(await readFile(path, 'utf8'));
    if (!parsed) throw new Error(`${path} is not a ledger`);
    return parsed;
  };
  return diffEstateMaps(before, after, {
    oldPath: OLD_PATH,
    newPath: NEW_PATH,
    guards: diffGuardStates(oldState.state, newState.state),
    ledgers: {
      before: await ledger(join(FIXTURE, 'ledger.json')),
      after: await ledger(join(V2, 'ledger.json')),
    },
  });
}

describe('the fixture-v2 estate', () => {
  it('has a committed map equal to a fresh scan with its recorded labels', async () => {
    const scanned = await scanEstate({
      root: V2,
      reader: new ClaudeCodeReader(),
      registryRoles: HAND_ROLES,
      now: NOW,
      pointer: await replayPointer(V2, join(FIXTURE, 'ledger.json')),
    });
    const committed = await map(join(V2, 'map.yaml'));
    expect(scanned.refusals).toEqual([]);
    expect(scanned.map.hash).toBe(committed.hash);
    expect(scanned.map.atoms.map((atom) => atom.id)).toEqual(committed.atoms.map((atom) => atom.id));
    expect(scanned.map.edges).toEqual(committed.edges);
  });

  it('diffs against the first version with every planted case and nothing else', async () => {
    const diff = await fresh();
    // R2 wraps onto two lines (white space only); R7 and the route planner's request change their meaning.
    expect(diff.atoms.changed.map((entry) => [entry.id, entry.change, entry.now ?? null])).toEqual([
      [R2, 'whitespace', null],
      [R7, 'semantic', null],
      [ROUTE, 'semantic', null],
    ]);
    expect(diff.atoms.removed.map((entry) => entry.id)).toEqual([]);
    // R18 is new. The weekly report's order line is labelled in this version only: the first version left it
    // unlabeled (a three-way split of its runs), so it reads as added.
    expect(diff.atoms.added.map((entry) => entry.id)).toEqual([FILL, R18]);
    expect(diff.edges.added).toEqual([]);
    expect(diff.edges.removed).toEqual([]);
    // R12 is removed and R19 written at its place: the ledger keeps the unit, so it is one changed unit. No atom
    // covers it in the first version (its runs split), so the atom diff cannot see it; the units diff does.
    expect(
      diff.units?.unlabeled?.map((entry) => [entry.path, entry.was?.slice(0, 8), entry.quote.slice(0, 8)]),
    ).toEqual([['CLAUDE.md', '**R12.**', '**R19.**']]);
    expect(diff.guards?.filter((entry) => entry.move !== 'unchanged')).toEqual([
      {
        guard: LEDGER,
        from: 'warn',
        to: 'enforce',
        move: 'promoted',
        evidence: {
          log: 'logs/ledger-guard.decisions.jsonl',
          decisions: 47,
          wrong: 0,
          note: 'Four weeks of warnings; every flagged delete under ledger/ was a real one.',
        },
      },
    ]);
    expect(diff.guards).toHaveLength(6);
    // A unit whose neighbours changed is read again: the label of two of them came back with other evidence.
    expect(diff.atoms.restated.map((entry) => [entry.id, entry.fields])).toEqual([
      ['instruction.standing.r8-do-not-invent-order-numbers', ['situation', 'evidence', 'fields']],
      ['instruction.standing.r17-report-a-number-only-when', ['situation', 'fields']],
      ['invariant.standing.the-standing-instructions-stay-under-40000', ['fields']],
    ]);
    expect(diff.summary).toEqual({
      added: 2,
      removed: 0,
      whitespace: 1,
      semantic: 2,
      moved: 25,
      restated: 3,
      unchanged: 86,
      edgesAdded: 0,
      edgesRemoved: 0,
    });
  });

  it('has a committed diff equal to a fresh one', async () => {
    const committed = parseEstateDiff(await readFile(join(V2, 'maintain', 'diff.json'), 'utf8'));
    if (!committed.ok) throw new Error(committed.message);
    expect(committed.diff).toEqual(await fresh());
  });

  it('has a committed impact equal to a fresh one, with each list as planted', async () => {
    const diff = await fresh();
    const tests = await loadEstateTests(join(V2, 'tests'));
    if (!tests.ok) throw new Error(tests.errors.join('\n'));
    const report = estateImpact(diff, tests.tests, { others: tests.others });
    const committed = JSON.parse(await readFile(join(V2, 'maintain', 'impact.json'), 'utf8'));
    expect(report).toEqual(committed);

    expect(report.regenerate.map((entry) => [entry.test, entry.atoms.map((item) => item.why)])).toEqual([
      ['northwind-late-shipment', ['semantic']],
      ['northwind-ledger-archive', ['guard_state']],
      ['northwind-route-planner', ['semantic']],
    ]);
    expect(report.reapprove.map((entry) => [entry.atom, entry.tests])).toEqual([
      [R7, ['northwind-late-shipment']],
      [ROUTE, ['northwind-route-planner']],
    ]);
    expect(report.retire).toEqual([]);
    expect(report.new.map((entry) => entry.atom)).toEqual([FILL, R18]);
    // R12 to R19: no test to regenerate, a person reviews it, and the tests that cite the standing file are touched.
    expect(report.units?.unlabeled?.map((entry) => [entry.path, entry.tests])).toEqual([
      [
        'CLAUDE.md',
        [
          'northwind-draft-pair',
          'northwind-force-push',
          'northwind-late-shipment',
          'northwind-ledger-archive',
          'northwind-route-planner',
          'northwind-stop-word',
          'northwind-supplier-yes',
        ],
      ],
    ]);
    expect(report.needsPerson).toContainEqual(
      expect.stringMatching(/^review the unlabeled unit \S+ in CLAUDE\.md/),
    );
    expect(report.guards.map((entry) => [entry.guard, entry.move, entry.tests, entry.need])).toEqual([
      [LEDGER, 'promoted', ['northwind-ledger-archive'], null],
    ]);
    // unsent-draft names only R12's atom of an earlier map, which the first version no longer holds: no change
    // can reach it, so it is never read as untouched; it is listed and a person decides.
    expect(report.stale).toEqual([
      {
        test: 'northwind-unsent-draft',
        file: 'unsent-draft.yaml',
        atoms: ['instruction.standing.r12-when-r2-applies-and-the'],
      },
    ]);
    expect(report.needsPerson).toContainEqual(
      expect.stringMatching(/^the test northwind-unsent-draft cites an atom no longer in the map/),
    );
    expect(renderImpact(report)).toContain(
      'Cites atoms no longer in the map, no change reaches it:\n  northwind-unsent-draft (unsent-draft.yaml): instruction.standing.r12-when-r2-applies-and-the\n',
    );
    expect(report.unaffected).toEqual({ moved: 25, tests: 0 });
    expect(report.needsPerson).toHaveLength(6);
  });
});
