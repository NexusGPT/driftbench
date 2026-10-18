import type { HttpOptions } from '@agent-nexus/driftbench-generate';
import { sha } from './cut';
import { createAnthropicLabeler } from './dense';
import { type Labeler, type LabelerClass, LabelerConfigError, type Opinion } from './labeler';
import { canonical, type LabelSet } from './labels';
import { createHttpLabeler, loadModuleLabeler } from './user';
import { askedLabels, createJevLabeler, createOpenAiDecisionsLabeler, isVector } from './yesno';

/**
 * Which labelers read the prose, and how their opinions become one label. The default is a stack of the two
 * classes the judges use: a system 1 labeler, a yes or no model that answers with a probability, and a system 2
 * labeler, a chat model that reads the window. They work as a cascade, the way a judge does: system 1 decides a
 * unit only when its probability is at an extreme, from `passAt` up for a label or under `failAt` for every
 * label, and system 2 decides all the units in between. Either class can also run alone, and a user labeler
 * (an HTTP endpoint or a module) fills either class through the same port.
 */

/** The labelers of the default stack, by class: the clients that fill them are named by `parseLabelerSpec`. */
export const DEFAULT_LABELER_SPECS = ['system1:jev', 'system2:anthropic'] as const;

/**
 * The probability from which system 1 decides a unit alone, and the one under which it decides, for every
 * label, that the unit has none. Between the two, system 2 decides. On the fictional fixture the units system 1
 * called with a probability from 0.6 to 0.9 and system 2 did not were wrong nine times in ten, and none sat
 * above 0.9; no unit system 2 called an atom had every probability under 0.4. The bounds are the extremes.
 */
export const DEFAULT_PASS_AT = 0.9;
export const DEFAULT_FAIL_AT = 0.1;

/**
 * A system 1 labeler that answers a choice question gives one probability per label, so the stack reads the
 * margin between the two likeliest: system 1 decides a unit when its likeliest label leads the second by this
 * much, and system 2 decides the rest. Measured on a fictional estate, 0.65 sends 40% of the units to system 2
 * and the units system 1 keeps are right 93.5% of the time.
 */
export const DEFAULT_MARGIN_CUT = 0.65;

export type LabelerSpec = {
  cls: LabelerClass;
  /** `jev`, `jev-unit`, `openai-decisions`, `anthropic`, `http` or `module`. */
  client: string;
  model?: string;
  /** The URL of an `http` client or the path of a `module` client. */
  target?: string;
};

const CLIENTS: Record<LabelerClass, readonly string[]> = {
  system1: ['jev', 'jev-unit', 'openai-decisions', 'http', 'module'],
  system2: ['anthropic', 'http', 'module'],
};

/** Reads `<class>:<client>[:<model>]`, `<class>:http:<url>` or `<class>:module:<path>`. */
export function parseLabelerSpec(
  text: string,
): { ok: true; spec: LabelerSpec } | { ok: false; message: string } {
  const [cls, ...rest] = text.split(':');
  if (cls !== 'system1' && cls !== 'system2') {
    return { ok: false, message: `"${text}" starts with system1 or system2, the class of the labeler` };
  }
  const client = rest[0] ?? '';
  const detail = rest.slice(1).join(':');
  if (!CLIENTS[cls].includes(client)) {
    return {
      ok: false,
      message: `"${text}": the clients of ${cls} are ${CLIENTS[cls].join(', ')}`,
    };
  }
  if (client === 'http') {
    if (!/^https?:\/\/\S+$/.test(detail)) {
      return {
        ok: false,
        message: `"${text}": http takes an address, such as ${cls}:http:https://host/path`,
      };
    }
    return { ok: true, spec: { cls, client, target: detail } };
  }
  if (client === 'module') {
    if (detail === '')
      return { ok: false, message: `"${text}": module takes a path, such as ${cls}:module:./labeler.mjs` };
    return { ok: true, spec: { cls, client, target: detail } };
  }
  return { ok: true, spec: { cls, client, ...(detail === '' ? {} : { model: detail }) } };
}

/** One unit's label, who decided it, and the cassette keys of the answers it comes from. */
export type Decision = {
  label: string;
  /** The unit, as its index in the file, at the other end of a label that asks for one. */
  target?: number;
  by: LabelerClass;
  sources: string[];
  /** True when the other labeler of a stack gave no opinion for the unit, so the one that did decided alone. */
  fallback?: true;
};

export type Labelling = {
  /** One labeler, or a system 1 labeler then a system 2 labeler. */
  members: readonly Labeler[];
  /** A hash of what decides a label besides the answers: ids, models, thresholds, the two bounds, the rule. */
  hash: string;
  /** One line for the report: the classes and the clients that fill them. */
  describe: string;
  /** The label a unit takes from the opinions of the members, in member order. */
  decide(opinions: ReadonlyArray<Opinion | undefined>, set: LabelSet): Decision | undefined;
};

const sourcesOf = (...opinions: Array<Opinion | undefined>): string[] =>
  opinions.flatMap((opinion) => (opinion?.source ? [opinion.source] : []));

