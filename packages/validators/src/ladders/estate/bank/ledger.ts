import { rm } from 'node:fs/promises';
import { type EstateMap, pointer, readerFor, scanEstate } from '@agent-nexus/driftbench-estate';
import { drawEstate } from '../hidden';
import { RUNTIME } from '../layout';
import { matchAtoms, writeEstate } from '../pipeline';
import { type Rendered, renderEstate } from '../render';
import { type Family, type ItemResult, type ItemSpec, itemsOf, type Tier } from './frame';
import { BUDGET_FLOOR_MS, BUDGET_PER_ATOM, SIZES } from './scale';
import { scaleEstate } from './scale-estate';

/**
 * Level 8 (estate ladder version 2), the ledger: the estate read by the pointer reader (PR 692) and the blast
 * radius read from its ledger (PR 830). docs/estate.md, "The pointer reader", and docs/concepts/blast-radius.md
 * are the oracles; the generated estate is the truth.
 *
 * - ledger-scan: the scan items move to labels and the ledger. A truth labeler answers each window from the
 *   recording the generator writes (a unit takes the label of the planted prose atom whose quote it holds, by
 *   containment of a declared value), and the whole scan runs through the pointer reader. Every planted atom
 *   is found at its file and line, nothing else is, each pointer atom names its ledger unit, and a second
 *   scan carries every label without a call.
 * - ledger-diff: the diff and impact items move to the ledger ladder. One seeded edit per class (changed,
 *   deleted, moved, new, split, merged, a renamed heading) is applied to the estate, and the edit class of
 *   each unit, its rerun set and the change manifest are compared with the documented rule.
 * - ledger-scale: the same stages on estates of 250 to 5000 atoms inside a time budget.
 */

/**
 * The rerun rule of each edit class, as docs/estate.md and docs/concepts/blast-radius.md state it, written here
 * so the oracle never reads the table it judges: unchanged reruns nothing; context and moved are advisory;
 * changed and deleted rerun the unit's links; new reruns the old units of its section.
 */
const DOC_RERUN: Readonly<Record<string, 'none' | 'advisory' | 'unit' | 'section'>> = {
  unchanged: 'none',
  context: 'advisory',
  moved: 'advisory',
  changed: 'unit',
  deleted: 'unit',
  new: 'section',
};

const POINTER_CUT = 'packages/estate/src/pointer/cut.ts';
const POINTER_SCAN = 'packages/estate/src/pointer/scan.ts';
const POINTER_ATOMS = 'packages/estate/src/pointer/atoms.ts';
const LEDGER = 'packages/estate/src/pointer/ledger.ts';
const RADIUS = 'packages/estate/src/pointer/radius.ts';
const LEVEL = 8;

type RecordedAtom = { kind: string; quote: string; polarity?: string; line: number };

/** The planted prose atoms of each file, read from the generator's recording. */
function plantedProse(rendered: Rendered): Map<string, RecordedAtom[]> {
  const out = new Map<string, RecordedAtom[]>();
  for (const [path, recorded] of Object.entries(rendered.recording.answers)) {
    const answers = Array.isArray(recorded) ? recorded : [recorded];
    for (const answer of answers) {
      const atoms = (answer as { atoms?: RecordedAtom[] }).atoms ?? [];
      out.set(path, [...(out.get(path) ?? []), ...atoms]);
    }
  }
  return out;
}

const labelOf = (atom: RecordedAtom): string =>
  atom.kind === 'gate'
    ? 'gate'
    : atom.kind === 'register'
      ? 'reply-rule'
      : atom.polarity === 'prohibition'
        ? 'prohibition'
        : 'rule';

/**
 * The truth labeler: a system 2 labeler that answers each unit with the label of the planted atom whose quote
 * the unit holds, and `description` otherwise. It reads no word: the quote is a declared value of the plant.
 */
function truthLabeler(planted: ReadonlyMap<string, RecordedAtom[]>, log: string[] = []): pointer.Labeler {
  return {
    id: 'estate-truth',
    cls: 'system2',
    family: 'truth',
    model: 'truth-1',
    settings: {},
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({
      labeler: 'estate-truth',
      body: { set: set.set, window: window.id, units: window.units.map((unit) => unit.text) },
    }),
    opinions: pointer.denseOpinions,
    async call(_wire, _set, window) {
      log.push(window.id);
      const atoms = planted.get(window.path) ?? [];
      return {
        labels: window.units.map((unit) => {
          const atom = atoms.find((each) => unit.text.includes(each.quote));
          return { units: String(unit.n), label: atom ? labelOf(atom) : 'description' };
        }),
        returnedModel: 'truth-1',
        stopReason: 'end_turn',
        usage: { input: 0, output: 0 },
      };
    },
  };
}

function agentRules(): pointer.LabelSet[] {
  const parsed = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets;
}

type Scan = { map: EstateMap; calls: number; windows: number; carried: number; ledger: pointer.Ledger };

