import { skillLoaded } from './rule';
import { samePath, skillOfPath, verdictAtoms, verdictLinks } from './subject';
import type { EvidenceInput, EvidenceProvider, RuleAtom } from './types';
import { homeOfAtom } from './value';

/**
 * Evidence about a reference file: whether it exists, whether a pointer forces the agent to read it, how deep
 * the pointer chain is, and how much of it the agent read. The placement law: a separate topic goes to a
 * reference, with a forcing cross-ref that fires in its situation.
 */

/** The path of the reference the failing check is about: a reference atom's path, or a rule written in one. */
export function referencePath(input: EvidenceInput): string | undefined {
  const atom = verdictAtoms(input)[0];
  if (atom) {
    if (atom.kind === 'reference' && typeof atom.fields?.path === 'string') return atom.fields.path;
    if (homeOfAtom(atom) === 'skill_reference') return atom.provenance.file;
    const read = pointerTarget(atom);
    if (read !== undefined) return read;
    return undefined;
  }
  const link = verdictLinks(input)[0];
  return link?.home === 'skill_reference' ? link.file : undefined;
}

/** The file a pointer atom sends the agent to: a reference's path, or the file of a gate's Read evidence. */
function pointerTarget(atom: RuleAtom): string | undefined {
  if (typeof atom.fields?.path === 'string') return atom.fields.path;
  for (const predicate of atom.evidence ?? []) {
    if (predicate.type !== 'tool_called' || predicate.label !== 'Read') continue;
    const file = (predicate.input as Record<string, unknown> | undefined)?.file_path;
    if (typeof file === 'string') return file;
    if (
      file !== null &&
      typeof file === 'object' &&
      typeof (file as { contains?: unknown }).contains === 'string'
    ) {
      return (file as { contains: string }).contains;
    }
  }
  return undefined;
}

/** The pointer atoms in the map that send the agent to `path`: references and gates, with the file they sit in. */
function pointersTo(input: EvidenceInput, path: string): Array<{ atom: RuleAtom; from: string }> {
  return (input.atoms ?? [])
    .filter((atom) => atom.kind === 'reference' || atom.kind === 'gate')
    .map((atom) => ({ atom, target: pointerTarget(atom) }))
    .filter((entry) => entry.target !== undefined && samePath(entry.target, path))
    .map(({ atom }) => ({ atom, from: (atom.fields?.from as string | undefined) ?? atom.provenance.file }));
}

/** A main file: a SKILL.md body or a core file (outside any skill's references). */
function isMainFile(file: string): boolean {
  if (/(?:^|\/)skills\/[^/]+\/SKILL\.md$/i.test(file)) return true;
  return skillOfPath(file) === undefined && !/(?:^|\/)(agents|guards|hooks)\//.test(file);
}

/** The shortest pointer chain from a main file to `path`; undefined when nothing points to it. */
function depth(input: EvidenceInput, path: string, seen: Set<string> = new Set()): number | undefined {
  if (seen.has(path) || seen.size > 8) return undefined;
  seen.add(path);
  let best: number | undefined;
  for (const { from } of pointersTo(input, path)) {
    const d = isMainFile(from)
      ? 1
      : (() => {
          const up = depth(input, from, seen);
          return up === undefined ? undefined : up + 1;
        })();
    if (d !== undefined && (best === undefined || d < best)) best = d;
  }
  return best;
}

export const ref_exists: EvidenceProvider = {
  name: 'ref_exists',
  cost: 'static',
  values: ['boolean'],
  from: "the reference atom's fields.exists",
  compute: (input) => {
    const atom = verdictAtoms(input).find((one) => one.kind === 'reference');
    const exists = atom?.fields?.exists;
    if (typeof exists === 'boolean') return exists;
    const path = referencePath(input);
    if (path === undefined) return undefined;
    const pointer = pointersTo(input, path).find((entry) => typeof entry.atom.fields?.exists === 'boolean');
    return pointer?.atom.fields?.exists as boolean | undefined;
  },
};

export const ref_forced: EvidenceProvider = {
  name: 'ref_forced',
  cost: 'static',
  values: ['boolean'],
  from: 'a reference or gate atom points to the file from a skill body or the core prompt',
  compute: (input) => {
    const path = referencePath(input);
    if (path === undefined) return undefined;
    return pointersTo(input, path).some((entry) => isMainFile(entry.from));
  },
};

export const ref_depth: EvidenceProvider = {
  name: 'ref_depth',
  cost: 'static',
  values: ['number'],
  from: 'the map edges: 1 when a main file names the reference, 2 or more when only another reference does',
  compute: (input) => {
    const path = referencePath(input);
    return path === undefined ? undefined : depth(input, path);
  },
};

const PARTIAL_COMMAND = /\b(head|tail|sed\s+-n|awk|grep)\b/;
const FULL_COMMAND = /\b(cat|less|more|bat)\b/;

/** How much of `path` the agent read: none, partial (a Read with offset or limit, head, sed -n) or full. */
export function readAmount(input: EvidenceInput, path: string): 'none' | 'partial' | 'full' {
  let amount: 'none' | 'partial' | 'full' = 'none';
  const raise = (to: 'partial' | 'full') => {
    if (to === 'full' || amount === 'none') amount = to;
  };
  for (const call of input.block.observed.toolCalls) {
    const args = (call.input ?? {}) as Record<string, unknown>;
    if (call.label === 'Read') {
      const file = args.file_path ?? args.path;
      if (typeof file !== 'string' || !samePath(file, path)) continue;
      raise(args.offset !== undefined || args.limit !== undefined ? 'partial' : 'full');
    } else if (call.label === 'Bash' && typeof args.command === 'string') {
      commandRead(args.command, path, raise);
    }
  }
  for (const run of input.block.observed.executions ?? []) commandRead(run.command, path, raise);
  for (const ref of input.block.observed.runtime?.references ?? []) {
    if (samePath(ref.path, path) && amount === 'none') amount = 'full';
  }
  return amount;
}

function commandRead(command: string, path: string, raise: (to: 'partial' | 'full') => void): void {
  const tail = path.replace(/\\/g, '/').split('/').slice(-2).join('/');
  if (!command.includes(tail)) return;
  if (PARTIAL_COMMAND.test(command)) raise('partial');
  else if (FULL_COMMAND.test(command)) raise('full');
}

export const ref_read: EvidenceProvider = {
  name: 'ref_read',
  cost: 'static',
  values: ['none', 'partial', 'full'],
  from: "Read calls with their offset and limit, head, tail and sed -n commands, and the runtime's references list",
  compute: (input) => {
    const path = referencePath(input);
    return path === undefined ? undefined : readAmount(input, path);
  },
};

export const rule_in_context: EvidenceProvider = {
  name: 'rule_in_context',
  cost: 'static',
  values: ['boolean'],
  from: 'skill_loaded for a rule in a skill body; ref_read full for a rule in a reference; always for a core or instruction rule',
  compute: (input) => {
    const atom = verdictAtoms(input)[0];
    const link = verdictLinks(input)[0];
    const home = atom ? homeOfAtom(atom) : link?.home;
    if (home === undefined) return undefined;
    if (home === 'core' || home === 'instruction') return true;
    if (home === 'skill_body') {
      const skill = atom ? skillOfPath(atom.provenance.file) : link?.skill;
      return skill === undefined ? undefined : skillLoaded(input, skill);
    }
    if (home === 'skill_reference') {
      const path = referencePath(input);
      return path === undefined ? undefined : readAmount(input, path) === 'full';
    }
    return undefined;
  },
};
