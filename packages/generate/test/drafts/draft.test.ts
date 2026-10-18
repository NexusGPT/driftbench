import { validateSpec } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { approveDrafts, type DraftTrace, draftSpec, pendingDrafts } from '../../src/drafts';

const REAL_EMAIL = `ana.duarte@${['mail', 'box'].join('')}.be`;

function trace(): DraftTrace {
  return {
    id: 'conv/acme 0001',
    source: 'otel',
    startedAt: '2026-03-02T10:00:00.000Z',
    model: 'example-model-1',
    turns: [
      {
        user: 'Hi, do you have home internet at 3 Orchard Way, Acmeville?',
        observed: {
          segments: [
            {
              type: 'tool_call',
              id: 'c1',
              label: 'coverage.check',
              input: { address: '3 Orchard Way, Acmeville' },
            },
            { type: 'tool_result', id: 'c1', label: 'coverage.check', output: { found: true } },
            { type: 'text', text: 'Yes, Acme Fiber 300 is available.' },
          ],
          text: 'Yes, Acme Fiber 300 is available.',
          toolCalls: [
            {
              id: 'c1',
              label: 'coverage.check',
              input: { address: '3 Orchard Way, Acmeville' },
              output: { found: true },
            },
          ],
          cost: { inputTokens: 930, outputTokens: 62 },
          latencyMs: 3000,
        },
      },
      {
        user: `Great. My email is ${REAL_EMAIL}`,
        observed: {
          segments: [{ type: 'text', text: 'Thanks, I have noted it.' }],
          text: 'Thanks, I have noted it.',
          toolCalls: [],
          cost: { usd: 0.0014 },
          latencyMs: 1600,
        },
      },
      { user: '', observed: { segments: [], text: '', toolCalls: [], cost: {}, latencyMs: 0 } },
    ],
  };
}

describe('draftSpec', () => {
  it('writes a valid spec whose blocks replay the observed user turns from the observed state before them', () => {
    const draft = draftSpec(trace(), { importedAt: '2026-10-12T00:00:00.000Z', redact: false });
    expect(draft.id).toBe('draft-otel-conv-acme-0001');
    const raw = parseYaml(draft.text);
    const loaded = validateSpec(raw);
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
    expect(raw.blocks).toHaveLength(2);
    expect(raw.blocks[0]).toEqual({ user: 'Hi, do you have home internet at 3 Orchard Way, Acmeville?' });
    expect(raw.blocks[1].given.prefix).toEqual([
      { role: 'user', content: 'Hi, do you have home internet at 3 Orchard Way, Acmeville?' },
      {
        role: 'assistant',
        content: 'Yes, Acme Fiber 300 is available.',
        tool_calls: [
          {
            id: 'c1',
            label: 'coverage.check',
            input: { address: '3 Orchard Way, Acmeville' },
            output: { found: true },
          },
        ],
      },
    ]);
    // A prefix copied from production is a recorded history, and the spec says so.
    expect(raw.blocks[1].given.origin).toBe('recorded');
    expect(loaded.ok && loaded.spec.blocks[1]?.given?.origin).toBe('recorded');
    expect(raw.metadata.imported).toMatchObject({
      approved: false,
      source: 'otel',
      trace: 'conv/acme 0001',
      model: 'example-model-1',
      imported_at: '2026-10-12T00:00:00.000Z',
      skipped: [{ turn: 2, reason: 'no user text' }],
    });
    expect(raw.metadata.imported.observed[0]).toEqual({
      block: 0,
      reply: 'Yes, Acme Fiber 300 is available.',
      tools: [{ label: 'coverage.check', count: 1 }],
      cost: { inputTokens: 930, outputTokens: 62 },
      latency_ms: 3000,
    });
  });

  it('never writes an expectation from the observed reply', () => {
    const raw = parseYaml(draftSpec(trace(), { importedAt: 'x' }).text);
    for (const block of raw.blocks) expect(block.expect).toBeUndefined();
  });

  it('redacts personal data by default, consistently across the conversation, and counts it', () => {
    const draft = draftSpec(trace(), { importedAt: 'x' });
    expect(draft.text).not.toContain('ana.duarte');
    expect(draft.text).not.toContain('Orchard');
    // The address in the first message, the same address in the tool input, the email in the second message.
    expect(draft.redacted).toBe(3);
    const raw = parseYaml(draft.text);
    expect(raw.blocks[0].user).toBe('Hi, do you have home internet at [ADDRESS_1], Acmeville?');
    expect(raw.blocks[1].user).toBe('Great. My email is [EMAIL_1]');
    expect(raw.blocks[1].given.prefix[1].tool_calls[0].input).toEqual({ address: '[ADDRESS_1], Acmeville' });
    expect(raw.metadata.imported.redacted).toBe(true);
    const kept = draftSpec(trace(), { importedAt: 'x', redact: false });
    expect(kept.text).toContain('ana.duarte');
    expect(kept.redacted).toBe(0);
  });

  it('refuses a trace with no user turn', () => {
    expect(() => draftSpec({ ...trace(), turns: [] }, { importedAt: 'x' })).toThrow(/no user turn/);
  });
});

describe('approval of drafts', () => {
  it('lists unapproved drafts and approves them in place, comments kept', () => {
    const text = draftSpec(trace(), { importedAt: 'x' }).text;
    expect(pendingDrafts(text)).toBe(true);
    const approved = approveDrafts(text);
    expect(approved.changed).toBe(true);
    expect(pendingDrafts(approved.text)).toBe(false);
    expect(approved.text.startsWith('# Draft spec')).toBe(true);
    expect(approveDrafts(approved.text).changed).toBe(false);
    expect(() => pendingDrafts('id: a\nblocks: [{user: x}]\n')).toThrow(/not an imported draft/);
  });
});
