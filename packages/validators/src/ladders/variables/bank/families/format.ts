import type { FileBoundary, FileConstraint, FileStore, FileVariable } from '../../interface';
import { OWNER_DATE } from '../constants';
import {
  type FileCase,
  type FileCaseBuilder,
  fictionalStore,
  runFileCases,
  scenes,
  type Want,
  word,
} from '../files';
import type { StemRun } from '../item';
import type { Rng } from '../util';

/**
 * The stems that ask `validate` and `quotes` about a store FILE (docs/variables.md "The file" to "Loading,
 * checking and converting"). Each scene writes a fictional store, then the same store with exactly one defect,
 * so a refusal that names a code and a path at the right place is the only way to pass; an implementation that
 * accepts everything, refuses everything, or answers by the position or the hash of a call fails.
 */

const SCENES = 12;
const HEX = '0123456789abcdef';
const LEDGER = 'abcdefghijklmnopqrstuvwxyz234567';

const accept = (store: unknown): FileCase => ({
  op: 'validate',
  store: structuredClone(store),
  want: { kind: 'accept' },
});
const refuse = (store: unknown, code: string, paths: string[], codeFamily = false): FileCase => ({
  op: 'validate',
  store: structuredClone(store),
  want: { kind: 'reject', code, paths, ...(codeFamily ? { codeFamily } : {}) } as Want,
});

function withoutLedger<T extends { ledger?: string }>(entry: T): Omit<T, 'ledger'> {
  const { ledger: _ledger, ...rest } = entry;
  return rest;
}

function hex(rng: Rng, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += HEX[rng.int(0, 15)];
  return out;
}

function ledger(rng: Rng): string {
  let out = '';
  for (let i = 0; i < 10; i += 1) out += LEDGER[rng.int(0, LEDGER.length - 1)];
  return out;
}

const at = (store: FileStore, i: number): FileVariable => store.variables[i] as FileVariable;
const firstConstraint = (store: FileStore): FileConstraint =>
  (store.constraints as FileConstraint[])[0] as FileConstraint;
const firstBoundary = (store: FileStore, v: number): FileBoundary =>
  (at(store, v).boundaries as FileBoundary[])[0] as FileBoundary;

// ------------------------------------------------------------------------------------------------ provenance shape

const UNREAL_DAYS = ['2026-02-30', '2025-02-29', '2026-04-31', '2026-09-31', '2027-02-29'];

