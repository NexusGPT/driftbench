import { type PointerScanOptions, pointer } from '@agent-nexus/driftbench-estate';
import type { ExpectedAtom, ProseEntry } from './render';

/**
 * The pointer reader's answers for a planted estate, by construction. The generator knows which atom it planted
 * on which line; this labeller answers each unit of the rendered files with the label of the atom planted there,
 * so a validator that scans with no model still finds the gates, references and hazards the labelers are asked
 * for. It reads no word of any unit: a unit is placed by the line it sits on, and the label comes from the
 * planted record.
 *
 * - A line with a prose rule of the record (`ProseEntry`) gets a label of its own that builds that rule: the
 *   kind, polarity, title, situation and evidence the record holds. The hazard and the references planted on the
 *   same line are built by the same label (`also`).
 * - A line with only a planted reference gets the shipped `reference` label.
 * - Every other unit is `none`.
 */

const SET_NAME = 'planted';

type Mapping = NonNullable<pointer.LabelSet['labels'][number]['atom']>;
type AlsoMapping = NonNullable<Mapping['also']>[number];

const REFERENCE: AlsoMapping = {
  kind: 'reference',
  title: 'Read ${named}',
  situation: '$unit',
  locate: 'each',
  fields: { readWhen: '$unit', from: '$file' },
  evidence: [{ type: 'tool_called', label: 'Read', input: { file_path: { contains: '$path' } } }],
};

const HAZARDS: Readonly<Record<string, { situation: string }>> = {
  compaction: { situation: 'A compaction of the context' },
  restart: { situation: 'A process restart' },
  rate_wave: { situation: 'A wave of rate limits' },
  session_boundary: { situation: 'A new session' },
  notification: { situation: 'A helper notification' },
  nudge_storm: { situation: 'Repeated guard nudges' },
};

const hazardMapping = (hazard: string): AlsoMapping => ({
  kind: 'hazard',
  situation: HAZARDS[hazard]?.situation ?? hazard,
  fields: { hazard },
  evidence: [{ type: 'custom', name: 'hazard_recovery', options: { hazard } }],
});

/** The line (from 1) of a text in a file, by where the text first sits. */
function lineOf(file: string, text: string): number | undefined {
  const at = file.indexOf(text);
  if (at < 0) return undefined;
  let line = 1;
  for (let index = 0; index < at; index += 1) if (file[index] === '\n') line += 1;
  return line;
}

/** What the generator planted: the files it wrote, the atoms it expects, and the prose rules by file. */
export type Truth = {
  files: Readonly<Record<string, string>>;
  atoms: readonly ExpectedAtom[];
  answers: ReadonlyMap<string, readonly ProseEntry[]>;
  /** Gates planted with no prose rule of the record: the act the read comes before, and the tool of that act. */
  gates?: ReadonlyArray<{ file: string; line: number; act: string; tool: string }>;
};

/** The windows the labeller answered: the file, the units it held and the characters of their text. */
export type WindowLog = Array<{ file: string; units: number; characters: number }>;

export type TruthPointer = PointerScanOptions & { windows: WindowLog };

