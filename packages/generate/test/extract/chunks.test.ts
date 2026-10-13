import { describe, expect, it } from 'vitest';
import { chunkSources, chunkText, extractMap, LISTED_VALUES, sectionRequest } from '../../src/extract';
import type { ModelPort } from '../../src/model/port';

describe('chunkText', () => {
  it('keeps a text under the threshold whole and cuts a longer one at line boundaries', () => {
    expect(chunkText('a\nb', 1, 100)).toEqual(['a\nb']);
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const chunks = chunkText(text, 60, 0);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.join('\n')).toBe(text);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(60);
  });
  it('prefers a blank line in the second half of a chunk', () => {
    const text = ['aaaa', 'bbbb', '', 'cccc', 'dddd', 'eeee', 'ffff'].join('\n');
    expect(chunkText(text, 20, 0)[0]).toBe('aaaa\nbbbb\n');
  });
});

describe('chunkSources', () => {
  it('puts short sources in every round and a chunk of the long prompt in each', () => {
    const rounds = chunkSources(
      [
        { kind: 'inventory', path: 'inv.yaml', text: 'x' },
        { kind: 'prompt', path: 'p.md', text: Array.from({ length: 30 }, (_, i) => `rule ${i}`).join('\n') },
      ],
      50,
      0,
    );
    expect(rounds.length).toBeGreaterThan(2);
    for (const round of rounds) {
      expect(round.some((source) => source.path === 'inv.yaml')).toBe(true);
      expect(round.filter((source) => source.path === 'p.md')).toHaveLength(1);
    }
  });
});

