import { createHash } from 'node:crypto';
import { type PointerScanOptions, pointer } from '@agent-nexus/driftbench-estate';
import { plantedColumn, plantedIsOff } from './registry-record';
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
 * - A prose rule whose evidence is a call of a helper also links that helper, so the map holds the dispatch.
 * - The request cell of a planted routing table row gets `route-skill` or `route-helper`, targets the cell that
 *   follows it and links the skill or helper the planted route leads to.
 * - A line with only a planted reference gets the shipped `reference` label.
 * - Every other unit is `none`.
 */

const SET_NAME = 'planted';
const ROUTE_BOTH = 'planted-route-both';

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

/**
 * The hazards a planted line names. The planted compaction rule reads "After a compaction, re-read this file before
 * you continue." (hidden.ts): its reread is the file the line is in, the reread-self span of the shipped label.
 */
const HAZARDS: Readonly<Record<string, { situation: string; rereadSelf?: boolean }>> = {
  compaction: { situation: 'A compaction of the context', rereadSelf: true },
  restart: { situation: 'A process restart' },
  rate_wave: { situation: 'A wave of rate limits' },
  session_boundary: { situation: 'A new session' },
  notification: { situation: 'A helper notification' },
  nudge_storm: { situation: 'Repeated guard nudges' },
};

/** The shipped label of each hazard: a line that only names a hazard is answered with it. */
const HAZARD_LABEL: Readonly<Record<string, string>> = {
  compaction: 'hazard-compaction',
  restart: 'hazard-restart',
  rate_wave: 'hazard-rate-limit',
  session_boundary: 'hazard-new-session',
  notification: 'hazard-notification',
  nudge_storm: 'hazard-nudge',
};

const hazardMapping = (hazard: string): AlsoMapping => ({
  kind: 'hazard',
  situation: HAZARDS[hazard]?.situation ?? hazard,
  fields: { hazard },
  // The options the shipped hazard labels build: the hazard, the named files to read again (none here) and the
  // reread of the file the unit is in when the unit orders it.
  evidence: [
    {
      type: 'custom',
      name: 'hazard_recovery',
      options: { hazard, reread: [], ...(HAZARDS[hazard]?.rereadSelf ? { rereadSelf: true } : {}) },
    },
  ],
});

/** The line (from 1) of a text in a file, by where the text first sits. */
function lineOf(file: string, text: string): number | undefined {
  const at = file.indexOf(text);
  if (at < 0) return undefined;
  let line = 1;
  for (let index = 0; index < at; index += 1) if (file[index] === '\n') line += 1;
  return line;
}

/** The names of the helpers a rule's evidence calls, from the tool calls it lists. */
function dispatchedHelpers(entry: ProseEntry): string[] {
  const out: string[] = [];
  for (const evidence of entry.evidence) {
    const call = evidence as { type?: string; label?: string; input?: { subagent_type?: unknown } };
    if (
      call.type === 'tool_called' &&
      call.label === 'Agent' &&
      typeof call.input?.subagent_type === 'string'
    )
      out.push(call.input.subagent_type);
  }
  return out;
}

/** A text with its runs of white space folded to one space: a change of spacing keeps the key. */
function folded(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

/** A label name that depends on the planted rule alone, never on where it sits among the others. */
function stableName(file: string, entry: ProseEntry, taken: ReadonlySet<string>): string {
  const digest = createHash('sha1')
    .update(`${file}\n${entry.kind}\n${folded(entry.title)}\n${folded(entry.quote)}`)
    .digest('hex')
    .slice(0, 10);
  let name = `planted-${digest}`;
  for (let again = 2; taken.has(name); again += 1) name = `planted-${digest}-${again}`;
  return name;
}

/** The id of the candidate atom of a kind that carries a name: the pointer lists the atoms a link may name. */
function candidateOf(
  context: pointer.LabelContext | undefined,
  link: string,
  kind: string,
  name: string,
): string | undefined {
  const listed = context?.candidates?.[link] ?? [];
  // An id holds the name as a slug: lower case words of letters and digits joined by hyphens (a dot becomes one).
  const slugged = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 6)
    .join('-')
    .slice(0, 48)
    .replace(/-+$/, '');
  return (
    listed.find((candidate) => candidate.id.startsWith(`${kind}.${name}.`)) ??
    listed.find((candidate) => candidate.id.startsWith(`${kind}.${slugged}.`))
  )?.id;
}