/** Scans files with the pointer reader and the truth labeler, from a previous ledger when given. */
async function pointerScanOf(
  files: Readonly<Record<string, string>>,
  planted: ReadonlyMap<string, RecordedAtom[]>,
  options: { previous?: pointer.Ledger; cassette?: pointer.Cassette; replay?: boolean; log?: string[] } = {},
): Promise<Scan> {
  const root = await writeEstate(files);
  try {
    const reader = readerFor(RUNTIME);
    if (!reader) throw new Error(`no reader for ${RUNTIME}`);
    const labeler = truthLabeler(planted, options.log);
    const result = await scanEstate({
      root,
      reader,
      pointer: {
        sets: agentRules(),
        labelling: pointer.singleLabelling(options.replay ? { ...labeler, call: undefined } : labeler),
        cassette: options.cassette ?? new pointer.Cassette(),
        mode: options.replay ? 'replay' : 'record',
        ...(options.previous ? { previous: options.previous } : {}),
      },
      now: () => new Date('2026-10-18T00:00:00.000Z'),
    });
    const p = result.pointer;
    if (!p) throw new Error('the scan ran no pointer reader');
    return { map: result.map, calls: p.calls, windows: p.windows, carried: p.carried, ledger: p.ledger };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const PROSE = new Set(['instruction', 'gate', 'register']);

const check = (holds: boolean, detail: string): ItemResult => ({
  pass: holds,
  detail: holds ? 'held' : detail,
});

/** A planted prose rule to edit: one of a standing or skill file, seeded. */
function pickRule(
  planted: ReadonlyMap<string, RecordedAtom[]>,
  seed: number,
  salt: string,
): { path: string; atom: RecordedAtom } {
  const all = [...planted].flatMap(([path, atoms]) =>
    atoms.filter((atom) => atom.kind === 'instruction').map((atom) => ({ path, atom })),
  );
  if (all.length === 0) throw new Error('the estate holds no planted prose rule');
  let hash = seed;
  for (const char of salt) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return all[hash % all.length] as { path: string; atom: RecordedAtom };
}

// ---------------------------------------------------------------------------------------------------------
// ledger-scan

const SCAN_SPECS: ItemSpec[] = [
  {
    key: 'recall.rule',
    tier: 2,
    title: 'every planted obligation is found by the pointer reader at its file and line',
    cause: 'pointer:label-to-atom-instruction-obligation',
    component: POINTER_ATOMS,
  },
  {
    key: 'recall.prohibition',
    tier: 2,
    title: 'every planted prohibition is found at its file and line, as a prohibition',
    cause: 'pointer:label-to-atom-instruction-prohibition',
    component: POINTER_ATOMS,
  },
  {
    key: 'recall.gate',
    tier: 3,
    title: 'every planted gate is found at its file and line',
    cause: 'pointer:label-to-atom-gate',
    component: POINTER_ATOMS,
  },
  {
    key: 'recall.register',
    tier: 3,
    title: 'every planted reply rule is found as a register atom at its file and line',
    cause: 'pointer:label-to-atom-register',
    component: POINTER_ATOMS,
  },
  {
    key: 'precision.prose',
    tier: 2,
    title: 'the pointer reader builds no prose atom the estate does not plant',
    cause: 'pointer:no-atom-from-a-description',
    component: POINTER_ATOMS,
  },
  {
    key: 'code-atoms',
    tier: 1,
    title:
      'every code atom is found as with the model scan, none extra: the pointer reader changes only the prose',
    cause: 'scan:pointer-leaves-code-atoms',
    component: 'packages/estate/src/scan/invariants.ts',
  },
  {
    key: 'file.standing',
    tier: 2,
    title: 'the standing file: every planted prose atom found',
    cause: 'pointer:windows-cover-every-unit',
    component: POINTER_SCAN,
  },
  {
    key: 'file.skills',
    tier: 2,
    title: 'the skill files: every planted prose atom found',
    cause: 'pointer:windows-cover-every-unit',
    component: POINTER_SCAN,
  },
  {
    key: 'file.helpers',
    tier: 3,
    title: 'the helper files: every planted prose atom found',
    cause: 'pointer:windows-cover-every-unit',
    component: POINTER_SCAN,
  },
  {
    key: 'file.references',
    tier: 3,
    title: 'the reference files: every planted prose atom found',
    cause: 'pointer:windows-cover-every-unit',
    component: POINTER_SCAN,
  },
  {
    key: 'unit-ids',
    tier: 2,
    title: 'every pointer atom names a live unit of the ledger, and no two atoms of one label share a unit',
    cause: 'pointer:atom-names-its-unit',
    component: POINTER_ATOMS,
  },
  {
    key: 'extraction-field',
    tier: 1,
    title:
      'every pointer atom is unapproved and carries fields.extraction pointer, its unit, the label set and the label',
    cause: 'pointer:atom-fields',
    component: POINTER_ATOMS,
  },
  {
    key: 'class-field',
    tier: 2,
    title:
      'every pointer atom records the class of labeler that decided its label (docs/estate.md: "the class that decided it")',
    cause: 'pointer:atom-records-deciding-class',
    component: POINTER_ATOMS,
  },
  {
    key: 'map-ledger',
    tier: 2,
    title:
      'the map names who proposed its prose atoms: producedBy holds the family and the model of the labeler',
    cause: 'scan:map-produced-by-labeler',
    component: 'packages/estate/src/map/build.ts',
  },
  {
    key: 'replay',
    tier: 3,
    title: 'a second scan replays the cassette with no call and gives the same atom ids and the same ledger',
    cause: 'pointer:replay-from-cassette',
    component: POINTER_SCAN,
  },
  {
    key: 'carry',
    tier: 3,
    title: 'a scan from the previous ledger asks no window and carries every label',
    cause: 'ledger:carry-labels',
    component: LEDGER,
  },
  {
    key: 'edit.one-window',
    tier: 4,
    title: 'after one rule is edited by a word, the next scan asks only the windows that hold it',
    cause: 'pointer:relabel-only-changed-windows',
    component: POINTER_SCAN,
  },
  {
    key: 'edit.same-unit',
    tier: 4,
    title: 'after one rule is edited by a word, its atom stays on the same ledger unit',
    cause: 'ledger:follow-edited-unit',
    component: LEDGER,
  },
  {
    key: 'delete.atom-gone',
    tier: 3,
    title: 'after one rule is deleted, its atom is gone and every other prose atom stays on its unit',
    cause: 'ledger:mark-deleted',
    component: LEDGER,
  },
  {
    key: 'delete.entry-deleted',
    tier: 3,
    title: 'after one rule is deleted, its ledger entry is marked deleted',
    cause: 'ledger:mark-deleted',
    component: LEDGER,
  },
  {
    key: 'new-rule',
    tier: 3,
    title: 'a rule added to a file is labelled and becomes an atom at its line, the others keep their units',
    cause: 'pointer:new-unit-labelled',
    component: POINTER_SCAN,
  },
  {
    key: 'polarity',
    tier: 2,
    title: 'every instruction atom has the polarity of its planted rule',
    cause: 'pointer:label-to-atom-instruction-prohibition',
    component: POINTER_ATOMS,
  },
];

const fileClass = (path: string): string =>
  path.endsWith('SKILL.md')
    ? 'skills'
    : path.includes('/agents/')
      ? 'helpers'
      : path.includes('/references/') || path.includes('/skills/')
        ? 'references'
        : 'standing';

function ledgerScanFamily(): Family {
  const family = 'ledger-scan';
  return {
    id: family,
    level: LEVEL,
    component: POINTER_SCAN,
    items: itemsOf(family, LEVEL, POINTER_SCAN, SCAN_SPECS),
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      const set = (key: string, result: ItemResult) => out.set(`${family}.${key}`, result);
      const rendered = renderEstate(drawEstate(seed));
      const planted = plantedProse(rendered);
      const cassette = new pointer.Cassette();
      const first = await pointerScanOf(rendered.files, planted, { cassette });
      const match = matchAtoms(rendered.atoms, first.map.atoms);
      const missedOf = (kind: string, polarity?: string) =>
        match.missed.filter((atom) => {
          if (atom.kind !== kind) return false;
          if (!polarity) return true;
          const recorded = (planted.get(atom.file) ?? []).find((each) => each.line === atom.line);
          return (recorded?.polarity ?? 'obligation') === polarity;
        });
      const describe = (atoms: ReadonlyArray<{ file: string; line: number; kind: string }>) =>
        atoms
          .slice(0, 3)
          .map((atom) => `${atom.kind} ${atom.file}:${atom.line}`)
          .join('; ');
      const rule = missedOf('instruction', 'obligation');
      set('recall.rule', check(rule.length === 0, `${rule.length} obligations missed: ${describe(rule)}`));
      const prohibition = missedOf('instruction', 'prohibition');
      set(
        'recall.prohibition',
        check(
          prohibition.length === 0,
          `${prohibition.length} prohibitions missed: ${describe(prohibition)}`,
        ),
      );
      const gate = missedOf('gate');
      set('recall.gate', check(gate.length === 0, `${gate.length} gates missed: ${describe(gate)}`));
      const register = missedOf('register');
      set(
        'recall.register',
        check(register.length === 0, `${register.length} reply rules missed: ${describe(register)}`),
      );
      const extraProse = match.extra.filter((atom) => PROSE.has(atom.kind));
      set(
        'precision.prose',
        check(
          extraProse.length === 0,
          `${extraProse.length} prose atoms not planted: ${extraProse
            .slice(0, 3)
            .map((atom) => `${atom.kind} ${atom.provenance.file}:${atom.provenance.startLine}`)
            .join('; ')}`,
        ),
      );
      const codeMissed = match.missed.filter((atom) => !PROSE.has(atom.kind));
      const codeExtra = match.extra.filter((atom) => !PROSE.has(atom.kind));
      set(
        'code-atoms',
        check(
          codeMissed.length === 0 && codeExtra.length === 0,
          `${codeMissed.length} code atoms missed, ${codeExtra.length} extra`,
        ),
      );
      for (const cls of ['standing', 'skills', 'helpers', 'references']) {
        const missed = match.missed.filter((atom) => PROSE.has(atom.kind) && fileClass(atom.file) === cls);
        const planned = rendered.atoms.filter((atom) => PROSE.has(atom.kind) && fileClass(atom.file) === cls);
        set(
          `file.${cls}`,
          planned.length === 0
            ? check(true, '')
            : check(missed.length === 0, `${missed.length} of ${planned.length} missed: ${describe(missed)}`),
        );
      }
      const live = new Set(
        first.ledger.entries.filter((entry) => entry.status === 'live').map((entry) => entry.id),
      );
      const pointerAtoms = first.map.atoms.filter((atom) => atom.fields?.extraction === 'pointer');
      const units = pointerAtoms.map((atom) => String(atom.fields?.unit ?? ''));
      set(
        'unit-ids',
        check(
          units.every((unit) => live.has(unit)) && new Set(units).size === units.length,
          'a pointer atom names no live unit, or two share one',
        ),
      );
      set(
        'extraction-field',
        check(
          pointerAtoms.length > 0 &&
            pointerAtoms.every(
              (atom) =>
                atom.approved !== true &&
                typeof atom.fields?.unit === 'string' &&
                (atom.fields?.labelSet ?? atom.fields?.set) === 'agent-rules' &&
                typeof atom.fields?.label === 'string',
            ),
          `${pointerAtoms.length} pointer atoms; the first carries ${JSON.stringify(pointerAtoms[0]?.fields ?? {}).slice(0, 200)}, approved ${pointerAtoms[0]?.approved}`,
        ),
      );
      const classes = pointerAtoms.map(
        (atom) => atom.fields?.by ?? atom.fields?.class ?? atom.fields?.decidedBy,
      );
      set(
        'class-field',
        check(
          pointerAtoms.length > 0 && classes.every((cls) => cls === 'system2'),
          `the deciding class of the first pointer atom is ${JSON.stringify(classes[0])}; its fields are ${Object.keys(pointerAtoms[0]?.fields ?? {}).join(', ')}`,
        ),
      );
      const producedBy = (first.map as { producedBy?: { family?: string; model?: string } }).producedBy;
      set(
        'map-ledger',
        check(
          producedBy?.family === 'truth' && producedBy?.model === 'truth-1',
          `the map's producedBy is ${JSON.stringify(producedBy)}`,
        ),
      );
      const replay = await pointerScanOf(rendered.files, planted, {
        cassette: pointer.Cassette.parse(cassette.render()),
        replay: true,
      });
      set(
        'replay',
        check(
          replay.calls === 0 &&
            pointer.renderLedger(replay.ledger) === pointer.renderLedger(first.ledger) &&
            replay.map.atoms.map((atom) => atom.id).join(',') ===
              first.map.atoms.map((atom) => atom.id).join(','),
          `the replay made ${replay.calls} calls, or its ledger or atom ids differ`,
        ),
      );
      const carry = await pointerScanOf(rendered.files, planted, { previous: first.ledger, replay: true });
      set(
        'carry',
        check(
          carry.windows === 0 && carry.calls === 0,
          `the scan from the previous ledger asked ${carry.windows} windows`,
        ),
      );
      // One rule edited by one word.
      const target = pickRule(planted, seed, 'edit');
      const edited = target.atom.quote.replace(/\.$/, ' now.');
      const editedFiles = {
        ...rendered.files,
        [target.path]: (rendered.files[target.path] ?? '').replace(target.atom.quote, edited),
      };
      const editedPlanted = new Map(
        [...planted].map(([path, atoms]) => [
          path,
          atoms.map((atom) =>
            path === target.path && atom === target.atom ? { ...atom, quote: edited } : atom,
          ),
        ]),
      );
      const log: string[] = [];
      const afterEdit = await pointerScanOf(editedFiles, editedPlanted, { previous: first.ledger, log });
      const windowsOfTarget = new Set(log.map((id) => id.split('#')[0]));
      set(
        'edit.one-window',
        check(
          log.length >= 1 && [...windowsOfTarget].every((path) => path === target.path) && log.length <= 2,
          `the scan after the edit asked ${log.length} windows: ${log.join(', ')}`,
        ),
      );
      const unitBefore = pointerAtoms.find(
        (atom) => atom.provenance.file === target.path && atom.provenance.quote.includes(target.atom.quote),
      )?.fields?.unit;
      const unitAfter = afterEdit.map.atoms.find(
        (atom) =>
          atom.fields?.extraction === 'pointer' &&
          atom.provenance.file === target.path &&
          atom.provenance.quote.includes(edited),
      )?.fields?.unit;
      set(
        'edit.same-unit',
        check(
          unitBefore !== undefined && unitBefore === unitAfter,
          `the edited rule ${target.path} "${target.atom.quote.slice(0, 50)}" had its atom on ${unitBefore} and has it on ${unitAfter}; pointer atoms of the file: ${pointerAtoms
            .filter((atom) => atom.provenance.file === target.path)
            .map((atom) => atom.provenance.quote.slice(0, 30))
            .join(' | ')}`,
        ),
      );
      // One rule deleted.
      const gone = pickRule(planted, seed, 'delete');
      const deletedFiles = {
        ...rendered.files,
        [gone.path]: (rendered.files[gone.path] ?? '').replace(`${gone.atom.quote}`, ''),
      };
      const deletedPlanted = new Map(
        [...planted].map(([path, atoms]) => [
          path,
          atoms.filter((atom) => !(path === gone.path && atom === gone.atom)),
        ]),
      );
      const afterDelete = await pointerScanOf(deletedFiles, deletedPlanted, { previous: first.ledger });
      const goneUnit = pointerAtoms.find(
        (atom) => atom.provenance.file === gone.path && atom.provenance.startLine === gone.atom.line,
      )?.fields?.unit;
      const stillThere = afterDelete.map.atoms.some(
        (atom) => atom.fields?.extraction === 'pointer' && atom.fields?.unit === goneUnit,
      );
      const othersKept = pointerAtoms
        .filter((atom) => atom.fields?.unit !== goneUnit)
        .every((atom) => afterDelete.map.atoms.some((other) => other.fields?.unit === atom.fields?.unit));
      set(
        'delete.atom-gone',
        check(
          goneUnit !== undefined && !stillThere && othersKept,
          `the deleted rule's unit ${goneUnit} still has an atom, or another atom lost its unit`,
        ),
      );
      const goneEntry = afterDelete.ledger.entries.find((entry) => entry.id === goneUnit);
      set(
        'delete.entry-deleted',
        check(
          goneEntry?.status === 'deleted',
          `the deleted rule's ledger entry is ${goneEntry?.status ?? 'absent'}`,
        ),
      );
      // One rule added to the standing file.
      const added = 'Always name the file you changed in the reply.';
      const standing = Object.keys(rendered.files).find((path) => path === 'CLAUDE.md') ?? target.path;
      const addedFiles = { ...rendered.files, [standing]: `${rendered.files[standing] ?? ''}\n${added}\n` };
      const addedPlanted = new Map(planted);
      addedPlanted.set(standing, [
        ...(planted.get(standing) ?? []),
        { kind: 'instruction', quote: added, polarity: 'obligation', line: 0 },
      ]);
      const afterAdd = await pointerScanOf(addedFiles, addedPlanted, { previous: first.ledger });
      const addedLine =
        (addedFiles[standing] ?? '').split('\n').findIndex((line) => line.includes(added)) + 1;
      const addedAtom = afterAdd.map.atoms.find(
        (atom) =>
          atom.fields?.extraction === 'pointer' &&
          atom.provenance.file === standing &&
          atom.provenance.startLine === addedLine,
      );
      const keptUnits = pointerAtoms.every((atom) =>
        afterAdd.map.atoms.some((other) => other.fields?.unit === atom.fields?.unit),
      );
      set(
        'new-rule',
        check(
          addedAtom !== undefined && keptUnits,
          `the added rule at ${standing}:${addedLine} is ${addedAtom ? 'an atom' : 'no atom'}; units kept: ${keptUnits}`,
        ),
      );
      const wrongPolarity = pointerAtoms.filter((atom) => {
        if (atom.kind !== 'instruction') return false;
        const recorded = (planted.get(atom.provenance.file) ?? []).find(
          (each) => each.line === atom.provenance.startLine,
        );
        return (
          recorded !== undefined &&
          (recorded.polarity ?? 'obligation') !== (atom.fields?.polarity ?? 'obligation')
        );
      });
      set(
        'polarity',
        check(wrongPolarity.length === 0, `${wrongPolarity.length} instruction atoms carry another polarity`),
      );
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// ledger-diff

type Edit = {
  id: string;
  tier: Tier;
  expect: 'changed' | 'deleted' | 'moved' | 'new' | 'context' | 'split' | 'merged' | 'none';
};
const EDITS: Edit[] = [
  { id: 'unchanged', tier: 1, expect: 'none' },
  { id: 'changed', tier: 2, expect: 'changed' },
  { id: 'deleted', tier: 2, expect: 'deleted' },
  { id: 'moved', tier: 3, expect: 'moved' },
  { id: 'new', tier: 3, expect: 'new' },
  { id: 'split', tier: 4, expect: 'split' },
  { id: 'merged', tier: 4, expect: 'merged' },
  { id: 'heading-renamed', tier: 3, expect: 'context' },
];

const DIFF_SPECS: ItemSpec[] = [
  ...EDITS.map((edit) => ({
    key: `class.${edit.id}`,
    tier: edit.tier,
    title: `an edit of kind ${edit.id}: the edited units fall in the documented edit classes and every other unit is unchanged`,
    cause: `radius:edit-class-${edit.id}`,
    component: RADIUS,
  })),
  ...EDITS.map((edit) => ({
    key: `rerun.${edit.id}`,
    tier: Math.min(5, edit.tier + 1) as Tier,
    title: `an edit of kind ${edit.id}: the rerun set holds exactly what the rule of its classes reruns`,
    cause: `radius:rerun-${edit.id}`,
    component: RADIUS,
  })),
  {
    key: 'manifest.changed-atom',
    tier: 3,
    title: 'a changed unit that holds an atom is a prompt change of that atom',
    cause: 'radius:manifest-atoms-of-unit',
    component: RADIUS,
  },
  {
    key: 'manifest.unchanged-empty',
    tier: 1,
    title: 'no edit gives a manifest with no change',
    cause: 'radius:manifest-empty-when-unchanged',
    component: RADIUS,
  },
  {
    key: 'manifest.new-file',
    tier: 3,
    title: 'a unit in a file the ledger never held makes the radius the whole suite',
    cause: 'radius:new-file-whole-suite',
    component: RADIUS,
  },
  {
    key: 'manifest.unit-without-atom',
    tier: 3,
    title: 'a changed unit that holds no atom is a unit change',
    cause: 'radius:manifest-unit-change',
    component: RADIUS,
  },
];

/**
 * The text that replaces a rule to split it in two units: the second half as a list item of its own when the
 * rule is a list item, else as a paragraph of its own.
 */
function splitInFile(text: string, rule: string): string {
  const lineStart = text.lastIndexOf('\n', text.indexOf(rule)) + 1;
  const prefix = text.slice(lineStart, text.indexOf(rule));
  const words = rule.replace(/\.$/, '').split(' ');
  const half = Math.ceil(words.length / 2);
  const first = `${words.slice(0, half).join(' ')}.`;
  const second = `${(words.slice(half).join(' ') || 'Then stop').replace(/^./, (c) => c.toUpperCase())}.`;
  return /^\s*[-*+]\s/.test(prefix) ? `${first}\n${prefix}${second}` : `${first}\n\n${second}`;
}

/** A file of the estate with at least three planted rules, seeded, and the rule texts in their order there. */
function richFile(
  rendered: Rendered,
  planted: ReadonlyMap<string, RecordedAtom[]>,
  seed: number,
): { path: string; rules: string[] } {
  const files = [...planted]
    .filter(([, atoms]) => atoms.length >= 3)
    .map(([path]) => path)
    .sort();
  if (files.length === 0) throw new Error('no file holds three planted rules');
  const path = files[seed % files.length] as string;
  const text = rendered.files[path] ?? '';
  const rules = (planted.get(path) ?? []).map((atom) => atom.quote).filter((quote) => text.includes(quote));
  return { path, rules };
}

function ledgerDiffFamily(): Family {
  const family = 'ledger-diff';
  return {
    id: family,
    level: LEVEL,
    component: RADIUS,
    items: itemsOf(family, LEVEL, RADIUS, DIFF_SPECS),
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      const set = (key: string, result: ItemResult) => out.set(`${family}.${key}`, result);
      const rendered = renderEstate(drawEstate(seed));
      const planted = plantedProse(rendered);
      const proseFiles = Object.keys(rendered.recording.answers).sort();
      const ledgerOf = (files: Readonly<Record<string, string>>, previous?: pointer.Ledger) =>
        pointer.nextLedger(
          Object.keys(files)
            .filter((path) => proseFiles.includes(path) || !(path in rendered.files))
            .sort()
            .map((path) => ({ path, cut: pointer.cut(files[path] ?? '') })),
          previous,
          'estate',
        ).ledger;
      const before = ledgerOf(rendered.files);
      const { path, rules } = richFile(rendered, planted, seed);
      const [a, b, c] = rules as [string, string, string];
      const other = proseFiles.find((each) => each !== path) as string;
      const idOfText = (ledger: pointer.Ledger, text: string, at = path) =>
        ledger.entries.find(
          (entry) => entry.status === 'live' && entry.path === at && entry.quote.includes(text.slice(0, 40)),
        )?.id;
      const edits: Record<string, Readonly<Record<string, string>>> = {
        unchanged: rendered.files,
        changed: {
          ...rendered.files,
          [path]: (rendered.files[path] ?? '').replace(b, b.replace(/\.$/, ' today.')),
        },
        deleted: { ...rendered.files, [path]: (rendered.files[path] ?? '').replace(b, '') },
        moved: (() => {
          // The whole line moves, so the unit keeps its text: the bullet and any lead-in go with it.
          const text = rendered.files[path] ?? '';
          const lineStart = text.lastIndexOf('\n', text.indexOf(b)) + 1;
          const lineEnd = text.indexOf('\n', text.indexOf(b));
          const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
          return {
            ...rendered.files,
            [path]: `${text.slice(0, lineStart)}${text.slice(lineEnd < 0 ? text.length : lineEnd + 1)}`,
            [other]: `${rendered.files[other] ?? ''}\n${line}\n`,
          };
        })(),
        new: {
          ...rendered.files,
          [path]: (rendered.files[path] ?? '').replace(
            b,
            `${b}\n\nAlways write the date of the change in the reply.`,
          ),
        },
        split: {
          ...rendered.files,
          [path]: (rendered.files[path] ?? '').replace(b, splitInFile(rendered.files[path] ?? '', b)),
        },
        merged: {
          ...rendered.files,
          [path]: (rendered.files[path] ?? '')
            .replace(`${a}\n`, `${a.replace(/\.$/, '')} and ${c.charAt(0).toLowerCase()}${c.slice(1)}\n`)
            .replace(`${c}\n`, ''),
        },
        'heading-renamed': (() => {
          const withHeading =
            proseFiles.find((each) => each === path && /^#{1,3} \S/m.test(rendered.files[each] ?? '')) ??
            proseFiles.find((each) => /^#{1,3} \S/m.test(rendered.files[each] ?? ''));
          if (!withHeading) throw new Error('no prose file of the estate has a heading');
          return {
            ...rendered.files,
            [withHeading]: (rendered.files[withHeading] ?? '').replace(/^(#{1,3} )(.+)$/m, '$1$2 (revised)'),
          };
        })(),
      };
      const bId = idOfText(before, b);
      const aId = idOfText(before, a);
      const cId = idOfText(before, c);
      for (const edit of EDITS) {
        const files = edits[edit.id] as Readonly<Record<string, string>>;
        const after = ledgerOf(files, before);
        const changes = pointer.ledgerChanges(before, after);
        const byId = new Map(changes.map((change) => [change.id, change]));
        const notUnchanged = changes.filter((change) => change.class !== 'unchanged');
        let classOk: ItemResult;
        switch (edit.expect) {
          case 'none':
            classOk = check(
              notUnchanged.length === 0,
              `${notUnchanged.length} units not unchanged with no edit`,
            );
            break;
          case 'changed':
          case 'deleted':
          case 'moved':
            classOk = check(
              byId.get(bId ?? '')?.class === edit.expect,
              `the edited unit ${bId} is ${byId.get(bId ?? '')?.class}`,
            );
            break;
          case 'new': {
            const fresh = changes.filter((change) => change.class === 'new');
            classOk = check(
              fresh.length === 1 && byId.get(bId ?? '')?.class !== 'changed',
              `${fresh.length} new units, the unit beside it is ${byId.get(bId ?? '')?.class}`,
            );
            break;
          }
          case 'split': {
            const fresh = changes.filter((change) => change.class === 'new');
            classOk = check(
              byId.get(bId ?? '')?.class === 'changed' && fresh.length === 1,
              `the split unit is ${byId.get(bId ?? '')?.class} with ${fresh.length} new units`,
            );
            break;
          }
          case 'merged':
            classOk = check(
              byId.get(aId ?? '')?.class === 'changed' && byId.get(cId ?? '')?.class === 'deleted',
              `the merged units are ${byId.get(aId ?? '')?.class} and ${byId.get(cId ?? '')?.class}`,
            );
            break;
          case 'context': {
            const ctx = changes.filter((change) => change.class === 'context');
            // The heading is a unit of its own: its text changed. Every other unit keeps its text.
            const wrong = changes.filter(
              (change) =>
                change.class !== 'context' &&
                change.class !== 'unchanged' &&
                !(change.class === 'changed' && change.quote.includes('(revised)')),
            );
            classOk = check(
              ctx.length >= 1 && wrong.length === 0,
              `${ctx.length} context units, ${wrong.length} in another class`,
            );
            break;
          }
        }
        set(`class.${edit.id}`, classOk);
        const rerun = pointer.rerunOf(changes, before);
        let rerunOk: ItemResult;
        const expectedUnits = new Set<string>();
        const expectedAdvisory = new Set<string>();
        for (const change of changes) {
          const rule = DOC_RERUN[change.class];
          if (rule === 'unit') expectedUnits.add(change.id);
          if (rule === 'advisory') expectedAdvisory.add(change.id);
          if (rule === 'section') {
            const inFile = before.entries.filter(
              (entry) => entry.status === 'live' && entry.path === change.path,
            );
            for (let depth = change.sectionPath.length; depth >= 0; depth--) {
              const heading = change.sectionPath.slice(0, depth).join('\u0000');
              const siblings = inFile.filter(
                (entry) => entry.sectionPath.slice(0, depth).join('\u0000') === heading,
              );
              if (siblings.length === 0) continue;
              for (const entry of siblings) expectedUnits.add(entry.id);
              break;
            }
          }
        }
        const got = [...rerun.units.keys()].sort().join(',');
        const gotAdvisory = [...rerun.advisory.keys()].sort().join(',');
        rerunOk = check(
          rerun.whole === null &&
            got === [...expectedUnits].sort().join(',') &&
            gotAdvisory === [...expectedAdvisory].sort().join(','),
          `rerun ${rerun.units.size} units and ${rerun.advisory.size} advisory (whole: ${rerun.whole}), expected ${expectedUnits.size} and ${expectedAdvisory.size}`,
        );
        set(`rerun.${edit.id}`, rerunOk);
        if (edit.id === 'changed' && bId) {
          const manifest = pointer.ledgerChangeManifest(rerun, {
            from: 'v1',
            to: 'v2',
            atomsByUnit: new Map([[bId, ['rule:planted']]]),
          });
          set(
            'manifest.changed-atom',
            check(
              manifest.changes.some((change) => change.kind === 'prompt' && change.id === 'rule:planted'),
              `the manifest is ${JSON.stringify(manifest.changes).slice(0, 160)}`,
            ),
          );
          const bare = pointer.ledgerChangeManifest(rerun, { from: 'v1', to: 'v2' });
          set(
            'manifest.unit-without-atom',
            check(
              bare.changes.some((change) => change.kind === 'unit' && change.id === bId),
              `the manifest is ${JSON.stringify(bare.changes).slice(0, 160)}`,
            ),
          );
        }
        if (edit.id === 'unchanged') {
          const manifest = pointer.ledgerChangeManifest(rerun, { from: 'v1', to: 'v2' });
          set(
            'manifest.unchanged-empty',
            check(manifest.changes.length === 0, `${manifest.changes.length} changes with no edit`),
          );
        }
      }
      // A unit in a file the ledger never held.
      const newFile: Record<string, string> = {
        ...rendered.files,
        'notes/new-guide.md': 'Always cite the ticket number in the reply.\n',
      };
      const afterNew = pointer.nextLedger(
        [...proseFiles, 'notes/new-guide.md']
          .sort()
          .map((each) => ({ path: each, cut: pointer.cut(newFile[each] ?? '') })),
        before,
        'estate',
      ).ledger;
      const rerunNew = pointer.rerunOf(pointer.ledgerChanges(before, afterNew), before);
      const manifestNew = pointer.ledgerChangeManifest(rerunNew, { from: 'v1', to: 'v2' });
      set(
        'manifest.new-file',
        check(
          manifestNew.changes.some((change) => change.kind === 'prompt' && change.global === true),
          `the manifest is ${JSON.stringify(manifestNew.changes).slice(0, 160)}`,
        ),
      );
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// ledger-scale

const SCALE_STAGES = ['cut', 'ledger', 'scan', 'diff', 'replay'] as const;
const SCALE_BUDGET: Readonly<Record<(typeof SCALE_STAGES)[number], number>> = {
  cut: BUDGET_PER_ATOM.impact ?? 1,
  ledger: BUDGET_PER_ATOM.impact ?? 1,
  scan: BUDGET_PER_ATOM.scan ?? 3,
  diff: BUDGET_PER_ATOM.impact ?? 1,
  replay: BUDGET_PER_ATOM.scan ?? 3,
};
const scaleBudget = (stage: (typeof SCALE_STAGES)[number], size: number) =>
  Math.max(BUDGET_FLOOR_MS, SCALE_BUDGET[stage] * size);

const SCALE_SPECS: ItemSpec[] = SIZES.flatMap((size) =>
  SCALE_STAGES.map((stage) => ({
    key: `${stage}.${size}`,
    tier: (size <= 250 ? 2 : size <= 1000 ? 3 : size <= 2500 ? 4 : 5) as Tier,
    title: `the ${stage} stage of the pointer reader on an estate of ${size} atoms runs within ${scaleBudget(stage, size)} ms, its result right`,
    cause: `ledger-scale:${stage}-linear`,
    component:
      stage === 'cut' ? POINTER_CUT : stage === 'diff' ? RADIUS : stage === 'ledger' ? LEDGER : POINTER_SCAN,
  })),
);

function ledgerScaleFamily(): Family {
  const family = 'ledger-scale';
  return {
    id: family,
    level: LEVEL,
    component: POINTER_SCAN,
    items: itemsOf(family, LEVEL, POINTER_SCAN, SCALE_SPECS),
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      for (const size of SIZES) {
        const { files } = scaleEstate(size, seed);
        const prose = Object.keys(files)
          .filter((path) => path.endsWith('.md'))
          .sort();
        const timed = <T>(run: () => T): { value: T; ms: number } => {
          const started = performance.now();
          const value = run();
          return { value, ms: performance.now() - started };
        };
        const cuts = timed(() => prose.map((path) => ({ path, cut: pointer.cut(files[path] ?? '') })));
        const unitCount = cuts.value.reduce((sum, file) => sum + file.cut.units.length, 0);
        const sliced = cuts.value.every((file) =>
          file.cut.units.every((unit) => (files[file.path] ?? '').slice(unit.start, unit.end) === unit.text),
        );
        out.set(
          `${family}.cut.${size}`,
          check(
            cuts.ms <= scaleBudget('cut', size) && sliced && unitCount > 0,
            `cut ${unitCount} units in ${Math.round(cuts.ms)} ms (budget ${scaleBudget('cut', size)}), slices exact: ${sliced}`,
          ),
        );
        const ledger = timed(() => pointer.nextLedger(cuts.value, undefined, 'estate'));
        const live = ledger.value.ledger.entries.filter((entry) => entry.status === 'live').length;
        out.set(
          `${family}.ledger.${size}`,
          check(
            ledger.ms <= scaleBudget('ledger', size) && live === unitCount,
            `ledger of ${live} of ${unitCount} units in ${Math.round(ledger.ms)} ms (budget ${scaleBudget('ledger', size)})`,
          ),
        );
        // The pointer scan through the port, with a labeler that calls every unit a description.
        const log: string[] = [];
        const labeler = truthLabeler(new Map(), log);
        const cassette = new pointer.Cassette();
        const scanStarted = performance.now();
        const scanned = await pointer.pointerScan({
          files: prose.map((path) => ({ path, text: files[path] ?? '' })),
          sets: agentRules(),
          labelling: pointer.singleLabelling(labeler),
          cassette,
          mode: 'record',
        });
        const scanMs = performance.now() - scanStarted;
        out.set(
          `${family}.scan.${size}`,
          check(
            scanMs <= scaleBudget('scan', size) && scanned.failed.length === 0 && scanned.unlabeled === 0,
            `scan in ${Math.round(scanMs)} ms (budget ${scaleBudget('scan', size)}), ${scanned.failed.length} failed windows, ${scanned.unlabeled} unlabeled`,
          ),
        );
        // One edit, then the diff and the rerun set.
        const first = prose[0] as string;
        const editedText = (files[first] ?? '').replace(/\.\n/, ' now.\n');
        const editedCuts = cuts.value.map((file) =>
          file.path === first ? { path: first, cut: pointer.cut(editedText) } : file,
        );
        const diff = timed(() => {
          const after = pointer.nextLedger(editedCuts, ledger.value.ledger, 'estate').ledger;
          const changes = pointer.ledgerChanges(ledger.value.ledger, after);
          return { changes, rerun: pointer.rerunOf(changes, ledger.value.ledger) };
        });
        const changed = diff.value.changes.filter((change) => change.class === 'changed').length;
        out.set(
          `${family}.diff.${size}`,
          check(
            diff.ms <= scaleBudget('diff', size) && changed === 1,
            `diff in ${Math.round(diff.ms)} ms (budget ${scaleBudget('diff', size)}), ${changed} changed units (expected 1)`,
          ),
        );
        const replayStarted = performance.now();
        const replayed = await pointer.pointerScan({
          files: prose.map((path) => ({ path, text: files[path] ?? '' })),
          sets: agentRules(),
          labelling: pointer.singleLabelling({ ...labeler, call: undefined }),
          cassette: pointer.Cassette.parse(cassette.render()),
          mode: 'replay',
        });
        const replayMs = performance.now() - replayStarted;
        out.set(
          `${family}.replay.${size}`,
          check(
            replayMs <= scaleBudget('replay', size) &&
              replayed.calls === 0 &&
              pointer.renderLedger(replayed.ledger) === pointer.renderLedger(scanned.ledger),
            `replay in ${Math.round(replayMs)} ms (budget ${scaleBudget('replay', size)}), ${replayed.calls} calls`,
          ),
        );
      }
      return out;
    },
  };
}

/** The families of the ledger level. */
export function ledgerFamilies(): Family[] {
  return [ledgerScanFamily(), ledgerDiffFamily(), ledgerScaleFamily()];
}
