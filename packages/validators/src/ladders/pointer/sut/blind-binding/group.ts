import { type Obj, pointerExports, Unsupported } from './reader';

type RawUnit = { n: number; text: string; path?: string[]; opaque?: boolean; contextOnly?: boolean };

/** The units a label can point at, as reader units; an opaque unit stays so and a context-only neighbour is dropped. */
function selectable(raw: RawUnit[]) {
  return raw
    .filter((unit) => unit.contextOnly !== true)
    .map((unit) => ({
      n: unit.n,
      unit: {
        container: unit.opaque === true ? 'opaque' : 'sentence',
        start: 0,
        end: unit.text.length,
        text: unit.text,
        fp: '',
        path: unit.path ?? [],
      },
    }));
}

/** The reader's windows over the units, with each unit carrying the number the caller gave it. */
async function windowsFor(path: string, raw: RawUnit[], size: number) {
  const pointer = await pointerExports();
  const list = selectable(raw);
  const windows = pointer.windowsOf(
    path,
    list.map((entry) => entry.unit),
    size,
  );
  return windows.map((window: Obj) => ({
    ...window,
    units: window.units.map((unit: Obj) => ({ ...unit, n: list[unit.index]?.n ?? unit.n })),
  }));
}

const setOf = (set: Obj) => ({
  set: String(set.name),
  description: String(set.description ?? set.name),
  labels: (set.labels as Obj[]).map((label) => ({
    description: String(label.description ?? label.name),
    ...label,
  })),
});

export async function groupOp(input: Obj): Promise<unknown> {
  const pointer = await pointerExports();
  switch (input.action) {
    case 'windows': {
      const units = input.units as RawUnit[];
      const windows = await windowsFor(String(input.file), units, pointer.DEFAULT_WINDOW_UNITS);
      return {
        windows: windows.map((window: Obj) => ({
          selectable: window.units.map((unit: Obj) => unit.n),
          contextOnly: [],
        })),
      };
    }
    case 'questions': {
      const asked = setOf(input.set as Obj);
      const labeler = pointer.createOpenAiDecisionsLabeler({
        model: 'bank',
        state: input.state === 'unit' ? 'unit' : 'window',
        maxQuestions: pointer.DEFAULT_MAX_QUESTIONS,
        skipTargetLabels: true,
        replayOnly: true,
      });
      const units = input.units as RawUnit[];
      const size = labeler.maxUnits(asked, units.length);
      const windows = await windowsFor('bank.md', units, size);
      return {
        batches: windows.map((window: Obj) => ({
          keys: (labeler.render(asked, window).body.questions as Obj[]).map((question) => question.name),
        })),
      };
    }
    case 'dense': {
      const window = input.window as Obj;
      const units = (window.units as Obj[]).map((unit, index) => ({ n: unit.n, text: unit.text, index }));
      const answer = input.answer as Obj;
      const set = setOf(input.set as Obj);
      const checked = pointer.checkAnswer(
        set,
        {
          id: String(window.id),
          path: '',
          headingPath: [],
          units: units.filter((_u, i) => (window.units as Obj[])[i]?.contextOnly !== true),
        },
        (answer.labels ?? []) as Obj[],
      );
      const wanted = units.filter((_u, i) => (window.units as Obj[])[i]?.contextOnly !== true);
      return {
        accepted: checked.refusals.length === 0,
        labels: wanted
          .filter((unit) => checked.covered.has(unit.n))
          .map((unit) => ({ n: unit.n, label: checked.accepted.get(unit.n)?.label ?? 'none' })),
        unlabeled: wanted.filter((unit) => !checked.covered.has(unit.n)).map((unit) => unit.n),
      };
    }
    case 'carry': {
      const sets = (input.sets as unknown[]).map(String);
      const now = new Map((input.current as Obj[]).map((unit) => [unit.n, unit]));
      const carried: Obj[] = [];
      const dirty: Obj[] = [];
      for (const unit of input.previous as Obj[]) {
        const after = now.get(unit.n);
        if (!after) continue;
        const result = pointer.carryOf(
          { fp: unit.fp, ctxFp: unit.ctxFp, labels: unit.labels },
          { fp: after.fp, ctxFp: after.ctxFp },
          sets,
        );
        for (const kept of result.carried) carried.push({ n: unit.n, set: kept.set, label: kept.label });
        for (const set of result.dirty) dirty.push({ n: unit.n, set });
      }
      return { carried, dirty };
    }
    default:
      throw new Unsupported('group', `no call for the action ${String(input.action)}`);
  }
}