/** The pointer input that finds the planted atoms of a rendered estate that no code reader finds. */
export function truthPointer(truth: Truth): TruthPointer {
  const shipped = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!shipped.ok) throw new Error(shipped.message);
  const base = shipped.sets[0];
  if (!base) throw new Error('the shipped label set is empty');

  const entries = truth.answers;
  const planted = new Map<string, ExpectedAtom[]>();
  for (const atom of truth.atoms) {
    const key = `${atom.file}:${atom.line}`;
    planted.set(key, [...(planted.get(key) ?? []), atom]);
  }

  const labels: pointer.LabelSet['labels'] = [...base.labels];
  const byLine = new Map<string, string>();
  let count = 0;
  for (const [file, list] of entries) {
    for (const entry of list) {
      const here = planted.get(`${file}:${entry.line}`) ?? [];
      const also: AlsoMapping[] = [
        ...(here.some((atom) => atom.kind === 'reference') ? [REFERENCE] : []),
        ...here.filter((atom) => atom.kind === 'hazard').map((atom) => hazardMapping(atom.key)),
      ];
      count += 1;
      const name = `planted-${count}`;
      labels.push({
        name,
        description: `The rule planted at line ${entry.line} of ${file}.`,
        atom: {
          kind: entry.kind,
          title: entry.title,
          ...(entry.situation ? { situation: entry.situation } : {}),
          ...(entry.polarity ? { polarity: entry.polarity } : {}),
          evidence: entry.evidence as NonNullable<Mapping['evidence']>,
          ...(also.length > 0 ? { also } : {}),
        },
      });
      byLine.set(`${file}:${entry.line}`, name);
    }
  }
  const text = JSON.stringify({ labels: [{ ...base, set: SET_NAME, labels }] });
  const parsed = pointer.parseLabelSets(text);
  if (!parsed.ok) throw new Error(`the planted label set is invalid: ${parsed.message}`);

  const gateAt = new Map((truth.gates ?? []).map((gate) => [`${gate.file}:${gate.line}`, gate]));
  const referenceLines = new Set(
    truth.atoms.filter((atom) => atom.kind === 'reference').map((atom) => `${atom.file}:${atom.line}`),
  );
  const windows: WindowLog = [];
  const labeler: pointer.Labeler = {
    id: 'planted-truth',
    cls: 'system2',
    family: 'planted',
    model: 'planted-truth-1',
    settings: {},
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({
      labeler: 'planted-truth',
      body: { set: set.set, window: window.id, units: window.units.map((unit) => unit.text) },
    }),
    opinions: pointer.denseOpinions,
    async call(_wire, _set, window) {
      const file = truth.files[window.path] ?? '';
      windows.push({
        file: window.path,
        units: window.units.length,
        characters: window.units.reduce((sum, unit) => sum + unit.text.length, 0),
      });
      const used = new Set<string>();
      return {
        labels: window.units.map((unit) => {
          const line = lineOf(file, unit.text);
          const key = `${window.path}:${line}`;
          if (line === undefined || used.has(key)) return { units: String(unit.n), label: 'none' };
          const gate = gateAt.get(key);
          const from = gate ? unit.text.indexOf(gate.act) : -1;
          if (gate && from >= 0) {
            used.add(key);
            return {
              units: String(unit.n),
              label: 'gate',
              spans: [{ kind: 'governed-action', from, to: from + gate.act.length }],
              links: [{ kind: 'act-tool', to: gate.tool }],
            };
          }
          const own = byLine.get(key);
          if (own) {
            used.add(key);
            return { units: String(unit.n), label: own };
          }
          if (referenceLines.has(key)) {
            used.add(key);
            return { units: String(unit.n), label: 'reference' };
          }
          return { units: String(unit.n), label: 'none' };
        }),
        returnedModel: 'planted-truth-1',
        stopReason: 'end_turn',
        usage: { input: 0, output: 0 },
      };
    },
  };
  return {
    sets: parsed.sets,
    labelling: pointer.singleLabelling(labeler),
    cassette: new pointer.Cassette(),
    mode: 'record',
    windows,
  };
}

/** The truth of a rendered estate. */
export function truthOf(rendered: {
  files: Readonly<Record<string, string>>;
  atoms: readonly ExpectedAtom[];
  recording: { answers: Record<string, unknown> };
  gates: Truth['gates'];
}): Truth {
  return {
    gates: rendered.gates,
    files: rendered.files,
    atoms: rendered.atoms,
    answers: new Map(
      Object.entries(rendered.recording.answers).map(([file, answer]) => [
        file,
        (answer as { atoms: ProseEntry[] }).atoms ?? [],
      ]),
    ),
  };
}