/** What the generator planted: the files it wrote, the atoms it expects, and the prose rules by file. */
export type Truth = {
  files: Readonly<Record<string, string>>;
  atoms: readonly ExpectedAtom[];
  answers: ReadonlyMap<string, readonly ProseEntry[]>;
  /** Edges the design plants (hidden ids): a `cites` edge from a rule to the rule whose label it cites. */
  edges?: ReadonlyArray<{ from: string; to: string; kind: string }>;
  /** Gates planted with no prose rule of the record: the act the read comes before, and the tool of that act. */
  gates?: ReadonlyArray<{
    file: string;
    line: number;
    act: string;
    tool: string;
    /** The act is the whole planted line: a unit that holds only a part of it (a list marker cut off) takes it whole. */
    whole?: boolean;
    /** The gate orders a command, not a file: the shipped `gate-command` label answers it. */
    command?: boolean;
    /** The file the gate reads first, as the line writes it: a line of several gates names one for each. */
    reads?: string;
  }>;
};

/** The windows the labeller answered: the file, the units it held and the characters of their text. */
/** Every window the scan sent, whatever its set: the chunk-size checks read all of them. */
export type WindowLog = Array<{ file: string; set: string; units: number; characters: number }>;

export type TruthPointer = PointerScanOptions & { windows: WindowLog };

