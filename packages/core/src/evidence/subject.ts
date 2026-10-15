import type { EvidenceInput, RuleAtom, RuleLink, ToolCall } from './types';

/**
 * What a verdict is about, read from its id. The tools check names its verdicts `tools.<label>.count`,
 * `tools.<label>.input.<field>` and `tools.order`; a label may hold dots (`coverage.check`).
 */
export function verdictSubject(id: string): {
  tool?: string;
  field?: string;
  part?: 'count' | 'input' | 'order';
} {
  if (id === 'tools.order') return { part: 'order' };
  const input = /^tools\.(.+)\.input\.([^.]+)(?:\..*)?$/.exec(id);
  if (input) return { tool: input[1] as string, field: input[2] as string, part: 'input' };
  const count = /^tools\.(.+)\.count$/.exec(id);
  if (count) return { tool: count[1] as string, part: 'count' };
  const zero = /^(.+)\.count0$/.exec(id);
  if (zero) return { tool: zero[1] as string, part: 'count' };
  return {};
}

/** The tool the failing verdict is about: its value facts first, then its id. */
export function subjectTool(input: EvidenceInput): string | undefined {
  return input.values?.find((fact) => fact.tool !== undefined)?.tool ?? verdictSubject(input.verdict.id).tool;
}

/** The field the failing verdict is about, when it checks a tool input. */
export function subjectField(input: EvidenceInput): string | undefined {
  return (
    input.values?.find((fact) => fact.field !== undefined)?.field ?? verdictSubject(input.verdict.id).field
  );
}

/** The calls of the subject tool, in order. */
export function subjectCalls(input: EvidenceInput): ToolCall[] {
  const tool = subjectTool(input);
  if (tool === undefined) return [];
  return input.block.observed.toolCalls.filter((call) => call.label === tool);
}

/** Whitespace folded to single spaces, ends trimmed. */
export function foldSpace(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

/** A value as text, for comparing it with what the user or a file said. */
export function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** Whether a link's verdict pattern matches a verdict id: exact, or a prefix written with a trailing `*`. */
export function linkMatches(link: RuleLink, id: string): boolean {
  return link.verdict.endsWith('*') ? id.startsWith(link.verdict.slice(0, -1)) : link.verdict === id;
}

/** The links of the failing verdict. */
export function verdictLinks(input: EvidenceInput): RuleLink[] {
  return (input.links ?? []).filter((link) => linkMatches(link, input.verdict.id));
}

/** The atoms the failing expectation enforces, as the map holds them. */
export function verdictAtoms(input: EvidenceInput): RuleAtom[] {
  const ids = input.ruleAtoms ?? [];
  const byId = new Map((input.atoms ?? []).map((atom) => [atom.id, atom]));
  return ids.map((id) => byId.get(id)).filter((atom): atom is RuleAtom => atom !== undefined);
}

/** The skill a path sits in: `.claude/skills/<name>/...` or `skills/<name>/...`. */
export function skillOfPath(path: string): string | undefined {
  const match = /(?:^|\/)skills\/([^/]+)\//.exec(path.replace(/\\/g, '/'));
  return match?.[1];
}

/** Paths compared without a leading `./`, an absolute work-folder prefix, or backslashes. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');
  const x = norm(a);
  const y = norm(b);
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

/** A glob with `*` (no slash) and `**` (any depth) as a regular expression over a whole path. */
export function globRegex(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i] as string;
    if (ch === '*' && glob[i + 1] === '*') {
      out += '.*';
      i += 1;
      if (glob[i + 1] === '/') i += 1;
    } else if (ch === '*') {
      out += '[^/]*';
    } else {
      out += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^(?:.*/)?${out}$`);
}

/** A tool output that reports its own failure: an exit code other than 0, or an error flag. */
export function outputFailed(output: unknown): boolean {
  if (output === null || typeof output !== 'object' || Array.isArray(output)) return false;
  const record = output as Record<string, unknown>;
  const code = record.exitCode ?? record.exit_code ?? record.returncode ?? record.code;
  if (typeof code === 'number' && code !== 0) return true;
  return record.is_error === true || record.isError === true;
}
