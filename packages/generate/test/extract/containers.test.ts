import { describe, expect, it } from 'vitest';
import { promptView, rawizeAnswer, rawQuote, sectionRequest, viewSources } from '../../src/extract';

describe('prompts kept inside JSON files', () => {
  const rule = 'Never say "refund" before the order is checked.\nAsk for the order id.';
  const chat = `${JSON.stringify({ messages: [{ role: 'system', content: rule }] }, null, 2)}\n`;
  const lines = `${rule
    .split('\n')
    .map((line) => JSON.stringify({ role: 'system', content: line }))
    .join('\n')}\n`;
  const accents = `{\n  "system": ${JSON.stringify('Réponds en français.').replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n}\n`;

  it('decodes a chat file, an agent export, JSON lines and \\u escapes, and leaves keys out', () => {
    expect(promptView('prompt.json', chat)?.text).toContain('Never say "refund" before');
    expect(promptView('prompt.json', chat)?.text).not.toContain('messages');
    expect(promptView('agent.json', JSON.stringify({ name: 'desk', prompt: rule }))?.text).toContain(rule);
    expect(promptView('prompt.jsonl', lines)?.text).toContain('Ask for the order id.');
    expect(promptView('prompt.json', accents)?.text).toContain('Réponds en français.');
    expect(promptView('prompt.md', '# hi')).toBeUndefined();
    expect(promptView('prompt.json', 'not json')).toBeUndefined();
  });

  it('shows the request the decoded text', () => {
    const sources = [{ kind: 'prompt' as const, path: 'prompt.json', text: chat }];
    const request = sectionRequest('rules', viewSources(sources), { dimensions: [], constraints: [] });
    expect(request.user).toContain('Never say "refund" before');
    expect(request.user).not.toContain('\\"refund\\"');
  });

  it('keeps of a decoded quote the longest passage the file writes as it is', () => {
    const sources = [
      { kind: 'prompt' as const, path: 'prompt.json', text: chat },
      { kind: 'prompt' as const, path: 'accents.json', text: accents },
      { kind: 'prompt' as const, path: 'prompt.jsonl', text: lines },
    ];
    const first = rawQuote(sources, 'prompt.json', 'Never say "refund" before the order is checked.');
    expect(first).toBe('before the order is checked.');
    expect(chat).toContain(first);
    expect(rule).toContain(first);
    expect(rawQuote(sources, 'accents.json', 'Réponds en français.')).toBe('ponds en fran');
    expect(rawQuote(sources, 'prompt.jsonl', 'Ask for the order id.')).toBe('Ask for the order id.');
    expect(rawQuote(sources, 'other.md', 'x')).toBe('x');
    const answer = {
      dimensions: [{ values: [{ evidence: { source: 'prompt.json', quote: 'Never say "refund"' } }] }],
    };
    expect(rawizeAnswer(answer, sources).dimensions[0]?.values[0]?.evidence.quote).toBe('Never say');
  });
});