/** The pointer input that finds the planted atoms of a rendered estate that no code reader finds. */
export function truthPointer(truth: Truth): TruthPointer {
  const shipped = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!shipped.ok) throw new Error(shipped.message);
  const formsParsed = pointer.parseLabelSets(pointer.GATE_FORMS_SET);
  if (!formsParsed.ok) throw new Error(formsParsed.message);
  const gateForms = formsParsed.sets;
  const base = shipped.sets[0];
  if (!base) throw new Error('the shipped label set is empty');

  const entries = truth.answers;
  const planted = new Map<string, ExpectedAtom[]>();
  for (const atom of truth.atoms) {
    const key = `${atom.file}:${atom.line}`;
    planted.set(key, [...(planted.get(key) ?? []), atom]);
  }

  // The labels a rule cites: for each planted `cites` edge, the label that opens the line of the cited rule (its
  // bullet marker, as the planted estate writes it), keyed by the line of the citing rule.
  const atomOfHid = new Map(truth.atoms.map((atom) => [atom.hid, atom]));
  const citesOn = new Map<string, string[]>();
  for (const edge of truth.edges ?? []) {
    if (edge.kind !== 'cites') continue;
    const from = atomOfHid.get(edge.from);
    const to = atomOfHid.get(edge.to);
    if (!from || !to) continue;
    const row = (truth.files[to.file] ?? '').split('\n')[to.line - 1] ?? '';
    const written = /^\s*(?:[-*]\s+)?(?:\*\*)?([A-Z]{1,3}#?\d{1,3})/i.exec(row)?.[1];
    if (!written) continue;
    const at = `${from.file}:${from.line}`;
    citesOn.set(at, [...(citesOn.get(at) ?? []), written]);
  }
  const labels: pointer.LabelSet['labels'] = [...base.labels];
  const byLine = new Map<string, string>();
  const helperAt = new Map<string, string[]>();
  const names = new Set<string>();
  for (const [file, list] of entries) {
    for (const entry of list) {
      const here = planted.get(`${file}:${entry.line}`) ?? [];
      const also: AlsoMapping[] = [
        ...(here.some((atom) => atom.kind === 'reference') ? [REFERENCE] : []),
        ...here.filter((atom) => atom.kind === 'hazard').map((atom) => hazardMapping(atom.key)),
      ];
      const name = stableName(file, entry, names);
      names.add(name);
      labels.push({
        name,
        description: `The rule planted at line ${entry.line} of ${file}.`,
        links: ['dispatches'],
        atom: {
          kind: entry.kind,
          title: entry.title,
          ...(entry.situation ? { situation: entry.situation } : {}),
          ...(entry.polarity ? { polarity: entry.polarity } : {}),
          evidence: entry.evidence as NonNullable<Mapping['evidence']>,
          ...(entry.fields || citesOn.has(`${file}:${entry.line}`)
            ? {
                fields: {
                  ...((entry.fields ?? {}) as NonNullable<Mapping['fields']>),
                  ...(citesOn.has(`${file}:${entry.line}`)
                    ? { cites: citesOn.get(`${file}:${entry.line}`) as string[] }
                    : {}),
                },
              }
            : {}),
          ...(also.length > 0 ? { also } : {}),
        },
      });
      byLine.set(`${file}:${entry.line}`, name);
      const helpers = dispatchedHelpers(entry);
      if (helpers.length > 0) helperAt.set(`${file}:${entry.line}`, helpers);
    }
  }
  // A routing row that leads to a skill and to a helper: one planted label builds the route to the skill and carries
  // the route to the helper as `also`, because a shipped route label names one kind.
  const routeSkill = base.labels.find((label) => label.name === 'route-skill');
  const routeHelper = base.labels.find((label) => label.name === 'route-helper');
  if (routeSkill?.atom && routeHelper?.atom) {
    labels.push({
      ...routeSkill,
      name: ROUTE_BOTH,
      links: ['route-skill', 'route-helper'],
      atom: { ...routeSkill.atom, also: [routeHelper.atom as unknown as AlsoMapping] },
    } as unknown as pointer.LabelSet['labels'][number]);
  }
  // A line that names several hazards and has no record: one planted label builds the first hazard and carries the
  // others as `also`, because a shipped hazard label builds a single hazard.
  const hazardsOn = new Map<string, string[]>();
  for (const atom of truth.atoms) {
    if (atom.kind !== 'hazard') continue;
    const at = `${atom.file}:${atom.line}`;
    hazardsOn.set(at, [...(hazardsOn.get(at) ?? []), atom.key]);
  }
  const manyHazards = new Map<string, string>();
  for (const [at, ids] of hazardsOn) {
    const [first, ...rest] = [...new Set(ids)];
    if (first === undefined || rest.length === 0 || byLine.has(at)) continue;
    const digest = createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 8);
    const name = `planted-hazards-${digest}-${manyHazards.size}`;
    labels.push({
      name,
      description: `The hazards planted at ${at}.`,
      links: ['dispatches'],
      atom: {
        kind: 'hazard',
        situation: HAZARDS[first]?.situation ?? first,
        fields: { hazard: first },
        evidence: [{ type: 'custom', name: 'hazard_recovery', options: { hazard: first, reread: [] } }],
        also: rest.map((id) => hazardMapping(id)),
      },
    } as unknown as pointer.LabelSet['labels'][number]);
    manyHazards.set(at, name);
  }
  const text = JSON.stringify({ labels: [{ ...base, set: SET_NAME, labels }] });
  const parsed = pointer.parseLabelSets(text);
  if (!parsed.ok) throw new Error(`the planted label set is invalid: ${parsed.message}`);

  type PlantedGate = NonNullable<Truth['gates']>[number];
  const gatesOn = new Map<string, PlantedGate[]>();
  for (const gate of truth.gates ?? []) {
    const at = `${gate.file}:${gate.line}`;
    gatesOn.set(at, [...(gatesOn.get(at) ?? []), gate]);
  }
  const gateAt = new Map([...gatesOn].map(([at, list]) => [at, list[0] as PlantedGate]));
  /** The gate forms a unit holds that only the gate-forms set can read: several gates, or an act with no file. */
  const formsGate = (
    key: string,
    unitText: string,
    hasNext: boolean,
  ): 'gate-each' | 'gate-split' | undefined => {
    const planted = gatesOn.get(key) ?? [];
    if (planted.length > 1 && planted.every((each) => unitText.includes(each.act))) return 'gate-each';
    const only = planted[0];
    if (
      planted.length === 1 &&
      only &&
      !only.command &&
      unitText.includes(only.act) &&
      !unitText.includes('`') &&
      hasNext
    )
      return 'gate-split';
    return undefined;
  };
  const hazardLines = new Map<string, string>();
  for (const atom of truth.atoms) {
    const label = atom.kind === 'hazard' ? HAZARD_LABEL[atom.key] : undefined;
    const at = `${atom.file}:${atom.line}`;
    if (label && !hazardLines.has(at)) hazardLines.set(at, manyHazards.get(at) ?? label);
  }
  const referenceLines = new Set(
    truth.atoms.filter((atom) => atom.kind === 'reference').map((atom) => `${atom.file}:${atom.line}`),
  );
  // The planted routes of a line: the request the item planted (`ask`), and the skills or helpers it leads to. A
  // route planted with no request is a table row of the generated estate: its request is the first cell.
  const named = (kind: string, name: string) =>
    truth.atoms.some((atom) => atom.kind === kind && atom.key === name);
  type Route = {
    ask: string;
    planted: boolean;
    label: string;
    kind: string;
    names: string[];
    /** The second kind of target of a row that leads to a skill and to a helper. */
    other?: { label: string; names: string[] };
  };
  const routesIn = new Map<string, Route[]>();
  const routeAt = new Map<string, Route>();
  for (const atom of truth.atoms) {
    if (atom.kind !== 'route') continue;
    const at = `${atom.file}:${atom.line}`;
    const kind = named('subagent', atom.key) ? 'subagent' : 'skill';
    const known = routeAt.get(at);
    if (known) {
      if (known.kind === kind) {
        if (!known.names.includes(atom.key)) known.names.push(atom.key);
      } else {
        const other = known.other ?? { label: kind === 'skill' ? 'route-skill' : 'route-helper', names: [] };
        if (!other.names.includes(atom.key)) other.names.push(atom.key);
        known.other = other;
      }
      continue;
    }
    const ask = (atom as ExpectedAtom & { ask?: string }).ask;
    const row = (truth.files[atom.file] ?? '').split('\n')[atom.line - 1] ?? '';
    if (ask === undefined && !row.trimStart().startsWith('|')) continue;
    const route: Route = {
      ask: ask ?? row.split('|')[1]?.trim() ?? '',
      planted: ask !== undefined,
      label: kind === 'skill' ? 'route-skill' : 'route-helper',
      kind,
      names: [atom.key],
    };
    routeAt.set(at, route);
    routesIn.set(atom.file, [...(routesIn.get(atom.file) ?? []), route]);
  }
  const contexts = new Map<string, pointer.LabelContext | undefined>();
  const windows: WindowLog = [];
  const labeler: pointer.Labeler = {
    id: 'planted-truth',
    cls: 'system2',
    family: 'planted',
    model: 'planted-truth-1',
    settings: {},
    maxUnits: (_set, wanted) => wanted,
    render: (set, window, context) => {
      contexts.set(window.id, context);
      return {
        labeler: 'planted-truth',
        body: { set: set.set, window: window.id, units: window.units.map((unit) => unit.text) },
      };
    },
    opinions: pointer.denseOpinions,
    async call(_wire, set, window) {
      // Every window is logged with its set before anything is answered: a scan that sends a file too large in a
      // set this labeller has no answer for is still seen by the chunk-size checks.
      windows.push({
        file: window.path,
        set: set.set,
        units: window.units.length,
        characters: window.units.reduce((sum, unit) => sum + unit.text.length, 0),
      });
      if (set.set === pointer.GATE_FORMS_SET_NAME) {
        const formsFile = truth.files[window.path] ?? '';
        const taken = new Set<string>();
        return {
          labels: window.units.map((unit) => {
            const none = { units: String(unit.n), label: 'none' };
            const at = lineOf(formsFile, unit.text);
            const key = `${window.path}:${at}`;
            const next = window.units.find((other) => other.n === unit.n + 1);
            const form =
              at === undefined || taken.has(key) ? undefined : formsGate(key, unit.text, next !== undefined);
            const planted = gatesOn.get(key) ?? [];
            if (form === 'gate-each') {
              taken.add(key);
              // The shipped label lists the act span and, right after it, the file span of each gate.
              const usedFiles = new Set<number>();
              const spans = planted
                .map((each) => ({ each, from: unit.text.indexOf(each.act) }))
                .sort((a, b) => a.from - b.from)
                .flatMap(({ each, from }) => {
                  const reads = each.reads;
                  let at = reads === undefined ? -1 : unit.text.indexOf(reads);
                  while (reads !== undefined && at >= 0 && usedFiles.has(at))
                    at = unit.text.indexOf(reads, at + 1);
                  if (reads === undefined || at < 0)
                    throw new Error(`the planted gate "${each.act}" of ${key} names no file the line holds`);
                  usedFiles.add(at);
                  return [
                    { kind: 'governed-action', from, to: from + each.act.length },
                    { kind: 'gate-file', from: at, to: at + reads.length },
                  ];
                });
              return {
                units: String(unit.n),
                label: form,
                spans,
                links: [{ kind: 'act-tool', to: planted[0]?.tool ?? 'Edit' }],
              };
            }
            if (form === 'gate-split' && next && planted[0]) {
              taken.add(key);
              const from = unit.text.indexOf(planted[0].act);
              return {
                units: String(unit.n),
                label: form,
                target: next.n,
                spans: [{ kind: 'governed-action', from, to: from + planted[0].act.length }],
                links: [{ kind: 'act-tool', to: planted[0].tool }],
              };
            }
            return none;
          }),
          returnedModel: 'planted-truth-1',
          stopReason: 'end_turn',
          usage: { input: 0, output: 0 },
        };
      }
      // The registry-roles questions: the planter recorded the role of each column of the header line it wrote
      // (registry-record.ts). A unit it recorded nothing for (a free-text column) is none.
      if (set.set === pointer.REGISTRY_ROLES_SET_NAME) {
        // One question per table: the path names the header line and the file, and a unit is a column by its
        // position. The state values are asked together, and the planter recorded which of them it wrote as off.
        const table = /^registry-roles\/(\d+)\/(.*)\.md$/.exec(window.path);
        const headerLine = table
          ? (truth.files[table[2] as string] ?? '').split('\n')[Number(table[1]) - 1]
          : undefined;
        return {
          labels: window.units.map((unit) => ({
            units: String(unit.n),
            label:
              headerLine !== undefined
                ? (plantedColumn(headerLine, unit.n - 1) ?? 'none')
                : window.path === 'registry-roles/states.md' &&
                    plantedIsOff(unit.text.replace(/^[-*]\s+/, '').trim())
                  ? 'state-off'
                  : 'none',
          })),
          returnedModel: 'planted-truth-1',
          stopReason: 'end_turn',
          usage: { input: 0, output: 0 },
        };
      }
      // Another set (the document roles the scan asks first) has no planted answer: every unit is none.
      if (set.set !== SET_NAME) {
        return {
          labels: window.units.map((unit) => ({ units: String(unit.n), label: 'none' })),
          returnedModel: 'planted-truth-1',
          stopReason: 'end_turn',
          usage: { input: 0, output: 0 },
        };
      }
      const file = truth.files[window.path] ?? '';

      const used = new Set<string>();
      const context = contexts.get(window.id);
      const routed = new Set<unknown>();
      return {
        labels: window.units.map((unit) => {
          const route = routesIn
            .get(window.path)
            ?.find(
              (row) =>
                !routed.has(row) &&
                row.ask !== '' &&
                (row.planted ? unit.text.includes(row.ask) : row.ask === unit.text),
            );
          if (route) {
            routed.add(route);
            const to = route.names
              .map((name) => candidateOf(context, route.label, route.kind, name))
              .filter((id): id is string => id !== undefined);
            // The unit that names the route's first target: the next one in a table, the first one holding the name.
            const first = route.names[0] ?? '';
            const holder = route.planted
              ? (window.units.find((other) => other.n !== unit.n && other.text.includes(first))?.n ?? unit.n)
              : unit.n + 1;
            const more = (route.other?.names ?? [])
              .map((name) =>
                candidateOf(
                  context,
                  route.other?.label ?? '',
                  route.other?.label === 'route-skill' ? 'skill' : 'subagent',
                  name,
                ),
              )
              .filter((id): id is string => id !== undefined)
              .map((id) => ({ kind: route.other?.label ?? '', to: id }));
            if (to.length > 0)
              return {
                units: String(unit.n),
                label: more.length > 0 ? ROUTE_BOTH : route.label,
                target: holder,
                links: [...to.map((id) => ({ kind: route.label, to: id })), ...more],
              };
          }
          const line = lineOf(file, unit.text);
          const key = `${window.path}:${line}`;
          if (line === undefined || used.has(key)) return { units: String(unit.n), label: 'none' };
          const nextUnit = window.units.find((other) => other.n === unit.n + 1);
          if (formsGate(key, unit.text, nextUnit !== undefined)) {
            // The gate-forms set reads this line: the main set leaves the rest of the line to it.
            used.add(key);
            return { units: String(unit.n), label: 'none' };
          }
          const gate = gateAt.get(key);
          const found = gate ? unit.text.indexOf(gate.act) : -1;
          const from = found < 0 && gate?.whole ? 0 : found;
          if (gate && from >= 0) {
            used.add(key);
            const length = found < 0 ? unit.text.length : gate.act.length;
            return {
              units: String(unit.n),
              label: gate.command ? 'gate-command' : 'gate',
              spans: [{ kind: 'governed-action', from, to: from + length }],
              links: [{ kind: 'act-tool', to: gate.tool }],
            };
          }
          const own = byLine.get(key);
          if (own) {
            used.add(key);
            const helpers = helperAt.get(key) ?? [];
            const to = helpers
              .map((helper) => candidateOf(context, 'dispatches', 'subagent', helper))
              .filter((id): id is string => id !== undefined);
            return to.length > 0
              ? { units: String(unit.n), label: own, links: to.map((id) => ({ kind: 'dispatches', to: id })) }
              : { units: String(unit.n), label: own };
          }
          const hazardLabel = hazardLines.get(key);
          if (hazardLabel) {
            used.add(key);
            return { units: String(unit.n), label: hazardLabel };
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
    sets: [...parsed.sets, ...gateForms],
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
  edges?: Truth['edges'];
  recording: { answers: Record<string, unknown> };
  gates: Truth['gates'];
}): Truth {
  return {
    gates: rendered.gates,
    edges: rendered.edges,
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
