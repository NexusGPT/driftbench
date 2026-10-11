import { describe, expect, it } from 'vitest';
import {
  inventoryPrepass,
  parseAnswer,
  retryNote,
  SECTION_KINDS,
  SECTIONS,
  SYSTEM_PROMPT,
  sectionOf,
  sectionRequest,
} from '../../src/extract';
import { INVENTORY, SOURCES, STAGES } from './support';

describe('the system prompt', () => {
  it('asks for a quote on every entry, forbids invention, and fixes the JSON shape', () => {
    expect(SYSTEM_PROMPT).toContain('Quote, never invent.');
    expect(SYSTEM_PROMPT).toContain('refuses an entry whose quote it cannot find');
    expect(SYSTEM_PROMPT).toContain('List only what the sources state.');
    expect(SYSTEM_PROMPT).toContain('Answer with one JSON object and nothing else');
    expect(SYSTEM_PROMPT).toContain('@example.com');
    expect(SYSTEM_PROMPT).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('sectionRequest', () => {
  const prepass = inventoryPrepass(INVENTORY, 'inventory.yaml');
  if (!prepass.ok) throw new Error('the test inventory is invalid');

  it('names the section on its first line, lists the allowed kinds and what is already proposed', () => {
    const request = sectionRequest('stages', SOURCES, prepass, 4000);
    expect(request.system).toBe(SYSTEM_PROMPT);
    expect(request.maxTokens).toBe(4000);
    const lines = request.user.split('\n');
    expect(lines[0]).toBe('SECTION: stages');
    expect(sectionOf(request.user)).toBe('stages');
    expect(request.user).toContain('Dimension kinds allowed in this section: stage.');
    expect(request.user).toContain('- behaviour (behaviour): The behaviours the inventory lists');
    expect(request.user).toContain('    B-001: Verify the customer before any balance');
  });

  it('carries every source in full between markers, without line numbers', () => {
    const request = sectionRequest('rules', SOURCES, prepass);
    expect(request.user).toContain(
      `<<<SOURCE prompt.md (prompt)\n${SOURCES[0]?.text.trimEnd()}\nSOURCE prompt.md>>>`,
    );
    expect(request.user).toContain('<<<SOURCE inventory.yaml (inventory)\n');
    expect(request.maxTokens).toBeUndefined();
  });

  it('gives the phrases section no dimension kind', () => {
    expect(SECTION_KINDS.phrases).toEqual([]);
    expect(sectionRequest('phrases', SOURCES, prepass).user).toContain('none (phrases only)');
    expect(SECTIONS).toEqual(['stages', 'rules', 'personas', 'data', 'phrases']);
  });

  it('reads no section from a message that does not start with one', () => {
    expect(sectionOf('hello')).toBeUndefined();
    expect(sectionOf('SECTION: dreams')).toBeUndefined();
  });
});

describe('parseAnswer', () => {
  it('reads a good answer', () => {
    const parsed = parseAnswer('stages', STAGES);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.answer.dimensions).toHaveLength(1);
      expect(parsed.answer.constraints).toEqual([]);
    }
  });

  it('reads JSON inside one code fence, or with words around it, and fills missing lists', () => {
    expect(parseAnswer('stages', `\`\`\`json\n${STAGES}\n\`\`\``).ok).toBe(true);
    expect(parseAnswer('stages', `Here is the map:\n${STAGES}\nThat is all.`).ok).toBe(true);
    const bare = parseAnswer('rules', '{"section":"rules"}');
    expect(bare.ok && bare.answer).toEqual({
      section: 'rules',
      dimensions: [],
      constraints: [],
      phrases: [],
    });
  });

  it('says why a malformed answer cannot be read', () => {
    const reason = (section: 'stages' | 'rules', text: string) => {
      const parsed = parseAnswer(section, text);
      return parsed.ok ? 'read' : parsed.reason;
    };
    expect(reason('stages', '')).toBe('the answer is empty');
    expect(reason('stages', '{"section": "stages", "dimensions": [}')).toMatch(/^the answer is not JSON/);
    expect(reason('stages', 'I found three stages: greet, verify and help.')).toMatch(
      /^the answer is not JSON/,
    );
    expect(reason('stages', '{"section":"rules"}')).toBe(
      'the answer is for the section "rules", not "stages"',
    );
    expect(reason('stages', '{"section":"stages","notes":"x"}')).toBe(
      'the answer does not have the agreed shape: unknown key notes',
    );
    expect(reason('stages', '{"section":"stages","dimensions":{}}')).toMatch(
      /^the answer does not have the agreed shape: dimensions/,
    );
    expect(reason('rules', '[1, 2]')).toMatch(/agreed shape/);
  });

  it('writes a retry note that carries the reason', () => {
    expect(retryNote('the answer is empty')).toBe(
      'Your previous answer could not be read: the answer is empty. Answer again with one JSON object in the shape given, and nothing else.',
    );
  });
});
