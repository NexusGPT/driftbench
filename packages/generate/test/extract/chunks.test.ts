import { describe, expect, it } from 'vitest';
import { chunkSources, chunkText, extractMap } from '../../src/extract';
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
      expect(texts.every((t) => t.includes(update))).toBe(true);
      expect(texts.at(-1)?.split(update).length).toBe(2);
    });
  });
});
