import { type Obj, pointerExports, Unsupported } from './reader';

/** A label set of the bank (`name`, labels) as the reader's set (`set`, `description`, labels). */
const setOf = (set: Obj): Obj => ({
  set: String(set.name ?? set.set),
  description: String(set.description ?? set.name ?? set.set),
  labels: (set.labels as Obj[]).map((label) => ({
    description: String(label.description ?? label.name),
    ...label,
  })),
});

/** The units a label can point at, numbered as the caller numbered them; the position is the unit's index. */
function windowOf(window: Obj) {
  const units = (window.units as Obj[]).filter(
    (unit) => unit.contextOnly !== true && unit.opaque !== true && unit.read !== true,
  );
  return {
    id: String(window.id),
    path: '',
    headingPath: [] as string[],
    units: units.map((unit, index) => ({ n: Number(unit.n), text: String(unit.text), index })),
  };
}

export async function decideOp(input: Obj): Promise<unknown> {
  const pointer = await pointerExports();
  const set = setOf(input.set as Obj);
  const caller = windowOf(input.window as Obj);
  // The reader numbers the units of a window 1 to k in order, and a target is such a number. The caller's handles
  // are renamed to that numbering for the call and renamed back in the result.
  const toReader = new Map(caller.units.map((unit: { n: number }, at: number) => [unit.n, at + 1]));
  const window = {
    ...caller,
    units: caller.units.map((unit: { n: number; text: string; index: number }, at: number) => ({
      ...unit,
      n: at + 1,
    })),
  };
  const rename = (value: unknown): string => String(toReader.get(Number(value)) ?? value);
  const answer2 = {
    ...(input.system2 as Obj),
    labels: ((input.system2 as Obj).labels as Obj[]).map((entry) => ({
      ...entry,
      units: rename(entry.units),
      ...(entry.target === undefined ? {} : { target: toReader.get(Number(entry.target)) ?? entry.target }),
    })),
  };
  const probabilities = Object.fromEntries(
    Object.entries(input.probabilities as Obj).map(([key, p]) => [
      key.replace(/^u(\d+)__/, (_m, n: string) => `u${rename(n)}__`),
      p,
    ]),
  );
  const system1 = pointer.createOpenAiDecisionsLabeler({
    model: 'bank',
    threshold: Number(input.threshold ?? 0.4),
    skipTargetLabels: true,
    replayOnly: true,
    env: {},
  });
  const system2 = pointer.createAnthropicLabeler({});
  const first = system1.opinions(
    { probabilities, returnedModel: '', stopReason: '', usage: { input: 0, output: 0 } },
    set,
    window,
  );
  const second = system2.opinions(
    { labels: answer2.labels, returnedModel: '', stopReason: '', usage: { input: 0, output: 0 } },
    set,
    window,
  );
  const bounds = { passAt: Number(input.passAt ?? 0.9), failAt: Number(input.failAt ?? 0.1) };
  const labelling =
    input.mode === 'system1'
      ? pointer.singleLabelling(system1)
      : input.mode === 'system2'
        ? pointer.singleLabelling(system2)
        : pointer.stackedLabelling(system1, system2, bounds);
  const opinionsFor = (index: number) =>
    input.mode === 'system1'
      ? [first.byUnit.get(index)]
      : input.mode === 'system2'
        ? [second.byUnit.get(index)]
        : [first.byUnit.get(index), second.byUnit.get(index)];
  return {
    labels: window.units.map((unit) => {
      const decision = labelling.decide(opinionsFor(unit.index), set);
      const target = decision?.target === undefined ? undefined : caller.units[decision.target]?.n;
      return {
        n: caller.units[unit.index]?.n,
        label: decision?.label ?? 'none',
        ...(target === undefined ? {} : { target }),
      };
    }),
  };
}

/**
 * `materialize`: the real `pointerScan` over the file, with a labeler that answers the planted labels, then the
 * reader's atom builder over the units the scan labelled. The label of each unit is read back from the ledger the
 * scan wrote, with the cassette key it names: a key of the answer the scan recorded is reported under the bank's
 * name for that answer (`input.cassette`), any other key as `unrecorded:<key>`. A unit of the bank is the unit
 * of the cut that starts where its span starts; a bank unit with none is an unsupported call.
 */
