// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the prompts under test hold literal placeholders.
import { describe, expect, it } from 'vitest';
import { promptView, rawizeAnswer, rawQuote, sectionRequest, viewSources } from '../../src/extract';

describe('prompts kept inside JSON files', () => {
  const rule = 'Never say "refund" before the order is checked.\nAsk for the order id.';
  const chat = `${JSON.stringify({ messages: [{ role: 'system', content: rule }] }, null, 2)}\n`;
  const lines = `${rule
    .split('\n')
    .map((line) => JSON.stringify({ role: 'system', content: line }))
    .join('\n')}\n`;
  const accents = `{\n  "system": ${JSON.stringify('Réponds en français.').replace(/[^\p{ASCII}]/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n}\n`;

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

describe('a prompt with a constant interpolated', () => {
  const rule = 'Never offer more than ${MAX_SLOTS} visit slots at once.';
  const ts = `export const MAX_SLOTS = 3;\n\nexport const PROMPT = \`Keep it short.\n${rule}\`;\n`;
  const py =
    'MAX_SLOTS = 3\n\nPROMPT = f"""\nKeep it short.\nNever offer more than {MAX_SLOTS} visit slots at once.\n"""\n';
  it('puts the value of the constant in the text the model reads', () => {
    expect(promptView('prompt.ts', ts)?.text).toContain('Never offer more than 3 visit slots at once.');
    expect(promptView('prompt.py', py)?.text).toContain('Never offer more than 3 visit slots at once.');
  });
  it('quotes a passage of the file', () => {
    const sources = [{ kind: 'prompt' as const, path: 'prompt.ts', text: ts }];
    const quote = rawQuote(sources, 'prompt.ts', 'Never offer more than 3 visit slots at once.');
    expect(ts).toContain(quote);
    expect(quote).toBe('Never offer more than');
  });
});

describe('a prompt in a string with doubled quotes', () => {
  const cs =
    'class Agent {\n  public const string Prompt = @"Never say ""refund"" early.\nAsk for the id.";\n}\n';
  const sql =
    "-- the desk's prompt\nINSERT INTO prompts (name, body) VALUES ('desk', 'Don''t promise a date.\nAsk for the id.');\n";
  it('reads "" in a C# verbatim string and \'\' in an SQL string as one quote', () => {
    expect(promptView('Prompt.cs', cs)?.text).toContain('Never say "refund" early.\nAsk for the id.');
    expect(promptView('seed.sql', sql)?.text).toContain("Don't promise a date.\nAsk for the id.");
    expect(promptView('seed.sql', sql)?.text).toContain("-- the desk's prompt");
  });
  it('quotes a passage of the file', () => {
    const sources = [{ kind: 'prompt' as const, path: 'seed.sql', text: sql }];
    const quote = rawQuote(sources, 'seed.sql', "Don't promise a date.");
    expect(sql).toContain(quote);
  });
});

describe('a prompt in HTML or XML', () => {
  const html =
    '<!doctype html>\n<html><body>\n<p>- Keep <b>answers</b> short &amp; clear.</p>\n<p>Say it&#39;s fine.<br>Then stop.</p>\n</body></html>\n';
  const xml = '<agent name="desk" prompt="Never say &quot;refund&quot; early.&#10;Ask for the id."/>\n';
  it('drops tags, turns <br> into a line break and decodes entities in HTML', () => {
    const text = promptView('prompt.html', html)?.text ?? '';
    expect(text).toContain('- Keep answers short & clear.');
    expect(text).toContain("Say it's fine.\nThen stop.");
  });
  it('decodes entities in XML and keeps its tags', () => {
    const text = promptView('agent.xml', xml)?.text ?? '';
    expect(text).toContain('Never say "refund" early.\nAsk for the id.');
    expect(text).toContain('<agent name="desk"');
  });
  it('quotes a passage of the file', () => {
    const sources = [{ kind: 'prompt' as const, path: 'prompt.html', text: html }];
    const quote = rawQuote(sources, 'prompt.html', '- Keep answers short & clear.');
    expect(html).toContain(quote);
  });
});

describe('a prompt in a TOML basic string or an environment file', () => {
  const rule = 'Never say "refund" early.\nAsk for the id.';
  const toml = `name = "desk"\nprompt = ${JSON.stringify(rule)}\n`;
  const env = `MODEL=any\nSYSTEM_PROMPT=${JSON.stringify(rule)}\n`;
  it('decodes double-quoted values with escapes', () => {
    expect(promptView('agent.toml', toml)?.text).toContain(rule);
    expect(promptView('.env', env)?.text).toContain(rule);
  });
});

describe('a prompt in a Java properties file', () => {
  const props = 'prompt=Keep it short.\\n\\\n    Never promise a date.\\n\\\n    Use a C:\\\\ path.\n';
  it('decodes escapes and joins continued lines', () => {
    const text = promptView('agent.properties', props)?.text ?? '';
    expect(text).toContain('Keep it short.\nNever promise a date.\nUse a C:\\ path.');
  });
  it('quotes a passage of the file', () => {
    const sources = [{ kind: 'prompt' as const, path: 'agent.properties', text: props }];
    expect(props).toContain(rawQuote(sources, 'agent.properties', 'Never promise a date.'));
  });
});

describe('a prompt in a CSV of rules', () => {
  const csv = 'id,text\nR1,"Never say ""refund"" early."\nR2,"Ask for the id."\n';
  it('reads a doubled quote in a quoted cell as one quote', () => {
    expect(promptView('rules.csv', csv)?.text).toContain('R1,Never say "refund" early.');
  });
  it('quotes a passage of the file', () => {
    const sources = [{ kind: 'prompt' as const, path: 'rules.csv', text: csv }];
    expect(csv).toContain(rawQuote(sources, 'rules.csv', 'Never say "refund" early.'));
  });
});

describe('a Swift multi-line string with a constant', () => {
  const swift =
    'let MAX_SLOTS = 3\nlet prompt = """\nKeep it short.\nNever offer more than \\(MAX_SLOTS) visit slots at once.\n"""\n';
  it('puts the value of the constant in the text', () => {
    expect(promptView('Prompt.swift', swift)?.text).toContain('Never offer more than 3 visit slots at once.');
  });
});

describe('a message whose content is a list of text parts', () => {
  const text = 'Keep answers short. Never promise a delivery date. Ask for the id.';
  const at = text.indexOf('promise');
  const file = JSON.stringify(
    {
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: text.slice(0, at) },
            { type: 'text', text: text.slice(at) },
          ],
        },
      ],
    },
    null,
    2,
  );
  it('reads the parts as one text', () => {
    expect(promptView('prompt.json', file)?.text).toContain(text);
  });
  it('keeps of a quote cut across parts the longer passage of one part', () => {
    const sources = [{ kind: 'prompt' as const, path: 'prompt.json', text: file }];
    const quote = rawQuote(sources, 'prompt.json', 'Never promise a delivery date.');
    expect(file).toContain(quote);
    expect(quote).toBe('promise a delivery date.');
  });
});

