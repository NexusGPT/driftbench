import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

describe('context compaction names', () => {
  it.each([
    'Long runs see compactions; save the invoice summary.',
    'When the conversation is summarized to save space, reopen the invoice.',
    'When the context window fills up, save the invoice first.',
    'When the conversation is summarised, reread the invoice.',
    'The supplier conversation is summarized for a report; then our context window fills up.',
  ])('reads the runtime event in %s', async (line) => {
    const root = await estate({ 'CLAUDE.md': `# Instructions\n${line}` });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'hazard')).toMatchObject([
      { fields: { hazard: 'compaction' }, provenance: { quote: line } },
    ]);
  });
  it('does not treat ordinary summaries or compact objects as compaction', async () => {
    const root = await estate({
      'CLAUDE.md':
        '# Instructions\nKeep the summary table compact.\nSummarize the supplier conversation for the report.\nThe compactor in the yard needs servicing.',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'hazard')).toEqual([]);
  });
  it('keeps summaries of an explicit outside owner separate from assistant compaction', async () => {
    const root = await estate({
      'CLAUDE.md':
        '# Instructions\nThe supplier conversation is summarized for the report.\nWhen the client context window fills up, archive the report.',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((a) => a.kind === 'hazard')).toEqual([]);
  });
});
