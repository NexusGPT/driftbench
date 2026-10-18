import { type Generation, observedFromGenerations } from '../nexus/turn';
import { isRecord } from '../shared/records';
import type { Trace, TraceTurn } from './types';

/**
 * Nexus platform traces, as `GET /tracing/traces/:id` answers them (each with its full generations), read
 * into driftbench traces. One platform trace is one agent turn; the traces of one `conversationId` are one
 * conversation, ordered by start. The input is one answer, a list of them, or JSON Lines of them, with or
 * without the `{ success, data }` envelope.
 */
export function tracesFromNexus(text: string): { traces: Trace[]; issues: string[] } {
  const parsed = nexusEntries(text);
  const mapped = tracesFromNexusEntries(parsed.entries);
  return { traces: mapped.traces, issues: [...mapped.issues, ...parsed.issues] };
}

/** The trace answers a text holds: one, a list, or JSON Lines, with or without the envelope. */
export function nexusEntries(text: string): { entries: unknown[]; issues: string[] } {
  const issues: string[] = [];
  const entries: unknown[] = [];
  const add = (value: unknown) => {
    const data = isRecord(value) && 'data' in value && 'success' in value ? value.data : value;
    if (Array.isArray(data)) entries.push(...data);
    else entries.push(data);
  };
  try {
    add(JSON.parse(text));
  } catch {
    text.split('\n').forEach((line, index) => {
      if (line.trim() === '') return;
      try {
        add(JSON.parse(line));
      } catch {
        issues.push(`line ${index + 1}: not JSON`);
      }
    });
  }
  return { entries, issues };
}

/** Platform traces joined by conversation into driftbench traces. */
export function tracesFromNexusEntries(entries: readonly unknown[]): { traces: Trace[]; issues: string[] } {
  const issues: string[] = [];
  const conversations = new Map<string, Array<{ startedAt: string; turn: TraceTurn; model?: string }>>();
  entries.forEach((entry, index) => {
    if (!isRecord(entry) || !Array.isArray(entry.generations) || entry.generations.length === 0) {
      issues.push(`entry ${index + 1}: not a trace with generations`);
      return;
    }
    const generations = (entry.generations as Generation[])
      .filter(isRecord)
      .sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')));
    const first = generations[0] as Generation & { modelName?: unknown };
    const startedAt =
      typeof entry.startedAt === 'string'
        ? entry.startedAt
        : typeof first.startedAt === 'string'
          ? first.startedAt
          : '';
    const key =
      typeof entry.conversationId === 'string' && entry.conversationId !== ''
        ? entry.conversationId
        : typeof entry.id === 'string'
          ? entry.id
          : `entry-${index + 1}`;
    const turn: TraceTurn = {
      user: userOf(first.messages),
      ...(startedAt ? { startedAt } : {}),
      observed: observedFromGenerations(generations, undefined, undefined),
    };
    const list = conversations.get(key) ?? [];
    list.push({
      startedAt,
      turn,
      ...(typeof first.modelName === 'string' ? { model: first.modelName } : {}),
    });
    conversations.set(key, list);
  });

  const traces: Trace[] = [...conversations].map(([id, list]) => {
    list.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const model = list.find((item) => item.model !== undefined)?.model;
    return {
      id,
      source: 'nexus',
      ...(list[0]?.startedAt ? { startedAt: list[0].startedAt } : {}),
      ...(model ? { model } : {}),
      turns: list.map((item) => item.turn),
      issues: [],
    };
  });
  traces.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.id.localeCompare(b.id));
  return { traces, issues };
}

/** The text of the last user message that is text, not a tool result. */
function userOf(messages: unknown): string {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (!isRecord(message) || message.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content;
    const texts = (Array.isArray(message.content) ? message.content : []).flatMap((block) =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
    );
    if (texts.length > 0) return texts.join('\n');
  }
  return '';
}