describe('the XML of a Word document', () => {
  const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const docx = `<w:document><w:body>\n<w:p>${run('Keep answers sh')}${run('ort &amp; clear.')}</w:p>\n</w:body></w:document>\n`;
  it('joins the runs of a paragraph into its text', () => {
    expect(promptView('document.xml', docx)?.text).toContain('Keep answers short & clear.');
  });
  it('quotes a passage inside one run', () => {
    const sources = [{ kind: 'prompt' as const, path: 'document.xml', text: docx }];
    expect(docx).toContain(rawQuote(sources, 'document.xml', 'Keep answers short & clear.'));
  });
});

describe('a prompt in reStructuredText or LaTeX', () => {
  const rst = 'Assistant guide\n===============\n\n- Never use a \\* in a reply.\n';
  const tex = '\\section*{Assistant guide}\n- Keep \\textbf{answers} short.\n';
  it('drops the backslash of an escaped character', () => {
    expect(promptView('prompt.rst', rst)?.text).toContain('- Never use a * in a reply.');
  });
  it('reads a command with a braced argument as its argument', () => {
    const text = promptView('prompt.tex', tex)?.text ?? '';
    expect(text).toContain('- Keep answers short.');
    expect(text).toContain('Assistant guide');
  });
  it('quotes a passage of the file', () => {
    const sources = [{ kind: 'prompt' as const, path: 'prompt.tex', text: tex }];
    expect(tex).toContain(rawQuote(sources, 'prompt.tex', '- Keep answers short.'));
  });
});
