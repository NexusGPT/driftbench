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

describe('prompts kept in quoted YAML scalars', () => {
  const double = `system: ${JSON.stringify('Never say "refund" early.\nAsk for the id.')}\n`;
  const single = "system: 'Don''t promise a date. Offer a call back.'\n";
  it('decodes double-quoted escapes and single-quoted apostrophes', () => {
    expect(promptView('prompt.yaml', double)?.text).toContain('Never say "refund" early.\nAsk for the id.');
    expect(promptView('prompt.yaml', single)?.text).toContain("Don't promise a date.");
    expect(promptView('prompt.yaml', 'system: plain text\n')).toBeUndefined();
  });
  it('keeps of a decoded quote a passage the file writes as it is', () => {
    const sources = [
      { kind: 'prompt' as const, path: 'a.yaml', text: double },
      { kind: 'prompt' as const, path: 'b.yaml', text: single },
    ];
    const a = rawQuote(sources, 'a.yaml', 'Never say "refund" early.');
    expect(double).toContain(a);
    expect('Never say "refund" early.').toContain(a);
    const b = rawQuote(sources, 'b.yaml', "Don't promise a date.");
    expect(single).toContain(b);
    expect(b).toBe('t promise a date.');
  });
});

describe('prompts kept in string literals of code', () => {
  const prompt = "Don't promise a date.\nAsk for the id.";
  const ts = `// the agent's prompt\nexport const PROMPT = '${prompt.replace(/'/g, "\\'").replace(/\n/g, '\\n')}';\n`;
  const php = `<?php\n$prompt = '${prompt.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';\n`;
  const go = `package agent\n\nconst Prompt = ${JSON.stringify(prompt)}\n`;
  it('decodes single and double quoted literals and skips comments', () => {
    expect(promptView('prompt.ts', ts)?.text).toContain("Don't promise a date.\nAsk for the id.");
    expect(promptView('prompt.ts', ts)?.text).toContain("// the agent's prompt");
    expect(promptView('prompt.php', php)?.text).toContain("Don't promise a date.");
    expect(promptView('prompt.go', go)?.text).toContain('Ask for the id.');
    expect(promptView('prompt.ts', 'const a = `raw ${x}`;\n')).toBeUndefined();
  });
  it('keeps of a quote a passage the file writes as it is', () => {
    const sources = [{ kind: 'prompt' as const, path: 'prompt.ts', text: ts }];
    const quote = rawQuote(sources, 'prompt.ts', "Don't promise a date.");
    expect(ts).toContain(quote);
    expect(quote).toBe('t promise a date.');
  });
});

describe('a prompt cut across string literals', () => {
  const parts = ['Keep answers short and clear.\n', 'Never promise a delivery date.\n'];
  const ts = `export const PROMPT =\n${parts.map((part) => `  ${JSON.stringify(part)}`).join(' +\n')};\n`;
  const py = `PROMPT = (\n${parts.map((part) => `    ${JSON.stringify(part)}`).join('\n')}\n)\n`;
  it('reads literals joined with + or by implicit concatenation as one string', () => {
    expect(promptView('prompt.ts', ts)?.text).toContain('Keep answers short and clear.\nNever promise');
    expect(promptView('prompt.py', py)?.text).toContain('Keep answers short and clear.\nNever promise');
  });
  it('quotes a passage inside one literal', () => {
    const sources = [{ kind: 'prompt' as const, path: 'prompt.ts', text: ts }];
    const quote = rawQuote(sources, 'prompt.ts', 'Never promise a delivery date.');
    expect(ts).toContain(quote);
    expect(quote).toBe('Never promise a delivery date.');
  });
});
