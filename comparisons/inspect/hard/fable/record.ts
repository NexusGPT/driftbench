import type { JudgeRequest, TranscriptEntry } from '../../../../packages/judges/src/contract';

/**
 * Reads a rendered record into the judge contract. The hard sets render every case as one string whose
 * parts are introduced by bracketed labels: `[context] ...`, `[user] ...`, `[agent] ...`,
 * `[tool_call name] {...}`, `[tool_result name] {...}`, `[input name] ...` and `[artifact] ...`.
 *
 * Each labelled part becomes what its label says: a transcript entry with that role (and tool name), an
 * input with that path, or the artifact. A part runs to the next label. A context part is one line: text
 * after its line break, up to the next label, is the agent's answer, as is text before the first label and
 * a record with no label at all. An instruction appended to the agent's reply stays inside the agent entry.
 * No label is removed from a part's body: the split happens on the label and the body is what follows it.
 */
export type ParsedRecord = {
  transcript: TranscriptEntry[];
  inputs?: { path: string; text: string }[];
  artifact?: string;
};

const LABEL = /\[(context|user|agent|tool_call|tool_result|input|artifact)(?:[ \t]+([^\]\n]+))?\][ \t]*/g;

type Part = { label: string; name?: string; body: string };

export function parseRecord(text: string): ParsedRecord {
  const parts: Part[] = [];
  const push = (label: string, name: string | undefined, body: string) => {
    if (label === 'context') {
      const line = body.indexOf('\n');
      if (line >= 0) {
        parts.push({ label, name, body: body.slice(0, line).trim() });
        const rest = body.slice(line + 1).trim();
        if (rest) parts.push({ label: 'agent', body: rest });
        return;
      }
    }
    parts.push({ label, name, body: body.trim() });
  };
  let last: { label: string; name?: string; start: number } | undefined;
  for (const match of text.matchAll(LABEL)) {
    const at = match.index;
    if (last) push(last.label, last.name, text.slice(last.start, at));
    else if (text.slice(0, at).trim()) push('agent', undefined, text.slice(0, at));
    last = { label: match[1] as string, name: match[2]?.trim(), start: at + match[0].length };
  }
  if (last) push(last.label, last.name, text.slice(last.start));
  else push('agent', undefined, text);
  const transcript: TranscriptEntry[] = [];
  const inputs: { path: string; text: string }[] = [];
  let artifact: string | undefined;
  for (const part of parts) {
    switch (part.label) {
      case 'input':
        inputs.push({ path: part.name ?? 'input', text: part.body });
        break;
      case 'artifact':
        artifact = artifact === undefined ? part.body : `${artifact}\n${part.body}`;
        break;
      case 'tool_call':
      case 'tool_result':
        transcript.push({ role: part.label, text: part.body, ...(part.name ? { tool: part.name } : {}) });
        break;
      default:
        transcript.push({ role: part.label as TranscriptEntry['role'], text: part.body });
    }
  }
  return {
    transcript,
    ...(inputs.length ? { inputs } : {}),
    ...(artifact === undefined ? {} : { artifact }),
  };
}

/** The request fields a parsed record supplies. */
export function recordFields(text: string): Pick<JudgeRequest, 'transcript' | 'inputs' | 'artifact'> {
  return parseRecord(text);
}