const provenanceShape: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, scene) => {
    const { store } = fictionalStore(rng, scene);
    const v = scene % store.variables.length;
    const entryPath = `variables.${v}.values.0.provenance.1`;
    const conversations = () => ({
      kind: 'conversations' as const,
      count: 2,
      total: 5,
      set_hash: hex(rng, 64),
    });
    const owner = () => ({
      kind: 'owner' as const,
      words: `Fictional ruling ${word(rng, 5)}`,
      date: OWNER_DATE,
    });
    const quote = () => ({
      kind: 'quote' as const,
      path: `fiction/${word(rng, 4)}.md`,
      quote: `Fictional sentence ${word(rng, 5)}.`,
      ledger: ledger(rng),
    });
    const withEntry = (entry: unknown): FileStore => {
      const copy = structuredClone(store);
      (at(copy, v).values[0] as { provenance: unknown[] }).provenance.push(entry);
      return copy;
    };
    const total = rng.int(3, 9);
    switch (variant) {
      case 'count-over-total': {
        const bad = { ...conversations(), count: total + rng.int(1, 4), total };
        const edge = { ...conversations(), count: total, total };
        return [
          accept(withEntry(edge)),
          accept(withEntry(conversations())),
          refuse(withEntry(bad), 'SCHEMA_CUSTOM', [`${entryPath}.count`, entryPath]),
        ];
      }
      case 'fractional-count': {
        const bad = { ...conversations(), count: 1.5 + rng.int(0, 2) };
        return [
          accept(withEntry({ ...conversations(), count: 0 })),
          accept(withEntry(conversations())),
          refuse(withEntry(bad), 'SCHEMA_INVALID_TYPE', [`${entryPath}.count`]),
        ];
      }
      case 'extra-key': {
        const bad = {
          ...conversations(),
          text: `Fictional transcript ${word(rng, 6)} that must never enter a store.`,
        };
        return [
          accept(withEntry(conversations())),
          accept(withEntry(owner())),
          refuse(withEntry(bad), 'SCHEMA_UNRECOGNIZED_KEYS', [entryPath]),
        ];
      }
      case 'uppercase-hash': {
        const bad = { ...conversations(), set_hash: hex(rng, 64).toUpperCase() };
        // A hash that has a digit only is also uppercase-safe: make one letter certain.
        bad.set_hash = `A${bad.set_hash.slice(1)}`;
        return [
          accept(withEntry(conversations())),
          accept(withEntry(owner())),
          refuse(withEntry(bad), 'SCHEMA_INVALID_FORMAT', [`${entryPath}.set_hash`]),
        ];
      }
      case 'zero-total': {
        const bad = { ...conversations(), count: 0, total: 0 };
        return [
          accept(withEntry({ ...conversations(), count: 0, total: 1 })),
          accept(withEntry(conversations())),
          refuse(withEntry(bad), 'SCHEMA_TOO_SMALL', [`${entryPath}.total`]),
        ];
      }
      case 'unreal-day': {
        const bad = { ...owner(), date: UNREAL_DAYS[scene % UNREAL_DAYS.length] as string };
        return [
          accept(withEntry({ ...owner(), date: '2028-02-29' })),
          accept(withEntry(owner())),
          refuse(withEntry(bad), 'SCHEMA_INVALID_FORMAT', [`${entryPath}.date`, entryPath]),
        ];
      }
      case 'blank-words': {
        const bad = { ...owner(), words: ' '.repeat(rng.int(1, 4)) };
        return [
          accept(withEntry({ ...owner(), words: ' x ' })),
          accept(withEntry(owner())),
          refuse(withEntry(bad), 'SCHEMA_CUSTOM', [`${entryPath}.words`, entryPath]),
        ];
      }
      default: {
        // ledger-shape: capitals, a wrong length, or a digit outside 2 to 7.
        const good = quote();
        const wrong = [good.ledger.toUpperCase(), good.ledger.slice(0, 9), `1${good.ledger.slice(1)}`][
          scene % 3
        ] as string;
        return [
          accept(withEntry(good)),
          accept(withEntry(withoutLedger(good))),
          refuse(withEntry({ ...good, ledger: wrong }), 'SCHEMA_INVALID_FORMAT', [`${entryPath}.ledger`]),
        ];
      }
    }
  });

// ------------------------------------------------------------------------------------------------ references

