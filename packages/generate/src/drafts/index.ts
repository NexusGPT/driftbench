import type { Observed } from '@agent-nexus/driftbench-core';
import { isMap, isScalar, parseDocument, stringify as stringifyYaml } from 'yaml';
import { detectPass1, detectPass2, Redactor } from '../intake/privacy';

/**
 * Draft specs from production traces. Each trace becomes one spec: each observed user turn becomes a block
 * whose When is that message and whose Given is what production observed before it (the earlier user
 * messages, the agent's replies and its tool calls with their results, as the block's prefix, with
 * `origin: recorded`). So every block starts from a real state, teacher-forced.
 *
 * No block gets an expectation. An expectation copied from the observed reply would pass by construction,
 * the self-affirming test the design forbids: a person writes each Then from the agent's spec. What
 * production did is kept beside the blocks, in `metadata.imported.observed`, for that person to read. The
 * draft is `approved: false` until the person approves it.
 *
 * Personal data is redacted by default with the intake privacy rules (checksums, then the independent second
 * pass), one placeholder per value across the whole conversation.
 */

export type DraftTrace = {
  id: string;
  source: string;
  startedAt?: string;
  model?: string;
  turns: ReadonlyArray<{ user: string; startedAt?: string; observationId?: string; observed: Observed }>;
};

export type TraceDraft = {
  id: string;
  text: string;
  blocks: number;
  /** Values the privacy passes replaced. */
  redacted: number;
};

export type DraftOptions = {
  importedAt: string;
  /** Default true. */
  redact?: boolean;
  /** The file the trace came from, recorded in the metadata. */
  file?: string;
};

/** The spec id of a trace's draft: `draft-<source>-<trace id>`, with every character a spec id refuses as a hyphen. */
export function draftId(trace: Pick<DraftTrace, 'id' | 'source'>): string {
  const slug = trace.id
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `draft-${trace.source}-${slug || 'trace'}`;
}

export function draftSpec(trace: DraftTrace, options: DraftOptions): TraceDraft {
  const redactor = options.redact === false ? undefined : new Redactor();
  let redacted = 0;
  const clean = (text: string): string => {
    if (!redactor) return text;
    const first = detectPass1(text);
    const once = redactor.redact(text, first);
    const second = detectPass2(once);
    redacted += first.length + second.length;
    return redactor.redact(once, second);
  };
  const cleanJson = (value: unknown): unknown => {
    if (typeof value === 'string') return clean(value);
    if (Array.isArray(value)) return value.map(cleanJson);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, cleanJson(inner)]));
    }
    return value ?? null;
  };

  const blocks: Array<Record<string, unknown>> = [];
  const observed: Array<Record<string, unknown>> = [];
  const skipped: Array<{ turn: number; reason: string }> = [];
  const prefix: Array<Record<string, unknown>> = [];
  trace.turns.forEach((turn, index) => {
    if (turn.user.trim() === '') {
      skipped.push({ turn: index, reason: 'no user text' });
      return;
    }
    const user = clean(turn.user);
    const reply = clean(turn.observed.text);
    const block: Record<string, unknown> = { user };
    // The prefix is what production did, its tool calls with their real results: a recorded history.
    if (prefix.length > 0) {
      block.given = { prefix: prefix.map((message) => structuredClone(message)), origin: 'recorded' };
    }
    blocks.push(block);
    const counts = new Map<string, number>();
    for (const call of turn.observed.toolCalls) counts.set(call.label, (counts.get(call.label) ?? 0) + 1);
    observed.push({
      block: blocks.length - 1,
      reply,
      tools: [...counts].map(([label, count]) => ({ label, count })),
      cost: turn.observed.cost,
      latency_ms: turn.observed.latencyMs,
      ...(turn.startedAt ? { started_at: turn.startedAt } : {}),
      ...(turn.observationId ? { observation_id: turn.observationId } : {}),
    });
    prefix.push({ role: 'user', content: user });
    const calls = turn.observed.toolCalls.map((call) => ({
      ...(call.id ? { id: call.id } : {}),
      label: call.label,
      input: cleanJson(call.input),
      ...(call.error !== undefined ? { error: clean(call.error) } : { output: cleanJson(call.output) }),
    }));
    prefix.push({ role: 'assistant', content: reply, ...(calls.length > 0 ? { tool_calls: calls } : {}) });
  });
  if (blocks.length === 0) throw new Error(`trace ${trace.id} has no user turn to draft a block from`);

  const id = draftId(trace);
  const spec = {
    id,
    version: 'draft',
    title: `Imported from ${trace.source} trace ${trace.id}`,
    description:
      'Drafted from a production trace. Each block replays an observed user message from the observed state before it. No block expects anything yet: write each expect from the agent spec, never from the observed reply. Not approved.',
    tags: ['imported', `source:${trace.source}`],
    blocks,
    metadata: {
      imported: {
        approved: false,
        source: trace.source,
        trace: trace.id,
        ...(trace.model ? { model: trace.model } : {}),
        ...(trace.startedAt ? { started_at: trace.startedAt } : {}),
        imported_at: options.importedAt,
        ...(options.file ? { file: options.file } : {}),
        redacted: redactor !== undefined,
        observed,
        ...(skipped.length > 0 ? { skipped } : {}),
      },
    },
  };
  const header = [
    `# Draft spec imported from a production trace (${trace.source}). Not approved: nothing counts until a person`,
    '# reviews it, writes the expect of each block from the agent spec, and approves it with',
    '#   driftbench import approve <this file> --all',
    '# metadata.imported.observed holds what production did, for that review. Never copy it into an expect.',
  ];
  return {
    id,
    text: `${header.join('\n')}\n${stringifyYaml(spec, { lineWidth: 0, aliasDuplicateObjects: false })}`,
    blocks: blocks.length,
    redacted,
  };
}

function importedOf(text: string) {
  const doc = parseDocument(text);
  const imported = doc.getIn(['metadata', 'imported'], true);
  if (!isMap(imported)) throw new Error('not an imported draft: no metadata.imported');
  return { doc, imported };
}

/** True while a draft is not approved. Throws on a spec that is not an imported draft. */
export function pendingDrafts(text: string): boolean {
  const { imported } = importedOf(text);
  const flag = imported.get('approved', true);
  return !(isScalar(flag) && flag.value === true);
}

/** Sets `metadata.imported.approved` to true, keeping comments and layout. */
export function approveDrafts(text: string): { text: string; changed: boolean } {
  if (!pendingDrafts(text)) return { text, changed: false };
  const { doc, imported } = importedOf(text);
  imported.set('approved', true);
  return { text: doc.toString({ lineWidth: 0 }), changed: true };
}
