import { describe, expect, it } from 'vitest';
import { parseJsonl } from '../../../src/claude-code/format';
import { isOverloaded, normaliseStream, parseStream } from '../../../src/claude-code/live';
import { mapSession } from '../../../src/claude-code/session';

/** The headless stream read alone: parsing, overload detection, and the records one turn becomes. */

const line = (record: unknown) => JSON.stringify(record);
const init = line({ type: 'system', subtype: 'init', session_id: 's-1', model: 'fake-model', cwd: '/w' });
const result = (fields: Record<string, unknown> = {}) =>
  line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Done.',
    num_turns: 2,
    session_id: 's-1',
    total_cost_usd: 0.0125,
    usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 20 },
    ...fields,
  });
const call = line({
  type: 'assistant',
  session_id: 's-1',
  parent_tool_use_id: null,
  message: {
    id: 'm1',
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 't1', name: 'Agent', input: { description: 'Audit', prompt: 'Audit' } },
    ],
  },
});
const helperOwn = line({
  type: 'assistant',
  session_id: 's-1',
  parent_tool_use_id: 't1',
  message: {
    id: 'h1',
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'h-t1', name: 'Read', input: {} }],
  },
});
const answer = line({
  type: 'user',
  session_id: 's-1',
  parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'No duplicates.' }] },
});
const echoed = line({
  type: 'user',
  session_id: 's-1',
  message: { role: 'user', content: 'And keep it short.' },
});
const reply = line({
  type: 'assistant',
  session_id: 's-1',
  message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'No invoice was paid twice.' }] },
});

describe('parseStream', () => {
  it('reads the session id, the model and the result with its cost and tokens', () => {
    const parsed = parseStream([init, call, answer, reply, result()].join('\n'));
    expect(parsed.sessionId).toBe('s-1');
    expect(parsed.model).toBe('fake-model');
    expect(parsed.result).toEqual({
      subtype: 'success',
      isError: false,
      text: 'Done.',
      numTurns: 2,
      costUsd: 0.0125,
      usage: { inputTokens: 150, outputTokens: 20 },
    });
    expect(parsed.issues).toEqual([]);
  });

  it('names a stream with no init, no result, or a line that is not JSON', () => {
    const issues = parseStream([reply, 'not json'].join('\n')).issues;
    expect(issues[0]).toMatch(/^stream line 2 is not JSON/);
    expect(issues).toContain('the stream has no init record');
    expect(issues).toContain('the stream has no result record');
  });
});

describe('isOverloaded', () => {
  it('reads an overloaded or rate-limited error result, and an error output with no result', () => {
    const overloaded = parseStream(
      result({ subtype: 'error_during_execution', is_error: true, result: 'API Error: 529 Overloaded' }),
    );
    expect(isOverloaded(overloaded, 1, '')).toBe(true);
    const limited = parseStream(result({ is_error: true, result: 'API Error: 429 rate_limit_error' }));
    expect(isOverloaded(limited, 1, '')).toBe(true);
    expect(isOverloaded(parseStream(''), 1, 'Error: Overloaded')).toBe(true);
  });

  it('is false for a success, for another error, and for a failure with no stream and no such word', () => {
    expect(isOverloaded(parseStream(result()), 0, '')).toBe(false);
    expect(isOverloaded(parseStream(result({ is_error: true, result: 'Tool failed' })), 1, '')).toBe(false);
    expect(isOverloaded(parseStream(''), 1, 'command not found')).toBe(false);
  });
});

describe('normaliseStream', () => {
  const turn = () => {
    const parsed = parseStream([init, call, helperOwn, answer, echoed, reply, result()].join('\n'));
    const records = normaliseStream({
      parsed,
      ask: 'Audit the ledger.',
      startedAt: '2026-10-12T10:00:00.000Z',
      cwd: '/w',
      queued: ['Use week 41.'],
    });
    return {
      records: records.map((text) => JSON.parse(text) as Record<string, unknown>),
      mapped: mapSession({ transcript: parseJsonl(records.join('\n')) }),
    };
  };

  it('opens the turn with the ask, keeps init and result as system records, marks the helper and the echo', () => {
    const { records } = turn();
    expect(records[0]).toMatchObject({
      type: 'user',
      sessionId: 's-1',
      cwd: '/w',
      message: { content: 'Audit the ledger.' },
    });
    expect(records[1]).toMatchObject({
      type: 'user',
      isMeta: true,
      queued: true,
      message: { content: 'Use week 41.' },
    });
    expect(records.filter((record) => record.type === 'system').map((record) => record.subtype)).toEqual([
      'init',
      'result',
    ]);
    expect(
      records.find((record) => (record.message as { id?: string } | undefined)?.id === 'h1')?.isSidechain,
    ).toBe(true);
    expect(records.find((record) => record.echoed === true)).toMatchObject({ isMeta: true });
    expect(records.every((record) => !('session_id' in record))).toBe(true);
  });

  it('maps to one block: the helper act left out, the echo and the queued message kept', () => {
    const { mapped } = turn();
    expect(mapped.blocks).toHaveLength(1);
    const observed = mapped.blocks[0]?.observed;
    expect(observed?.toolCalls.map((entry) => entry.label)).toEqual(['Agent']);
    expect(observed?.toolCalls[0]?.output).toBe('No duplicates.');
    expect(observed?.text).toBe('No invoice was paid twice.');
    const raw = observed?.raw as { kept: Array<{ reason: string }> } | undefined;
    const kept = (raw?.kept ?? []).map((entry) => entry.reason);
    expect(kept.filter((reason) => reason.includes('injected'))).toHaveLength(2);
    expect(kept).toContain('a helper record (sidechain)');
  });
});
