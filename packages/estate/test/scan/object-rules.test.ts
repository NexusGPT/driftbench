import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { answer, estate, NOW } from '../support';

describe('registry rule objects', () => {
  describe.each(['CHECK-REGISTRY.json', 'CATALOGUE.json'])('%s', (file) => {
    it.each(['enforces', 'rules', 'gates'])('reads mixed strings and objects under %s', async (field) => {
      const root = await estate({
        'CLAUDE.md': '# Instructions\n',
        [`.claude/${file}`]: JSON.stringify(
          {
            checks: [
              {
                id: 'G1',
                guard: 'check.py',
                [field]: [{ id: 'R3' }, { quote: 'Read the guide' }, 'R5', 'Keep the draft unsent'],
              },
            ],
          },
          null,
          2,
        ),
      });
      const raw = await new ClaudeCodeReader().read(root);
      expect(raw.registry[0]?.enforces).toEqual([
        { id: 'R3' },
        { quote: 'Read the guide' },
        { id: 'R5' },
        { quote: 'Keep the draft unsent' },
      ]);
    });

    it('ignores malformed and blank objects without discarding valid neighbors', async () => {
      const root = await estate({
        'CLAUDE.md': '# Instructions\n',
        [`.claude/${file}`]: JSON.stringify(
          {
            checks: [
              {
                id: 'G1',
                guard: 'check.py',
                enforces: [
                  null,
                  5,
                  {},
                  [],
                  { id: 5 },
                  { quote: false },
                  { id: '' },
                  { quote: '  ' },
                  { metadata: { id: 'R7' } },
                  { id: 'R3' },
                  { quote: 'R5' },
                  'R8',
                ],
              },
            ],
          },
          null,
          2,
        ),
      });
      const raw = await new ClaudeCodeReader().read(root);
      expect(raw.registry[0]?.enforces).toEqual([{ id: 'R3' }, { quote: 'R5' }, { id: 'R8' }]);
    });
  });

  it('retains a keyed entry and its provenance', async () => {
    const root = await estate({
      'CLAUDE.md': '# Instructions\n',
      '.claude/CATALOGUE.json': JSON.stringify(
        { catalogue: { checks: { G1: { hook: 'check.py', rules: [{ id: 'R3' }] } } } },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry).toHaveLength(1);
    expect(raw.registry[0]).toMatchObject({ id: 'G1', guard: 'check.py', enforces: [{ id: 'R3' }] });
    expect(raw.registry[0]?.at.quote).toContain('"G1":');
  });

  it('retains the inherited event and declared verdict', async () => {
    const root = await estate({
      'CLAUDE.md': '# Instructions\n',
      '.claude/CHECK-REGISTRY.json': JSON.stringify(
        { PreToolUse: [{ id: 'G1', guard: 'check.py', verdict: 'deny', enforces: [{ id: 'R3' }] }] },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry[0]).toMatchObject({
      event: 'PreToolUse',
      verdict: 'deny',
      enforces: [{ id: 'R3' }],
    });
  });

  it('creates enforcement edges for an object label and an object passage only', async () => {
    const root = await estate({
      'CLAUDE.md':
        '# Rules\n\n- **R1.** Keep the draft unsent.\n- **R2.** Always log the run.\n- **R3.** Read the guide first.\n',
      '.claude/settings.json': JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'sh .claude/guards/g.sh' }] }],
        },
      }),
      '.claude/guards/g.sh': '#!/bin/sh\nexit 0\n',
      '.claude/CHECK-REGISTRY.json': JSON.stringify(
        { checks: [{ id: 'G1', guard: 'g.sh', enforces: [{ id: 'R1' }, { quote: 'Always log the run.' }] }] },
        null,
        2,
      ),
    });
    const port = new FakeModelPort([
      answer('CLAUDE.md', [
        {
          kind: 'instruction',
          title: 'No send',
          quote: 'Keep the draft unsent.',
          evidence: [{ type: 'custom', name: 'unsent' }],
        },
        {
          kind: 'instruction',
          title: 'Log',
          quote: 'Always log the run.',
          evidence: [{ type: 'custom', name: 'log' }],
        },
        {
          kind: 'instruction',
          title: 'Guide',
          quote: 'Read the guide first.',
          evidence: [{ type: 'custom', name: 'guide' }],
        },
      ]),
    ]);
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port, now: NOW });
    const enforced = map.atoms.filter((atom) => atom.enforcement.length > 0).map((atom) => atom.title);
    expect(enforced.sort()).toEqual(['Log', 'No send']);
    expect(map.atoms.find((atom) => atom.kind === 'guard')?.fields?.enforces).toEqual([
      { atom: 'instruction.standing.no-send', by: 'registry' },
      { atom: 'instruction.standing.log', by: 'registry' },
    ]);
    expect(map.edges.filter((edge) => edge.kind === 'enforces')).toHaveLength(2);
  });
});