describe('extractMap on a long prompt', () => {
  it('asks one request per chunk, and merges the answers', async () => {
    const prompt = Array.from({ length: 2000 }, (_, i) => `Rule number ${i} must be kept.`).join('\n');
    const inventory =
      'behaviours:\n  - id: B-001\n    title: A thing\nflows:\n  - id: f1\n    title: A flow\n    behaviours: [B-001]\n';
    let calls = 0;
    const port: ModelPort = {
      family: 'test',
      async complete(request) {
        calls++;
        const section = /^SECTION: (\w+)/.exec(request.user)?.[1];
        const first = /Rule number (\d+) must be kept\./.exec(request.user)?.[0];
        const dimensions =
          section === 'rules' && first
            ? [
                {
                  id: 'rule',
                  title: 'Rules',
                  kind: 'behaviour',
                  values: [{ id: `R-${calls}`, title: first, source: 'prompt.md', quote: first }],
                },
              ]
            : [];
        return JSON.stringify({ section, dimensions, constraints: [], phrases: [], relations: [] });
      },
    };
    const result = await extractMap({
      agent: 'x',
      sources: [
        { kind: 'inventory', path: 'inventory.yaml', text: inventory },
        { kind: 'prompt', path: 'prompt.md', text: prompt },
      ],
      port,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const rules = result.sections.find((run) => run.section === 'rules');
    expect(rules?.status).toBe('done');
    expect(rules?.calls).toBeGreaterThan(3);
    expect(result.proposal.dimensions.find((d) => d.id === 'rule')?.values.length).toBe(rules?.calls);
  });

  it('keeps a constraint stated in a chunk before the chunk that proposes its values', async () => {
    const prompt = Array.from({ length: 2000 }, (_, i) => `Rule number ${i} must be kept.`).join('\n');
    const inventory =
      'behaviours:\n  - id: B-001\n    title: A thing\nflows:\n  - id: f1\n    title: A flow\n    behaviours: [B-001]\n';
    const quote = 'Rule number 5 must be kept.';
    const seen = new Map<string, number>();
    const port: ModelPort = {
      family: 'test',
      async complete(request) {
        const section = /^SECTION: (\w+)/.exec(request.user)?.[1] ?? '';
        const call = (seen.get(section) ?? 0) + 1;
        seen.set(section, call);
        const value = (id: string) => ({ id, title: id, source: 'prompt.md', quote });
        const dimensions =
          section === 'personas' && call === 2
            ? [
                { id: 'customer', title: 'Customer', kind: 'persona', values: [value('guest')] },
                { id: 'visit', title: 'Visit', kind: 'persona', values: [value('night')] },
              ]
            : [];
        const constraints =
          section === 'personas' && call === 1
            ? [
                {
                  forbid: { customer: 'guest', visit: 'night' },
                  reason: 'a guest never visits at night',
                  source: 'prompt.md',
                  quote,
                },
              ]
            : [];
        return JSON.stringify({ section, dimensions, constraints, phrases: [], relations: [] });
      },
    };
    const result = await extractMap({
      agent: 'x',
      sources: [
        { kind: 'inventory', path: 'inventory.yaml', text: inventory },
        { kind: 'prompt', path: 'prompt.md', text: prompt },
      ],
      port,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.proposal.constraints.map((constraint) => constraint.forbid)).toContainEqual({
      customer: 'guest',
      visit: 'night',
    });
    expect(result.refusals.filter((refusal) => /constraint/.test(refusal.entry))).toEqual([]);
  });

  describe('chunk context', () => {
    const rows = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => `| ${from + i} | Rule ${from + i} | all |`);
    const text = [
      '# Guide',
      '',
      '## Rules',
      '',
      '### Web',
      '',
      '| # | Rule | Applies to |',
      '|---|---|---|',
      ...rows(0, 30),
    ].join('\n');
    it('repeats the headings and the table header at the start of a later chunk', () => {
      const rounds = chunkSources([{ kind: 'prompt', path: 'p.md', text }], 200, 0);
      expect(rounds.length).toBeGreaterThan(2);
      const later = rounds[2]?.[0]?.text ?? '';
      expect(
        later.startsWith('# Guide\n## Rules\n### Web\n\n| # | Rule | Applies to |\n|---|---|---|\n'),
      ).toBe(true);
      for (const line of later.split('\n')) expect(text).toContain(line);
    });
    it('does not repeat a heading the chunk starts with', () => {
      const doc = [
        '# Guide',
        '## A',
        ...Array.from({ length: 30 }, (_, i) => `line ${i}`),
        '## B',
        ...Array.from({ length: 30 }, (_, i) => `more ${i}`),
      ].join('\n');
      const rounds = chunkSources([{ kind: 'prompt', path: 'p.md', text: doc }], 120, 0);
      const withB = rounds.map((round) => round[0]?.text ?? '').find((t) => t.includes('## B')) ?? '';
      expect(withB.split('## B').length).toBe(2);
    });
  });

  describe('updates that retire earlier rules', () => {
    it('are carried by every chunk that does not hold them', () => {
      const update = 'Update: the earlier rule on "refunds" no longer holds. Always refund within 5 days.';
      const text = [
        ...Array.from({ length: 60 }, (_, i) => `- Rule number ${i} must be kept.`),
        '',
        update,
      ].join('\n');
      const rounds = chunkSources([{ kind: 'prompt', path: 'p.md', text }], 200, 0);
      expect(rounds.length).toBeGreaterThan(3);
      const texts = rounds.map((round) => round[0]?.text ?? '');
      const clause = 'Update: the earlier rule on "refunds" no longer holds.';
      expect(texts.every((t) => t.includes(clause))).toBe(true);
      expect(texts.slice(0, -1).some((t) => t.includes('Always refund within 5 days.'))).toBe(false);
      expect(texts.at(-1)).toContain(update);
    });
  });

  describe('a question and its answer', () => {
    it('are never cut apart', () => {
      const lines = Array.from(
        { length: 40 },
        (_, i) => `Q${i}: may the agent refund early?\nA${i}: no, never.`,
      );
      const text = lines.join('\n');
      for (const max of [60, 71, 80, 100]) {
        const chunks = chunkText(text, max, 0);
        for (const chunk of chunks) {
          const ls = chunk.split('\n');
          expect(ls[ls.length - 1]).not.toMatch(/\?$/);
        }
        expect(chunks.join('\n')).toBe(text);
      }
    });
  });

  describe('the list of what is already proposed', () => {
    it('shows a long dimension in part, so a request stays within the context', () => {
      const values = Array.from({ length: 5000 }, (_, i) => ({
        id: `R-${i}`,
        title: `Rule ${i}`,
        evidence: { source: 'p.md', quote: 'q' },
        produced_by: 'model' as const,
      }));
      const dimensions = [
        {
          id: 'rule',
          title: 'Rules',
          kind: 'behaviour' as const,
          role: 'axis' as const,
          produced_by: 'model' as const,
          approved: false,
          values,
        },
      ];
      const { user } = sectionRequest('rules', [], { dimensions, constraints: [] });
      expect(user).toContain(`... and ${5000 - LISTED_VALUES} more values`);
      expect(user).not.toContain('R-4999');
      expect(user.length).toBeLessThan(10_000);
    });
  });
});
