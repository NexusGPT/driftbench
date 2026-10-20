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

export async function materializeOp(input: Obj): Promise<unknown> {
  const pointer = await pointerExports();
  const root = (await import(/* @vite-ignore */ '@agent-nexus/driftbench-estate')) as Obj;
  const set = setOf(input.set as Obj);
  const source = String(input.source);
  const units = input.units as Obj[];
  const file = String(input.file);
  const cutUnits = units.map((unit) => ({
    container: 'sentence',
    start: Number((unit.span as number[])[0]),
    end: Number((unit.span as number[])[1]),
    text: source.slice(Number((unit.span as number[])[0]), Number((unit.span as number[])[1])),
    fp: '',
    path: [] as string[],
  }));
  const labelOf = new Map((input.labels as Obj[]).map((entry) => [Number(entry.n), entry]));
  const labelled: Obj[] = [];
  for (const [at, unit] of units.entries()) {
    const entry = labelOf.get(Number(unit.n));
    if (!entry || entry.label === 'none') continue;
    const targetAt =
      entry.target === undefined ? -1 : units.findIndex((other) => Number(other.n) === Number(entry.target));
    labelled.push({
      path: file,
      index: at,
      unit: cutUnits[at],
      id: String(unit.id),
      set,
      label: String(entry.label),
      source: String(input.cassette),
      ...(targetAt >= 0
        ? {
            target: {
              path: file,
              index: targetAt,
              unit: cutUnits[targetAt],
              id: String(units[targetAt]?.id),
            },
          }
        : {}),
    });
  }
  const builder = new (root.AtomBuilder as new (files: ReadonlyMap<string, unknown>) => Obj)(new Map());
  const result = pointer.pointerAtoms(labelled, new Map([[file, source]]), builder, 'bank');
  return {
    ledgerLabels: (input.labels as Obj[]).map((entry) => ({
      id: String(units.find((unit) => Number(unit.n) === Number(entry.n))?.id),
      label: String(entry.label),
    })),
    atoms: (result.accepted as Obj[]).map((atom) => ({
      kind: atom.kind,
      ...(atom.fields?.polarity ? { polarity: atom.fields.polarity } : {}),
      provenance: { file: atom.provenance.file, quote: atom.provenance.quote },
      producedBy: atom.producedBy,
      approved: atom.approved,
      fields: {
        extraction: atom.fields.extraction,
        unit: atom.fields.unit,
        labelSet: atom.fields.labelSet,
        cassette: atom.fields.cassette,
      },
      evidence: [{ type: 'custom', name: 'prose_pointer', reviewRequired: true }],
    })),
  };
}

/**
 * `validate-answer`: each response is one attempt; an attempt that is a refusal, a cut-off, unreadable or
 * refused by the check fails, and a window gets one retry. The reader's answer has no window or set echo and
 * reads JSON out of a wrapper, so an item that plants a wrong echo or a wrapped answer fails here: that is the
 * reader's behaviour, not a gap of this binding.
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
      labels = pointer.parseDenseAnswer(String(response.body));
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