function single(member: Labeler): Labelling {
  return {
    members: [member],
    hash: sha(canonical({ members: [describeMember(member)], rule: 'single' })).slice(0, 16),
    describe: label(member),
    decide([opinion]) {
      if (!opinion) return undefined;
      return {
        label: opinion.label,
        ...(opinion.target === undefined ? {} : { target: opinion.target }),
        by: member.cls,
        sources: sourcesOf(opinion),
      };
    },
  };
}

/**
 * The margin of a system 1 opinion: the probability of the most likely option minus that of the second. The
 * options include `none`, and the probabilities must form a vector; a vector that does not sum to 1 has no margin
 * (it is never normalised).
 */
export function margin(
  probabilities: Readonly<Record<string, number>>,
): { label: string; margin: number } | undefined {
  if (!('none' in probabilities) || !isVector(probabilities)) return undefined;
  const sorted = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  return { label: sorted[0]?.[0] ?? 'none', margin: (sorted[0]?.[1] ?? 0) - (sorted[1]?.[1] ?? 0) };
}

function stacked(
  system1: Labeler,
  system2: Labeler,
  bounds: { passAt: number; failAt: number; marginCut?: number },
): Labelling {
  const { passAt, failAt, marginCut } = bounds;
  /** The label system 1 decides alone, or undefined when the unit is left to system 2. */
  const sureLabel = (opinion: Opinion): string | undefined => {
    if (marginCut !== undefined) {
      const lead = margin(opinion.probabilities ?? {});
      return lead && lead.margin >= marginCut ? lead.label : undefined;
    }
    let top: { label: string; p: number } | undefined;
    for (const [name, p] of Object.entries(opinion.probabilities ?? {})) {
      if (!top || p > top.p) top = { label: name, p };
    }
    if (top && top.p >= passAt) return top.label;
    if (!top || top.p < failAt) return 'none';
    return undefined;
  };
  return {
    members: [system1, system2],
    hash: sha(
      canonical({
        members: [describeMember(system1), describeMember(system2)],
        ...(marginCut === undefined ? { passAt, failAt, rule: 'cascade' } : { marginCut, rule: 'margin' }),
      }),
    ).slice(0, 16),
    describe: `${label(system1)} then ${label(system2)} (${marginCut === undefined ? `pass at ${passAt}, fail at ${failAt}` : `margin cut ${marginCut}`})`,
    decide([first, second], set) {
      if (!first && !second) return undefined;
      const fromSecond = (opinion: Opinion): Decision => ({
        label: opinion.label,
        ...(opinion.target === undefined ? {} : { target: opinion.target }),
        by: 'system2',
        sources: sourcesOf(first, opinion),
      });
      // System 1 gave no opinion (a failed call, a refused vector): it counts as below the cut and system 2 decides.
      if (!first && second) return { ...fromSecond(second), fallback: true };
      if (!first) return undefined;
      // A label that asks for a target cannot be asked of system 1: system 2 alone decides it.
      if (second) {
        const asked = new Set(askedLabels(set, true).map((entry) => entry.name));
        if (second.label !== 'none' && !asked.has(second.label)) return fromSecond(second);
      }
      const sure = sureLabel(first);
      if (sure !== undefined) {
        return {
          label: sure,
          by: 'system1',
          sources: sourcesOf(first, second),
          ...(second ? {} : { fallback: true as const }),
        };
      }
      // An unsure unit takes the label system 2 gave on every run. Without it the unit stays unlabeled: system
      // 1's uncertain label is never taken in its place.
      return second ? fromSecond(second) : undefined;
    },
  };
}

function describeMember(member: Labeler): Record<string, unknown> {
  return {
    id: member.id,
    cls: member.cls,
    model: member.model,
    settings: member.settings,
    runs: member.runs ?? 1,
  };
}

const label = (member: Labeler): string =>
  `${member.cls === 'system1' ? 'system 1' : 'system 2'} ${member.id} ${member.model}`;

/** A labelling of one labeler, for a caller that builds its own labeler. */
export const singleLabelling = single;
/** A labelling of a system 1 labeler in front of a system 2 labeler. */
export const stackedLabelling = stacked;

export type LabellingOptions = {
  env: Record<string, string | undefined>;
  /** Whether a cassette miss may call the labelers: they then need their keys. */
  record: boolean;
  /** Where a labeler module path is resolved from. */
  cwd: string;
  /** The probability of yes at which a system 1 labeler takes a label. */
  threshold?: number;
  /** A stack: the probability from which system 1 decides a unit alone. */
  passAt?: number;
  /** A stack: the probability under which system 1 decides that a unit has no label. */
  failAt?: number;
  /** A stack that decides by margin instead: system 1 decides a unit whose top label leads the second by this much. */
  marginCut?: number;
  /** The name of the variable that holds the bearer token of an HTTP labeler. */
  keyVariable?: string;
  fetch?: HttpOptions['fetch'];
};