const references: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, scene) => {
    const { store } = fictionalStore(rng, scene);
    const a = at(store, 0);
    const b = at(store, 1);
    const copy = () => structuredClone(store);
    const noConstraints = (s: FileStore): FileStore => {
      s.constraints = [];
      return s;
    };
    switch (variant) {
      case 'duplicate-value': {
        const bad = copy();
        (at(bad, 0).values[1] as { id: string }).id = (a.values[0] as { id: string }).id;
        return [
          accept(store),
          refuse(noConstraints(bad), 'VARIABLES_DUPLICATE', ['variables.0.values.1.id']),
        ];
      }
      case 'duplicate-variable-id': {
        const bad = noConstraints(copy());
        at(bad, 1).id = a.id;
        return [accept(store), refuse(bad, 'VARIABLES_DUPLICATE', ['variables.1.id'])];
      }
      case 'ambiguous-axis-value': {
        // The page refuses a value id in two axes of one kind (docs/variables.md, Variables): both axes get the same
        // kind, one that a spec names by value (never a kind of which an agent has one axis).
        const bad = noConstraints(copy());
        at(bad, 1).kind = a.kind;
        (at(bad, 1).values[0] as { id: string }).id = (a.values[0] as { id: string }).id;
        const asDetail = noConstraints(copy());
        at(asDetail, 1).kind = a.kind;
        at(asDetail, 1).role = 'detail';
        (at(asDetail, 1).values[0] as { id: string }).id = (a.values[0] as { id: string }).id;
        const none = noConstraints(copy());
        (at(none, 0).values[0] as { id: string }).id = 'none';
        (at(none, 1).values[0] as { id: string }).id = 'none';
        return [
          accept(asDetail),
          accept(none),
          refuse(bad, 'VARIABLES_AMBIGUOUS_VALUE', ['variables.1.values.0.id']),
        ];
      }
      case 'repeated-channel':
      case 'repeated-stage': {
        const kind = variant === 'repeated-channel' ? 'channel' : 'stage';
        const bad = noConstraints(copy());
        at(bad, 0).kind = kind;
        at(bad, 0).role = 'axis';
        at(bad, 1).kind = kind;
        at(bad, 1).role = 'axis';
        const detail = noConstraints(copy());
        at(detail, 0).kind = kind;
        at(detail, 0).role = 'axis';
        at(detail, 1).kind = kind;
        at(detail, 1).role = 'detail';
        return [accept(detail), refuse(bad, 'VARIABLES_KIND_REPEATED', ['variables.1.kind'])];
      }
      case 'repeated-deviation': {
        const make = (secondRole: 'axis' | 'detail') => {
          const s = noConstraints(copy());
          for (const [i, role] of [
            [0, 'axis'],
            [1, secondRole],
          ] as const) {
            const variable = at(s, i);
            variable.kind = 'deviation';
            variable.role = role;
            variable.values = [{ id: 'none', title: 'No deviation' }];
          }
          return s;
        };
        return [
          accept(make('detail')),
          refuse(make('axis'), 'VARIABLES_KIND_REPEATED', ['variables.1.kind']),
        ];
      }
      case 'unknown-deviation-class': {
        const make = (id: string) => {
          const s = noConstraints(copy());
          const variable = at(s, 0);
          variable.kind = 'deviation';
          variable.role = 'axis';
          variable.values = [
            { id: 'none', title: 'No deviation' },
            { id, title: 'A deviation' },
          ];
          return s;
        };
        const known = ['D1_off_topic', 'D3_contradiction', 'D6_instruction_in_data', 'D12_prompt_extraction'][
          scene % 4
        ] as string;
        const unknown = ['off_topic', 'D13_made_up', 'D1', `d1_off_topic`][scene % 4] as string;
        return [
          accept(make(known)),
          refuse(make(unknown), 'VARIABLES_UNKNOWN_DEVIATION', ['variables.0.values.1.id']),
        ];
      }
      case 'unknown-when-variable': {
        const good = copy();
        (at(good, 0).values[0] as { when?: Record<string, string[]> }).when = {
          [b.id]: [(b.values[0] as { id: string }).id],
        };
        const bad = copy();
        (at(bad, 0).values[0] as { when?: Record<string, string[]> }).when = {
          [`ghost_${word(rng, 4)}`]: [(b.values[0] as { id: string }).id],
        };
        const ghost = Object.keys(
          (at(bad, 0).values[0] as { when: Record<string, string[]> }).when,
        )[0] as string;
        return [
          accept(good),
          refuse(bad, 'VARIABLES_UNKNOWN_VARIABLE', [`variables.0.values.0.when.${ghost}`]),
        ];
      }
      case 'unknown-unless-value': {
        const good = copy();
        (at(good, 0).values[1] as { unless?: Record<string, string[]> }).unless = {
          [b.id]: [(b.values[1] as { id: string }).id],
        };
        const bad = copy();
        (at(bad, 0).values[1] as { unless?: Record<string, string[]> }).unless = {
          [b.id]: [`ghost_${word(rng, 4)}`],
        };
        return [
          accept(good),
          refuse(bad, 'VARIABLES_UNKNOWN_VALUE', [`variables.0.values.1.unless.${b.id}.0`]),
        ];
      }
      case 'unknown-constraint-variable': {
        const ghost = `ghost_${word(rng, 4)}`;
        const bad = copy();
        firstConstraint(bad).forbid = {
          [ghost]: 'x',
          [b.id]: (b.values[0] as { id: string }).id,
        };
        return [accept(store), refuse(bad, 'VARIABLES_UNKNOWN_VARIABLE', [`constraints.0.forbid.${ghost}`])];
      }
      case 'unknown-constraint-value': {
        const bad = copy();
        firstConstraint(bad).forbid = {
          [a.id]: `ghost_${word(rng, 4)}`,
          [b.id]: (b.values[0] as { id: string }).id,
        };
        return [accept(store), refuse(bad, 'VARIABLES_UNKNOWN_VALUE', [`constraints.0.forbid.${a.id}`])];
      }
      case 'empty-constraint': {
        const bad = copy();
        firstConstraint(bad).forbid = {};
        return [accept(store), refuse(bad, 'VARIABLES_EMPTY_CONSTRAINT', ['constraints.0.forbid'])];
      }
      case 'duplicate-constraint-reordered': {
        const bad = copy();
        const first = firstConstraint(bad).forbid;
        const reversed = Object.fromEntries(Object.entries(first).reverse());
        bad.constraints?.push({
          forbid: reversed,
          reason: `Fictional repeat ${word(rng, 4)}`,
          approved: true,
        });
        const different = copy();
        different.constraints?.push({
          forbid: { [a.id]: (a.values[1] as { id: string }).id, [b.id]: (b.values[0] as { id: string }).id },
          reason: `Fictional second exclusion ${word(rng, 4)}`,
          approved: true,
        });
        return [accept(different), refuse(bad, 'VARIABLES_DUPLICATE', ['constraints.1'])];
      }
      default: {
        // grid-empty: single-value constraints that forbid every value of the first axis.
        const bad = copy();
        bad.constraints = a.values.map((value, i) => ({
          forbid: { [a.id]: value.id },
          reason: `Fictional closure ${i} ${word(rng, 4)}`,
          approved: true,
        }));
        const almost = copy();
        almost.constraints = a.values.slice(0, -1).map((value, i) => ({
          forbid: { [a.id]: value.id },
          reason: `Fictional partial closure ${i} ${word(rng, 4)}`,
          approved: true,
        }));
        return [accept(almost), refuse(bad, 'VARIABLES_GRID_EMPTY', ['constraints'])];
      }
    }
  });

