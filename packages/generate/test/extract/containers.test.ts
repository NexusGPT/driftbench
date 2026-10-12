import { describe, expect, it } from 'vitest';
import { promptView, QuoteIndex, sectionRequest, sourceTexts, viewSources } from '../../src/extract';

describe('prompts kept inside JSON files', () => {
  const rule = 'Never say "refund" before the order is checked.\nAsk for the order id.';
  const chat = `${JSON.stringify({ messages: [{ role: 'system', content: rule }] }, null, 2)}\n`;
  const lines = `${rule
    .split('\n')
    .map((line) => JSON.stringify({ role: 'system', content: line }))
    .join('\n')}\n`;

  it('decodes a chat file, an agent export and JSON lines', () => {
    expect(promptView('prompt.json', chat)).toContain('Never say "refund" before');
    expect(promptView('agent.json', JSON.stringify({ name: 'desk', prompt: rule }))).toContain(rule);
    expect(promptView('prompt.jsonl', lines)).toContain('Ask for the order id.');
    expect(promptView('prompt.md', '# hi')).toBeUndefined();
    expect(promptView('prompt.json', 'not json')).toBeUndefined();
  });

  it('shows the request the decoded text, and finds a decoded quote in the file', () => {
    const sources = [{ kind: 'prompt' as const, path: 'prompt.json', text: chat }];
    const request = sectionRequest('rules', viewSources(sources), { dimensions: [], constraints: [] });
    expect(request.user).toContain('Never say "refund" before');
    expect(request.user).not.toContain('\\"refund\\"');
    expect(
      new QuoteIndex(sourceTexts(sources)).contains(
        'prompt.json',
        'Never say "refund" before the order is checked.',
      ),
    ).toBe(true);
  });
});
