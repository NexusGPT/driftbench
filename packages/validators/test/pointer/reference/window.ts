import type { LabelDef, WindowMode } from '../../../src/ladders/pointer/sut/port';
import type { NewUnit } from './anchor';
import { referenceBugsB } from './bugs-b';
import { referenceBugsPrivacy } from './bugs-privacy';
import type { ParsedSet } from './labelset';

/** What a request lists for each link kind of a set: the candidates a link may name, by kind. */
export type Candidates = Readonly<Record<string, ReadonlyArray<{ id: string; label: string }>>>;

/** About 100,000 tokens at four characters a token. */
export const WINDOW_CHARS = 400_000;

export type PlanUnit = {
  n: number;
  /** The index of the unit in its file. */
  index: number;
  mode: WindowMode;
  text: string;
  container: string;
  path: string[];
};

export type WindowPlan = { id: string; file: string; path: string[]; units: PlanUnit[] };

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/** What a request carries in place of a comment inside a unit. */
const COMMENT_MARKER = '(comment)';

/** A comment is `<!--` up to and with the next `-->`, or up to the end of the text when it never closes. */
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;

/**
 * The text of a unit as a request carries it: a comment inside it is replaced by `(comment)` and the rest stays.
 * The ledger, the ids and the atoms read the unit itself; only the request is masked.
 */
export function requestText(text: string): string {
  if (referenceBugsPrivacy.has('comment-text-sent')) return text;
  if (!text.includes('<!--')) return text;
  if (referenceBugsPrivacy.has('comment-unit-dropped')) return COMMENT_MARKER;
  return text.replace(COMMENT, COMMENT_MARKER);
}

/**
 * What a labeller is shown for one unit: its text on one line, a comment inside it replaced by `(comment)`; an
 * opaque comment shows its kind only, an opaque fence its kind and first line.
 */
export function displayText(unit: NewUnit, opaque: boolean): string {
  if (opaque) {
    if (unit.container === 'comment' && !referenceBugsPrivacy.has('comment-text-sent'))
      return '(comment, not labelable)';
    const first = unit.text.split(/\r?\n/)[0] ?? '';
    return `(${unit.container}) ${first.trim()}`;
  }
  return flat(requestText(unit.text));
}

/** Splits a file's units into heading-bounded windows under the size bound and keeps those holding a unit to label. */
export function planWindows(
  file: string,
  units: readonly NewUnit[],
  dirty: ReadonlySet<number>,
  read: ReadonlySet<number>,
): WindowPlan[] {
  const sections: number[][] = [];
  let current: number[] = [];
  units.forEach((unit, index) => {
    if (unit.container === 'heading' && current.length > 0) {
      sections.push(current);
      current = [];
    }
    current.push(index);
  });
  if (current.length > 0) sections.push(current);
  const size = (indices: number[]) => indices.reduce((sum, i) => sum + (units[i] as NewUnit).text.length, 0);
  const groups: number[][] = [];
  let group: number[] = [];
  let groupSize = 0;
  for (const section of sections) {
    const sectionSize = size(section);
    // A window ends where the next top-level heading starts, and when the next section would pass the size bound.
    const first = units[section[0] as number] as NewUnit;
    const topLevel = first.container === 'heading' && first.sectionPath.length === 0;
    if (group.length > 0 && (topLevel || groupSize + sectionSize > WINDOW_CHARS)) {
      groups.push(group);
      group = [];
      groupSize = 0;
    }
    if (sectionSize > WINDOW_CHARS) {
      // a section with no heading to split at: cut it between units
      let part: number[] = [];
      let partSize = 0;
      for (const i of section) {
        const len = (units[i] as NewUnit).text.length;
        if (part.length > 0 && partSize + len > WINDOW_CHARS) {
          groups.push(part);
          part = [];
          partSize = 0;
        }
        part.push(i);
        partSize += len;
      }
      if (part.length > 0) groups.push(part);
      continue;
    }
    group.push(...section);
    groupSize += sectionSize;
  }
  if (group.length > 0) groups.push(group);
  const plans: WindowPlan[] = [];
  groups.forEach((indices, k) => {
    const first = units[indices[0] as number] as NewUnit;
    const planUnits: PlanUnit[] = indices.map((index, at) => {
      const unit = units[index] as NewUnit;
      const opaque = unit.container === 'fence' || unit.container === 'comment';
      const mode: WindowMode = opaque
        ? 'opaque'
        : read.has(index)
          ? 'read'
          : dirty.has(index)
            ? 'label'
            : 'context';
      return {
        n: at + 1,
        index,
        mode,
        text: displayText(unit, opaque),
        container: unit.container,
        path: unit.sectionPath.map(requestText),
      };
    });
    // A window whose units all kept their labels is not sent.
    if (planUnits.some((u) => u.mode === 'label') || referenceBugsB.has('carried-window-requested')) {
      plans.push({
        id: `${file}#${k + 1}`,
        file,
        path:
          first.container === 'heading'
            ? [...first.sectionPath, first.text.replace(/\s+/g, ' ').trim()].map(requestText)
            : first.sectionPath.map(requestText),
        units: planUnits,
      });
    }
  });
  return plans;
}

/** The generic text around the set: no word of any domain. */
export const SYSTEM_TEXT =
  'You assign exactly one label from a closed list to each numbered line of a window. ' +
  'Reply with one JSON object only: {"window": "<window id>", "set": "<set name>", "labels": [{"units": "<number or first-last>", "label": "<name>"}]}. ' +
  'Use none when no label applies. Lines marked (context) or in brackets after the number are shown for reading only.';

/** The window as the model is shown it. Every unit is one numbered line, whatever its text holds. */
export function windowLines(plan: WindowPlan): string[] {
  return plan.units.map((u) => {
    const marker =
      u.mode === 'label' ? '' : u.mode === 'context' ? '(context) ' : u.mode === 'read' ? '(read) ' : '';
    return `[${u.n}] ${marker}${u.text}`;
  });
}

/** The link kinds of a set and the candidates the request lists under each; nothing for a set with none. */
function linkLines(set: ParsedSet, candidates: Candidates): string[] {
  if (!set.links) return [];
  const lines = ['LINK KINDS:'];
  for (const kind of set.links) {
    lines.push(`- ${kind.name}: ${kind.description}`);
    for (const candidate of candidates[kind.name] ?? [])
      lines.push(`    ${candidate.id}  ${candidate.label}`);
  }
  return lines;
}

export function userText(set: ParsedSet, plan: WindowPlan, candidates: Candidates = {}): string {
  const names = [...set.labels.map((l) => l.name), 'none'].join(' | ');
  const labelLines = set.labels.map((l: LabelDef) => {
    const examples = (l.examples ?? [])
      .slice(0, 3)
      .map((e) => JSON.stringify(e))
      .join(' | ');
    return `- ${l.name}: ${l.description}${examples ? ` Examples: ${examples}` : ''}${l.target === 'required' ? ' Names a target line.' : ''}`;
  });
  const header = `WINDOW ${plan.id}  path: ${plan.path.join(' > ')}`;
  return [
    `SET ${set.set}`,
    set.description,
    `LABELS ${names}`,
    ...labelLines,
    ...linkLines(set, candidates),
    header,
    ...windowLines(plan),
  ].join('\n');
}