// ------------------------------------------------------------------------------------------------ boundaries

const sides: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, scene) => {
    const { store } = fictionalStore(rng, scene);
    store.constraints = [];
    const target = at(store, scene % store.variables.length);
    const [holds, fails] = [target.values[0], target.values[1]] as [{ id: string }, { id: string }];
    const edgeValue = { id: `edge_${word(rng, 4)}`, title: 'Exactly at the limit' };
    target.values.push(edgeValue);
    const comparison = (
      variant === 'strict-gt'
        ? 'gt'
        : variant === 'strict-lt'
          ? 'lt'
          : variant === 'inclusive-ge'
            ? 'ge'
            : variant === 'inclusive-le'
              ? 'le'
              : (['gt', 'lt', 'ge', 'le'] as const)[scene % 4]
    ) as 'gt' | 'lt' | 'ge' | 'le';
    const inclusive = comparison === 'ge' || comparison === 'le';
    const limit = [0, -3, rng.int(1, 40), 2.5, -0.5][scene % 5] as number;
    const boundary = (edge: string, extra: Partial<FileBoundary> = {}): FileStore => {
      const copy = structuredClone(store);
      at(copy, store.variables.indexOf(target)).boundaries = [
        { holds: holds.id, fails: fails.id, edge, limit, comparison, unit: 'fictional units', ...extra },
      ];
      return copy;
    };
    const path = `variables.${store.variables.indexOf(target)}.boundaries.0`;
    switch (variant) {
      case 'strict-gt':
      case 'strict-lt':
        return [
          accept(boundary(edgeValue.id)),
          accept(boundary(fails.id)),
          refuse(boundary(holds.id), 'VARIABLES_BOUNDARY', [`${path}.edge`]),
        ];
      case 'inclusive-ge':
      case 'inclusive-le':
        return [
          accept(boundary(edgeValue.id)),
          accept(boundary(holds.id)),
          refuse(boundary(fails.id), 'VARIABLES_BOUNDARY', [`${path}.edge`]),
        ];
      case 'same-value-both-sides':
        return [
          accept(boundary(edgeValue.id)),
          refuse(boundary(edgeValue.id, { fails: holds.id }), 'VARIABLES_BOUNDARY', [`${path}.fails`]),
        ];
      case 'unknown-edge':
        return [
          accept(boundary(edgeValue.id)),
          refuse(boundary(`ghost_${word(rng, 4)}`), 'VARIABLES_UNKNOWN_VALUE', [`${path}.edge`]),
        ];
      case 'unknown-holds':
        return [
          accept(boundary(edgeValue.id)),
          refuse(boundary(edgeValue.id, { holds: `ghost_${word(rng, 4)}` }), 'VARIABLES_UNKNOWN_VALUE', [
            `${path}.holds`,
          ]),
        ];
      default: {
        // limit-without-comparison: a limit and a comparison go together.
        const noComparison = boundary(inclusive ? holds.id : fails.id);
        const edgeOnly = boundary(edgeValue.id);
        const index = store.variables.indexOf(target);
        delete firstBoundary(noComparison, index).comparison;
        const noLimit = boundary(edgeValue.id);
        const bare = firstBoundary(noLimit, index);
        delete bare.limit;
        delete bare.unit;
        delete bare.comparison;
        return [
          accept(edgeOnly),
          accept(noLimit),
          refuse(noComparison, 'SCHEMA_CUSTOM', [path, `${path}.comparison`, `${path}.limit`]),
        ];
      }
    }
  });