export async function materializeOp(input: Obj): Promise<unknown> {
  const pointer = await pointerExports();
  const root = (await import(/* @vite-ignore */ '@agent-nexus/driftbench-estate')) as Obj;
  const set = setOf(input.set as Obj);
  const source = String(input.source);
  const units = input.units as Obj[];
  const file = String(input.file);
  const cutUnits = (pointer.cut(source) as Obj).units as Obj[];
  // The bank unit at each place of the cut, by the offset its span starts at.
  const bankAt = new Map<number, Obj>();
  for (const unit of units) {
    const at = cutUnits.findIndex(
      (cutUnit) =>
        cutUnit.container !== 'opaque' && Number(cutUnit.start) === Number((unit.span as number[])[0]),
    );
    if (at < 0)
      throw new Unsupported(
        'labels:materialize',
        `the reader cuts no unit at offset ${(unit.span as number[])[0]}`,
      );
    bankAt.set(at, unit);
  }
  const labelOf = new Map((input.labels as Obj[]).map((entry) => [Number(entry.n), entry]));
  const labeler = {
    id: 'bank-planted',
    cls: 'system2',
    family: 'bank',
    model: 'bank-planted-1',
    settings: {},
    maxUnits: (_set: unknown, wanted: number) => wanted,
    render: (asked: Obj, window: Obj) => ({
      labeler: 'bank-planted',
      body: { set: asked.set, window: window.id, units: (window.units as Obj[]).map((unit) => unit.text) },
    }),
    opinions: pointer.denseOpinions,
    async call(_wire: unknown, _set: unknown, window: Obj) {
      const windowUnits = window.units as Obj[];
      return {
        labels: windowUnits.map((unit) => {
          const entry = labelOf.get(Number(bankAt.get(Number(unit.index))?.n));
          if (!entry || entry.label === 'none') return { units: String(unit.n), label: 'none' };
          const targetAt = [...bankAt].find(([, bank]) => Number(bank.n) === Number(entry.target))?.[0];
          const target = windowUnits.find((other) => Number(other.index) === targetAt)?.n;
          return {
            units: String(unit.n),
            label: String(entry.label),
            ...(entry.target !== undefined && target !== undefined ? { target } : {}),
          };
        }),
        returnedModel: 'bank-planted-1',
        stopReason: 'end_turn',
        usage: { input: 0, output: 0 },
      };
    },
  };
  const cassette = new pointer.Cassette();
  const result = (await pointer.pointerScan({
    files: [{ path: file, text: source }],
    sets: [set],
    labelling: pointer.singleLabelling(labeler),
    cassette,
    mode: 'record',
    estateKey: 'bank',
  })) as Obj;
  const keys = [...(cassette.entries as Map<string, unknown>).keys()];
  const named = (from: string): string =>
    from.startsWith('cassette:')
      ? `cassette:${from
          .slice('cassette:'.length)
          .split('+')
          .map((part) =>
            part.length === 12 && keys.filter((key) => key.startsWith(part)).length === 1
              ? String(input.cassette)
              : `unrecorded:${part}`,
          )
          .join('+')}`
      : from;
  const entries = (result.ledger as Obj).entries as Obj[];
  const bankIdOf = new Map(
    entries.map((entry) => [String(entry.id), String(bankAt.get(Number(entry.index))?.id ?? entry.id)]),
  );
  const builder = new (root.AtomBuilder as new (files: ReadonlyMap<string, unknown>) => Obj)(new Map());
  const built = pointer.pointerAtoms(result.labelled, new Map([[file, source]]), builder, 'bank');
  return {
    ledgerLabels: (input.labels as Obj[]).map((entry) => {
      const at = [...bankAt].find(([, bank]) => Number(bank.n) === Number(entry.n))?.[0];
      const found = entries.find((ledgerEntry) => Number(ledgerEntry.index) === at)?.labels?.[
        set.set as string
      ];
      return {
        id: String(bankAt.get(at as number)?.id),
        label: found ? String(found.label) : 'unlabeled',
        ...(found ? { source: named(String(found.source)) } : {}),
      };
    }),
    atoms: (built.accepted as Obj[]).map((atom) => ({
      kind: atom.kind,
      ...(atom.fields?.polarity ? { polarity: atom.fields.polarity } : {}),
      provenance: { file: atom.provenance.file, quote: atom.provenance.quote },
      producedBy: atom.producedBy,
      approved: atom.approved,
      fields: {
        extraction: atom.fields.extraction,
        unit: bankIdOf.get(String(atom.fields.unit)) ?? atom.fields.unit,
        labelSet: atom.fields.labelSet,
      },
      // The reader's own predicates, one for one: nothing is added and a missing flag stays missing.
      evidence: ((atom.evidence ?? []) as Obj[]).map((predicate) => ({
        type: predicate.type,
        name: predicate.name,
        reviewRequired: predicate.options?.reviewRequired,
      })),
    })),
  };
}

/**
 * `validate-answer`: each response is one attempt; an attempt that is a refusal, a cut-off, unreadable or
 * refused by the check fails, and a window gets one retry. An answer that names another window or set is
 * refused; one that names none is read. The one JSON object is read out of prose or a fence.
 */
export async function validateAnswerOp(input: Obj): Promise<unknown> {
  const pointer = await pointerExports();
  const set = setOf(input.labelSet as Obj);
  const window = windowOf({ id: input.window, units: input.units });
  const responses = input.responses as Obj[];
  for (const [at, response] of responses.slice(0, 2).entries()) {
    if (response.refusal === true || response.stopReason === 'max_tokens') continue;
    let labels: Obj[];
    try {
      labels = pointer.parseDenseAnswer(String(response.body), {
        window: String(input.window),
        set: String(set.set),
      });
    } catch {
      continue;
    }
    const checked = pointer.checkAnswer(set, window, labels);
    if (checked.refusals.length > 0) continue;
    return {
      accepted: true,
      attempts: at + 1,
      failedWindow: false,
      labels: window.units
        .filter((unit: Obj) => checked.covered.has(unit.n))
        .map((unit: Obj) => ({ unit: unit.n, label: checked.accepted.get(unit.n)?.label ?? 'none' })),
      unlabeled: window.units.filter((unit: Obj) => !checked.covered.has(unit.n)).map((unit: Obj) => unit.n),
    };
  }
  return {
    accepted: false,
    attempts: Math.min(2, responses.length),
    failedWindow: true,
    labels: [],
    unlabeled: [],
  };
}

export async function labelsOp(input: Obj): Promise<unknown> {
  switch (input.action) {
    case 'decide':
      return decideOp(input);
    case 'materialize':
      return materializeOp(input);
    case 'validate-answer':
      return validateAnswerOp(input);
    case 'rerecord':
      throw new Unsupported(
        'labels:rerecord',
        'the reader emits no label_flip diagnostic: a unit a re-record stops selecting is only counted as unlabeled',
      );
    default:
      throw new Unsupported('labels', `no call for the action ${String(input.action)}`);
  }
}
