import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { readerGainedNothing } from '../../src/ladders/pointer/bank/harness-probe';
import { clearSeedFreeCache, executeHere, runItem, stopItemChild } from '../../src/ladders/pointer/bank/run';
import { fail, missing, type Outcome, type PointerItem, pass, Problem } from '../../src/ladders/pointer/bank/types';
import type {
  Diagnostic,
  PointerSut,
  ScanFailure,
  ScanRequest,
  ScanResult,
  SettingsApi,
  SettingsIssue,
} from '../../src/ladders/pointer/sut/port';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';

/**
 * PR 1136, review inventory of the remaining message dependencies: no item and no part of the harness decides
 * from the words of a message of the reader. Each check reads a code and the fields the reader gives beside the
 * words. For each class of converted item a reader of this file shows three things, all wrappers of the reference
 * reader: the right words with no code or field (the old items passed it, the new ones fail it), a wrong code or
 * a wrong field (fails the item), and the right code and fields (the item passes).
 */

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string): PointerItem => {
  const found = bank.find((x) => x.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

afterEach(async () => {
  await stopItemChild();
  clearSeedFreeCache();
  delete process.env.DRIFTBENCH_POINTER_SUT;
});

async function run(id: string, sut: PointerSut, seed = 1, children = REFERENCE_MODULE): Promise<Outcome> {
  process.env.DRIFTBENCH_POINTER_SUT = children;
  clearSeedFreeCache();
  return runItem(item(id), seed, sut);
}

/** A wrapper of the reference whose scan result is changed. */
const scanning = (
  name: string,
  change: (out: ScanResult, request: ScanRequest) => ScanResult,
): PointerSut => ({
  ...ref,
  name,
  scan: async (request) => change(await ref.scan(request), request),
});
const diagnostics = (name: string, change: (d: Diagnostic) => Diagnostic): PointerSut =>
  scanning(name, (out) => ({ ...out, diagnostics: out.diagnostics.map(change) }));

/** The words of a diagnostic and its class, none of its cause or fields. */
const wordsOnly = (d: Diagnostic): Diagnostic => ({ code: d.code, detail: d.detail });
/** The same diagnostic with another cause. */
const otherCause = (d: Diagnostic): Diagnostic => (d.reason === undefined ? d : { ...d, reason: 'another-cause' });

/* ----- the items that read the cause and the names of a diagnostic ----- */

type Reads = { id: string; reason: string; name?: 'units' | 'label' | 'span' | 'parent' | 'target' | 'unit' };
const READS: Reads[] = [
  { id: 'labels.refuse-descending-range-explicit', reason: 'units-malformed', name: 'units' },
  { id: 'labels.range-leaving-window-refused', reason: 'units-leave-window', name: 'units' },
  { id: 'labels.null-target-is-no-target', reason: 'target-required', name: 'label' },
  { id: 'labels.two-fences-no-answer', reason: 'answer-not-json' },
  { id: 'labels.span-text-twice-refused', reason: 'span-text-repeated', name: 'span' },
  { id: 'labels.adjacent-spans-do-not-overlap', reason: 'span-overlap', name: 'span' },
  { id: 'labels.nested-span-inside-parent', reason: 'span-outside-parent', name: 'parent' },
  { id: 'labels.span-text-case-fold-changes-length-refused', reason: 'span-text-absent', name: 'span' },
  { id: 'labels.link-kind-twice-refused', reason: 'link-kind-repeated', name: 'target' },
  { id: 'labels.link-unlisted-value-refused', reason: 'link-target-unlisted', name: 'target' },
  { id: 'labels.vector-sum-103-refused', reason: 'no-vector', name: 'unit' },
  { id: 'grouping.orphan-condition-refused', reason: 'condition-unattached', name: 'unit' },
  { id: 'grouping.template-placeholder-unfilled-refused', reason: 'template-unfilled', name: 'unit' },
];

describe('the items that read the cause of a refusal read its code and its names', () => {
  for (const read of READS) {
    it(`${read.id}: the right code and names pass on two seeds`, async () => {
      for (const seed of [1, 2]) expect(await run(read.id, ref, seed), `seed ${seed}`).toMatchObject({ pass: true });
    }, 120_000);

    it(`${read.id}: the right words with no code or field fail`, async () => {
      const words = diagnostics('words-only', (d) => (d.reason === read.reason ? wordsOnly(d) : d));
      expect((await run(read.id, words)).pass).toBe(false);
    }, 120_000);

    it(`${read.id}: another code fails`, async () => {
      const other = diagnostics('other-cause', (d) => (d.reason === read.reason ? otherCause(d) : d));
      expect((await run(read.id, other)).pass).toBe(false);
    }, 120_000);

    const name = read.name;
    if (name !== undefined)
      it(`${read.id}: another ${name} under the right code fails`, async () => {
        const wrong = diagnostics('other-name', (d) =>
          d.reason === read.reason ? ({ ...d, [name]: 'zz-wrong' } as Diagnostic) : d,
        );
        expect((await run(read.id, wrong)).pass).toBe(false);
      }, 120_000);
  }
});

/** A diagnostic that names a unit by id, with the fields of the reader: the unit, as a refusal of an atom. */
const accusing = (): PointerSut =>
  scanning('refuses-every-unit', (out) => ({
    ...out,
    diagnostics: [
      ...out.diagnostics,
      ...(out.ledger?.entries ?? []).map(
        (entry): Diagnostic => ({
          code: 'atom-refusal',
          reason: 'link-target-not-atom',
          unit: entry.id,
          detail: 'a refusal',
        }),
      ),
    ],
  }));

describe('the items that read that nothing names a unit read the fields that hold a unit id', () => {
  for (const id of ['grouping.none-link-builds-no-refusal', 'grouping.when-file-needs-a-file']) {
    it(`${id}: passes the reference and fails a reader that refuses the unit`, async () => {
      expect(await run(id, ref)).toMatchObject({ pass: true });
      expect((await run(id, accusing())).pass).toBe(false);
    }, 120_000);
  }
});

/* ----- the items that read the structured cause of a failed scan ----- */

const dropFailure = (name: string): PointerSut =>
  scanning(name, (out) => {
    const { failure: _failure, ...rest } = out;
    return rest;
  });
const changeFailure = (name: string, change: (failure: ScanFailure) => ScanFailure): PointerSut =>
  scanning(name, (out) => (out.failure ? { ...out, failure: change(out.failure) } : out));

describe('the items that read why a label file was refused read its code, reason, set and label', () => {
  const ITEMS = [
    'labels.set-validation-duplicate-set',
    'labels.set-validation-reserved-none',
    'labels.set-validation-duplicate-label',
    'labels.set-validation-label-identifier',
    'labels.set-validation-target-value',
    'labels.set-validation-errors',
  ];
  for (const id of ITEMS) {
    it(`${id}: the right failure passes; words with no failure, another code, another set and another label fail`, async () => {
      expect(await run(id, ref), 'reference').toMatchObject({ pass: true });
      expect((await run(id, dropFailure('no-failure'))).pass, 'no failure').toBe(false);
      expect((await run(id, changeFailure('code', (f) => ({ ...f, code: 'label-file-invalid' })))).pass, 'code').toBe(false);
      expect((await run(id, changeFailure('reason', (f) => ({ ...f, reason: 'invalid-file' })))).pass, 'reason').toBe(false);
      expect((await run(id, changeFailure('set', (f) => ({ ...f, set: 'zz-wrong' })))).pass, 'set').toBe(false);
    }, 120_000);
  }

  it('labels.set-validation-reserved-none fails another label under the right code', async () => {
    const out = await run('labels.set-validation-reserved-none', changeFailure('label', (f) => ({ ...f, label: 'zz' })));
    expect(out.pass).toBe(false);
  }, 120_000);

  /** The reference accepts a label with more than three examples; a reader that refuses it gives the failure. */
  const refusing = (failure: ScanFailure | undefined): PointerSut =>
    scanning('refuses-many-examples', (out, request) =>
      request.labelsYaml?.startsWith('labels:\n  - set: many')
        ? {
            ok: false,
            error: 'the label voice has more than three examples',
            ...(failure ? { failure } : {}),
            atoms: [],
            diagnostics: [],
          }
        : out,
    );
  const right: ScanFailure = {
    code: 'label-examples-too-many',
    reason: 'more-than-three-examples',
    set: 'many',
    label: 'voice',
  };

  it('labels.prompt-examples-max-three: the failure that names the set and the label passes', async () => {
    expect(await run('labels.prompt-examples-max-three', refusing(right))).toMatchObject({ pass: true });
  }, 120_000);

  it('labels.prompt-examples-max-three: words with no failure, another code and another label fail', async () => {
    const id = 'labels.prompt-examples-max-three';
    expect((await run(id, refusing(undefined))).pass, 'no failure').toBe(false);
    expect((await run(id, refusing({ ...right, code: 'label-file-invalid' }))).pass, 'code').toBe(false);
    expect((await run(id, refusing({ ...right, label: 'plain' }))).pass, 'label').toBe(false);
    expect((await run(id, refusing({ ...right, set: 'other' }))).pass, 'set').toBe(false);
  }, 120_000);

  it('ids.ledger-check-mode reads the files of the failure, not the words', async () => {
    const id = 'ids.ledger-check-mode';
    expect(await run(id, ref)).toMatchObject({ pass: true });
    expect((await run(id, dropFailure('no-failure'))).pass, 'no failure').toBe(false);
    expect((await run(id, changeFailure('no-files', (f) => ({ code: f.code })))).pass, 'no files').toBe(false);
    expect((await run(id, changeFailure('other-files', (f) => ({ ...f, files: ['zz/other.md'] })))).pass, 'files').toBe(false);
    expect((await run(id, changeFailure('other-code', (f) => ({ ...f, code: 'ledger-stale' })))).pass, 'code').toBe(false);
  }, 120_000);

  it('labels.system1-refuses-link-labels reads the code and the set of the failure', async () => {
    const id = 'labels.system1-refuses-link-labels';
    expect(await run(id, ref)).toMatchObject({ pass: true });
    expect((await run(id, dropFailure('no-failure'))).pass, 'no failure').toBe(false);
    expect((await run(id, changeFailure('other-set', (f) => ({ ...f, set: 'zz-wrong' })))).pass, 'set').toBe(false);
    expect((await run(id, changeFailure('other-code', (f) => ({ ...f, code: 'labeler-config' })))).pass, 'code').toBe(false);
  }, 120_000);
});

/* ----- the settings items ----- */

const settingsWith = (
  name: string,
  change: (issues: SettingsIssue[] | undefined) => SettingsIssue[] | undefined,
): PointerSut => {
  const real = ref.settings as SettingsApi;
  return {
    ...ref,
    name,
    settings: {
      async parse(text) {
        const out = await real.parse(text);
        if (out.ok) return out;
        const issues = change(out.issues);
        const { issues: _issues, ...rest } = out;
        return issues ? { ...rest, issues } : rest;
      },
    },
  };
};

describe('the settings items read the code, the key and the reason of an issue', () => {
  const ITEMS: Array<[string, string]> = [
    ['labels.settings-threshold-range-refused', 'threshold-out-of-range'],
    ['labels.settings-inherited-threshold-key-refused', 'threshold-unknown-key'],
    ['labels.settings-threshold-nan-refused', 'threshold-not-finite'],
  ];
  for (const [id, code] of ITEMS) {
    it(`${id}: the right issue passes; no issue, another code, another key and another reason fail`, async () => {
      expect(await run(id, ref), 'reference').toMatchObject({ pass: true });
      expect((await run(id, settingsWith('no-issues', () => undefined))).pass, 'no issues').toBe(false);
      const map = (change: (issue: SettingsIssue) => SettingsIssue) =>
        settingsWith('changed', (issues) => issues?.map((issue) => (issue.code === code ? change(issue) : issue)));
      expect((await run(id, map((i) => ({ ...i, code: 'settings-labels-invalid' })))).pass, 'code').toBe(false);
      expect((await run(id, map((i) => ({ ...i, key: 'zz-wrong' })))).pass, 'key').toBe(false);
      expect((await run(id, map((i) => ({ ...i, reason: 'shape' })))).pass, 'reason').toBe(false);
    }, 120_000);
  }
});

/* ----- the model-mismatch warning ----- */

describe('the items that read the model-mismatch warning read its record', () => {
  const ITEMS = ['privacy.warning-names-models-not-units', 'replay.model-mismatch-warns'];
  const withRecords = (
    name: string,
    change: (records: NonNullable<ScanResult['warningRecords']>) => ScanResult['warningRecords'],
  ) =>
    scanning(name, (out) => {
      const { warningRecords: records, ...rest } = out;
      const changed = records ? change(records) : undefined;
      return changed ? { ...rest, warningRecords: changed } : rest;
    });
  for (const id of ITEMS) {
    it(`${id}: the record passes; the words alone, swapped models and no record fail`, async () => {
      expect(await run(id, ref), 'reference').toMatchObject({ pass: true });
      expect((await run(id, withRecords('words-only', () => undefined))).pass, 'words only').toBe(false);
      expect((await run(id, withRecords('empty', () => []))).pass, 'empty').toBe(false);
      const swapped = withRecords('swapped', (records) =>
        records.map((r) => ({ ...r, recorded: r.returned, returned: r.recorded })),
      );
      expect((await run(id, swapped)).pass, 'swapped').toBe(false);
      const other = withRecords('other-model', (records) => records.map((r) => ({ ...r, returned: 'zz-model' })));
      expect((await run(id, other)).pass, 'other model').toBe(false);
    }, 120_000);
  }

  it('the real reader has no warning record: the item says so, as it does for a missing list', async () => {
    const id = 'replay.model-mismatch-warns';
    const bare = scanning('no-warnings-at-all', (out) => {
      const { warnings: _w, warningRecords: _r, ...rest } = out;
      return rest;
    });
    const out = await run(id, bare);
    expect(out.pass).toBe(false);
    expect(out.detail).toMatch(/returned-model warning missing/);
  }, 120_000);
});

/* ----- the Node and ICU versions of a cut digest miss ----- */

describe('the items that read the versions of a cut digest miss read its environment', () => {
  const IDS = ['replay.fixture-miss-names-cut-digest', 'replay.cut-digest-mismatch-names-versions'];
  const miss = (name: string, change: (environment: { node: string; icu: string } | undefined) => unknown) =>
    scanning(name, (out) => {
      if (!out.miss) return out;
      const { environment, ...rest } = out.miss;
      const changed = change(environment);
      return {
        ...out,
        miss: changed ? { ...rest, environment: changed as { node: string; icu: string } } : rest,
      };
    });
  for (const id of IDS) {
    it(`${id}: the environment passes; none, another Node and another ICU fail`, async () => {
      expect(await run(id, ref), 'reference').toMatchObject({ pass: true });
      expect((await run(id, miss('none', () => undefined))).pass, 'none').toBe(false);
      expect((await run(id, miss('node', (e) => e && { ...e, node: '0.0.1' }))).pass, 'node').toBe(false);
      expect((await run(id, miss('icu', (e) => e && { ...e, icu: '0.0.1' }))).pass, 'icu').toBe(false);
    }, 120_000);

    it(`${id}: a message that names both versions does not stand for the environment`, async () => {
      const words = scanning('versions-in-words', (out) => {
        if (!out.miss) return out;
        const { environment, ...rest } = out.miss;
        return {
          ...out,
          error: `${out.error ?? ''} Node ${environment?.node} ICU ${environment?.icu}`,
          miss: rest,
        };
      });
      expect((await run(id, words)).pass).toBe(false);
    }, 120_000);
  }
});

/* ----- the failure of a process the bank starts ----- */

const SUT = (mode: string) => fileURLToPath(new URL(`./cr2-codes-sut-${mode}.ts`, import.meta.url));

describe('the items that read the failure of a child process read its code and its class', () => {
  it('adversarial.yaml-alias-bomb: the error of the yaml package passes, words that mention yaml do not', async () => {
    const id = 'adversarial.yaml-alias-bomb';
    expect(await run(id, ref, 1, SUT('alias'))).toMatchObject({ pass: true });
    const words = await run(id, ref, 1, SUT('aliasWords'));
    expect(words.pass).toBe(false);
    expect(words.detail).toMatch(/not the alias limit/);
  }, 180_000);

  it('adversarial.yaml-alias-bomb: a reader that is not reachable is a crash, only with the code', async () => {
    const id = 'adversarial.yaml-alias-bomb';
    const coded = await run(id, ref, 1, SUT('coded'));
    expect(coded.pass).toBe(false);
    expect(coded.detail).toMatch(/did not survive/);
    const worded = await run(id, ref, 1, SUT('worded'));
    expect(worded.pass).toBe(false);
    expect(worded.detail).not.toMatch(/did not survive/);
  }, 180_000);

  it('privacy.secret-not-in-cassette: a reader that is not reachable stops the item, only with the code', async () => {
    const id = 'privacy.secret-not-in-cassette';
    const coded = await run(id, ref, 1, SUT('coded'));
    expect(coded.pass).toBe(false);
    expect(coded.detail).not.toMatch(/child run failed/);
    const worded = await run(id, ref, 1, SUT('worded'));
    expect(worded.pass).toBe(false);
    expect(worded.detail).toMatch(/child run failed/);
  }, 180_000);
});

/* ----- the harness ----- */

const synthetic = (result: () => Promise<Outcome>): PointerItem => ({
  id: 'harness.synthetic',
  family: 'harness',
  tier: 1,
  level: 1,
  component: 'harness',
  title: 'a synthetic item',
  cause: 'none',
  gen: 'none',
  oracle: 'the oracle of the synthetic item',
  needs: [],
  seedFree: false,
  run: result,
});

describe('the harness reads the kind of a failure, not its words', () => {
  const NOTE = 'Behaviour under test: the oracle of the synthetic item';

  it('a failure of the kind missing-observation names the behaviour under test, once', async () => {
    const out = await executeHere(synthetic(async () => missing('the reader offers nothing')), 1, ref);
    expect(out).toMatchObject({ pass: false, kind: 'missing-observation', annotated: true });
    expect(out.detail).toBe(`the reader offers nothing. ${NOTE}`);
    const again = await executeHere(
      synthetic(async () => ({ ...missing('already said'), annotated: true as const })),
      1,
      ref,
    );
    expect(again.detail).toBe('already said');
  });

  it('the words alone do not name the behaviour: a failure with the words of a missing observation and no kind', async () => {
    const out = await executeHere(synthetic(async () => fail('the reader does not expose an event')), 1, ref);
    expect(out.detail).toBe('the reader does not expose an event');
    expect(out.annotated).toBeUndefined();
  });

  it('a Problem carries its kind to the outcome', async () => {
    const kinded = await executeHere(
      synthetic(async () => {
        throw new Problem('the reader exports no rerun rule', 'missing-observation');
      }),
      1,
      ref,
    );
    expect(kinded).toMatchObject({ pass: false, kind: 'missing-observation', annotated: true });
    const worded = await executeHere(
      synthetic(async () => {
        throw new Problem('the reader exports no rerun rule');
      }),
      1,
      ref,
    );
    expect(worded.detail).toBe('the reader exports no rerun rule');
    expect(worded.kind).toBeUndefined();
  });

  it('a passing outcome is left as it is', async () => {
    const out = await executeHere(synthetic(async () => pass('fine')), 1, ref);
    expect(out).toEqual({ pass: true, detail: 'fine' });
  });

  it('readerGainedNothing reads the kind of the failure', () => {
    expect(readerGainedNothing(fail('x', 'control-failed'))).toBe(true);
    expect(readerGainedNothing(fail('x', 'reader-process-ended'))).toBe(true);
    expect(readerGainedNothing(fail('x', 'missing-observation'))).toBe(false);
    expect(readerGainedNothing(fail('x'))).toBe(false);
    expect(readerGainedNothing(pass('x'))).toBe(false);
  });

  it('the words of a control failure or of a process that ended prove nothing without the kind', () => {
    expect(readerGainedNothing(fail('control failed: no unit of the reader holds the sentence'))).toBe(false);
    expect(readerGainedNothing(fail("the item stopped the reader's process (exit code 3)"))).toBe(false);
  });
});