// ------------------------------------------------------------------------------------------------ weights

const validity: FileCaseBuilder = (variant, ctx) =>
  scenes(ctx, SCENES, variant, (rng, scene) => {
    const { store } = fictionalStore(rng, scene);
    store.constraints = [];
    const v = scene % store.variables.length;
    const target = at(store, v);
    target.values.forEach((value, i) => {
      value.weight = [60, 15, 25, 5][(i + scene) % 4] as number;
    });
    const copy = () => structuredClone(store);
    switch (variant) {
      case 'incomplete': {
        const bad = copy();
        const m = scene % target.values.length;
        delete (at(bad, v).values[m] as { weight?: number }).weight;
        const zeroOne = copy();
        (at(zeroOne, v).values[0] as { weight?: number }).weight = 0;
        return [
          accept(store),
          accept(zeroOne),
          refuse(bad, 'VARIABLES_WEIGHT_INCOMPLETE', [`variables.${v}.values.${m}.weight`]),
        ];
      }
      case 'all-zero': {
        const bad = copy();
        for (const value of at(bad, v).values) value.weight = 0;
        const oneZero = copy();
        (at(oneZero, v).values[0] as { weight?: number }).weight = 0;
        return [
          accept(store),
          accept(oneZero),
          refuse(bad, 'VARIABLES_WEIGHT_ZERO', [`variables.${v}.values`]),
        ];
      }
      case 'negative': {
        const bad = copy();
        const m = scene % target.values.length;
        (at(bad, v).values[m] as { weight?: number }).weight = -(rng.int(1, 9) / 10);
        return [accept(store), refuse(bad, 'SCHEMA_TOO_SMALL', [`variables.${v}.values.${m}.weight`])];
      }
      case 'nonfinite': {
        const bad = copy();
        const m = scene % target.values.length;
        (at(bad, v).values[m] as { weight?: number }).weight = [
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
        ][scene % 3] as number;
        return [accept(store), refuse(bad, 'SCHEMA_', [`variables.${v}.values.${m}.weight`], true)];
      }
      default: {
        // fitted-without-source: a fitted prior needs a source text.
        const fitted = copy();
        fitted.prior = { kind: 'fitted', source: `Fictional fit ${word(rng, 5)}` };
        const declared = copy();
        declared.prior = { kind: 'declared' };
        const bad = copy();
        bad.prior = { kind: 'fitted' };
        return [accept(fitted), accept(declared), refuse(bad, 'VARIABLES_PRIOR_SOURCE', ['prior.source'])];
      }
    }
  });

/** The cases of each file-format stem, by stem id: the check runs them, and the tests play cheats against them. */
export const FORMAT_CASES: Record<string, FileCaseBuilder> = {
  'sources.file.provenance-shape': provenanceShape,
  'values.file.references': references,
  'boundaries.file.sides': sides,
  'weights.file.validity': validity,
};

export const FORMAT_RUNS: Record<string, StemRun> = Object.fromEntries(
  Object.entries(FORMAT_CASES).map(([stem, build]) => [
    stem,
    (variant, ctx) => runFileCases(ctx, build(variant, ctx), `${stem}.${variant}`),
  ]),
);