/** What a labeler needs in the environment to call its service, named for the error that says it is missing. */
const KEY_HELP: Record<string, string> = {
  jev: 'JEV_API_KEY and JEV_URL (or JEV_ROUTE)',
  'jev-unit': 'JEV_API_KEY and JEV_URL (or JEV_ROUTE)',
  'openai-decisions': 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

async function member(spec: LabelerSpec, inStack: boolean, options: LabellingOptions): Promise<Labeler> {
  const http = options.fetch ? { fetch: options.fetch } : {};
  const threshold = options.threshold === undefined ? {} : { threshold: options.threshold };
  switch (spec.client) {
    case 'jev':
    case 'jev-unit':
      return createJevLabeler({
        ...http,
        env: options.env,
        state: spec.client === 'jev-unit' ? 'unit' : 'window',
        skipTargetLabels: inStack,
        replayOnly: !options.record,
      });
    case 'openai-decisions': {
      const model = spec.model ?? options.env.OPENAI_DECISIONS_MODEL?.trim();
      if (!model) {
        throw new LabelerConfigError(
          'openai-decisions needs a model: system1:openai-decisions:<model>, or OPENAI_DECISIONS_MODEL',
        );
      }
      return createOpenAiDecisionsLabeler({
        ...http,
        ...threshold,
        model,
        env: options.env,
        skipTargetLabels: inStack,
        replayOnly: !options.record,
      });
    }
    case 'anthropic': {
      const key = options.record ? options.env.ANTHROPIC_API_KEY?.trim() : undefined;
      const model = spec.model ?? options.env.ANTHROPIC_LABELER_MODEL?.trim();
      return createAnthropicLabeler({
        ...http,
        ...(model ? { model } : {}),
        ...(key ? { key } : {}),
        ...(options.env.ANTHROPIC_BASE_URL ? { baseUrl: options.env.ANTHROPIC_BASE_URL } : {}),
      });
    }
    case 'http':
      return createHttpLabeler({
        ...http,
        ...threshold,
        url: spec.target ?? '',
        cls: spec.cls,
        env: options.env,
        ...(options.keyVariable ? { keyVariable: options.keyVariable } : {}),
        skipTargetLabels: inStack,
        replayOnly: !options.record,
      });
    case 'module':
      return loadModuleLabeler(spec.target ?? '', {
        ...threshold,
        cwd: options.cwd,
        skipTargetLabels: inStack,
        replayOnly: !options.record,
      });
    default:
      throw new LabelerConfigError(`unknown labeler client ${spec.client}`);
  }
}

/**
 * Builds the labelling the specs ask for: one labeler alone, or a system 1 labeler and a system 2 labeler as a
 * stack. With `record`, every labeler must be able to call its service, and the message names what is missing.
 */
export async function buildLabelling(
  specs: readonly LabelerSpec[],
  options: LabellingOptions,
): Promise<{ ok: true; labelling: Labelling } | { ok: false; message: string }> {
  if (specs.length === 0 || specs.length > 2) {
    return { ok: false, message: 'give one labeler, or one of each class: system1 and system2' };
  }
  const classes = new Set(specs.map((spec) => spec.cls));
  if (classes.size !== specs.length) {
    return { ok: false, message: 'give at most one labeler per class: system1 and system2' };
  }
  const passAt = options.passAt ?? DEFAULT_PASS_AT;
  const failAt = options.failAt ?? DEFAULT_FAIL_AT;
  if (
    ![passAt, failAt].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
    failAt >= passAt
  ) {
    return { ok: false, message: 'the bounds are numbers from 0 to 1, with fail-at under pass-at' };
  }
  const ordered = [...specs].sort((a, b) => a.cls.localeCompare(b.cls));
  const inStack = ordered.length === 2;
  try {
    const members: Labeler[] = [];
    for (const spec of ordered) members.push(await member(spec, inStack, options));
    if (options.record) {
      for (const [at, labeler] of members.entries()) {
        if (labeler.call) continue;
        const spec = ordered[at];
        return {
          ok: false,
          message: `--record needs ${KEY_HELP[spec?.client ?? ''] ?? 'the service of the labeler'} in the environment for the ${labeler.cls} labeler ${labeler.id}`,
        };
      }
    }
    const [first, second] = members;
    if (first && second) {
      // A choice model gives a vector: it decides by margin unless the caller set the two probability bounds.
      const bounded = options.passAt !== undefined || options.failAt !== undefined;
      const choice = first.settings.question === 'choice';
      if (options.marginCut !== undefined && !choice) {
        return {
          ok: false,
          message: `a margin cut needs a system 1 labeler that answers a choice question; ${first.id} does not`,
        };
      }
      const marginCut = options.marginCut ?? (choice && !bounded ? DEFAULT_MARGIN_CUT : undefined);
      return {
        ok: true,
        labelling: stacked(first, second, {
          passAt,
          failAt,
          ...(marginCut === undefined ? {} : { marginCut }),
        }),
      };
    }
    if (first) return { ok: true, labelling: single(first) };
    return { ok: false, message: 'no labeler' };
  } catch (cause) {
    if (cause instanceof LabelerConfigError) return { ok: false, message: cause.message };
    throw cause;
  }
}
