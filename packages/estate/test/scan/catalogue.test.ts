import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { CASES } from './cases';

const RULES = [
  '# Rules',
  '',
  '- **R1.** Ask at most one question per reply.',
  '- **R2.** Never promise a refund date to the user.',
  '- **R3.** Report a number only when you read it in a file.',
  '',
].join('\n');

/** A port that answers the standing chunk with its three rules, and nothing else. */
const RULE_PORT = {
  family: 'test',
  model: 'by hand',
  async complete() {
    const rule = (title: string, quote: string) => ({
      kind: 'instruction',
      title,
      quote,
      evidence: [{ type: 'tool_not_called', label: 'Write' }],
    });
    return JSON.stringify({
      chunk: 'CLAUDE.md',
      atoms: [
        rule('One question', 'Ask at most one question per reply.'),
        rule('No refund date', 'Never promise a refund date to the user.'),
        rule('Read numbers', 'Report a number only when you read it in a file.'),
      ],
    });
  },
};

describe('a catalogue of checks', () => {
  it('reads an array of entries as guards with their state, kind, work, steps and watched rules', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/hooks/lib/checks.py': 'CHECKS = ["K1"]\n',
      '.claude/hooks/CATALOGUE.json': JSON.stringify(
        [
          {
            id: 'K1',
            kind: 'check',
            event: 'Stop',
            watches: ['R1'],
            work: 'lib/checks.py',
            step: ['reply'],
            status: 'enforce',
          },
          {
            id: 'K2',
            kind: 'judge',
            event: 'Stop',
            watches: 'Never promise a refund date',
            status: 'observe',
          },
          { id: 'K3', kind: 'nudge', watches: ['R3'], status: 'off' },
        ],
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.find((file) => file.path === '.claude/hooks/CATALOGUE.json')?.kind).toBe('registry');
    expect(
      raw.guards.map((guard) => [
        guard.check?.id,
        guard.event,
        guard.scope,
        guard.check?.kind,
        guard.check?.state,
        guard.script ?? '',
        guard.check?.steps,
      ]),
    ).toEqual([
      ['K1', 'Stop', 'catalogue', 'check', 'enforce', '.claude/hooks/lib/checks.py', ['reply']],
      ['K2', 'Stop', 'catalogue', 'judge', 'observe', '', []],
      ['K3', 'any', 'catalogue', 'nudge', 'off', '', []],
    ]);
    expect(raw.registry.map((row) => [row.id, row.origin, row.enforces])).toEqual([
      ['K1', 'catalogue', [{ id: 'R1' }]],
      ['K2', 'catalogue', [{ quote: 'Never promise a refund date' }]],
      ['K3', 'catalogue', []],
    ]);
    expect(raw.guards[0]?.at).toEqual({
      file: '.claude/hooks/CATALOGUE.json',
      startLine: 3,
      endLine: 3,
      quote: '"id": "K1",',
    });

    const { map, analysis } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      port: RULE_PORT,
      now: NOW,
    });
    const guards = map.atoms.filter((atom) => atom.kind === 'guard');
    expect(guards.map((guard) => [guard.id, guard.fields?.state, guard.evidence])).toEqual([
      ['guard.registry.stop-guard-k1', 'enforce', [{ type: 'guard', name: 'K1' }]],
      ['guard.registry.stop-guard-k2', 'observe', [{ type: 'guard', name: 'K2' }]],
      ['guard.registry.any-guard-k3', 'off', [{ type: 'guard', name: 'K3' }]],
    ]);
    const enforced = Object.fromEntries(
      map.atoms.filter((atom) => atom.kind === 'instruction').map((atom) => [atom.title, atom.enforcement]),
    );
    expect(enforced).toEqual({
      'One question': ['guard.registry.stop-guard-k1'],
      'No refund date': ['guard.registry.stop-guard-k2'],
      'Read numbers': [],
    });
    expect(analysis.orphans).toEqual([]);
    expect(
      lintEstate(map, (await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW })).raw).counts,
    ).toMatchObject({ REGISTRY_ROW: 0, REGISTRY_GUARD: 0, UNANCHORED_GUARD: 0, ORPHAN: 0 });
  });

  it('reads a map of ids to entries, and is not fooled by a JSON file that merely has a kind', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/checks.json': JSON.stringify({ K7: { event: 'Stop', status: 'enforce', watches: ['R1'] } }),
      '.claude/notes.json': JSON.stringify({ kind: 'note', text: 'hello' }),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.files.map((file) => [file.path, file.kind])).toEqual([
      ['CLAUDE.md', 'standing'],
      ['.claude/checks.json', 'registry'],
      ['.claude/notes.json', 'other'],
    ]);
    expect(raw.guards.map((guard) => [guard.check?.id, guard.at.quote])).toEqual([
      ['K7', '{"K7":{"event":"Stop","status":"enforce","watches":["R1"]}}'],
    ]);
  });

  it('lets a registry table name a catalogue check by its id', async () => {
    const raw = await new ClaudeCodeReader().read(CASES);
    expect(
      raw.guards.filter((guard) => guard.check).map((guard) => [guard.check?.id, guard.check?.state]),
    ).toEqual([
      ['C1', 'enforce'],
      ['C2', 'observe'],
      ['C3', 'off'],
    ]);
    expect(
      raw.registry.filter((row) => row.id === 'C2').map((row) => [row.guard, row.origin ?? 'table']),
    ).toEqual([
      ['C2', 'catalogue'],
      ['C2', 'table'],
    ]);
  });

  it('reads a check once across catalogue files, with its trigger material and the hook script that holds it', async () => {
    const root = await estate({
      'CLAUDE.md': RULES,
      '.claude/settings.json': JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/pre.py' }],
            },
          ],
        },
      }),
      '.claude/hooks/pre.py': 'import sys\n# K1: refuse a swallowed stderr\nsys.exit(0)\n',
      '.claude/hooks/CATALOGUE.json': JSON.stringify({
        K1: {
          kind: 'check',
          event: 'PreToolUse (Bash)',
          watches: 'a command ending in `2>/dev/null` or `|| true`',
          status: 'enforce',
        },
        K2: { kind: 'check', event: 'Stop', watches: 'a reply that promises a date', status: 'enforce' },
      }),
      '.claude/hooks/tools/catalogue-tags.json': JSON.stringify({
        K1: { kind: 'check', event: 'PreToolUse (Bash)', status: 'enforce', tagged: 'io' },
      }),
    });
    const raw = await new ClaudeCodeReader().read(root);
    const checks = raw.guards.filter((guard) => guard.scope === 'catalogue');
    expect(checks.map((guard) => [guard.check?.id, guard.check?.trigger, guard.check?.host])).toEqual([
      ['K1', ['2>/dev/null', '|| true'], '.claude/hooks/pre.py'],
      ['K2', [], undefined],
    ]);
    expect(raw.notes.map((note) => note.message)).toContain(
      'a later catalogue repeats 1 check an earlier one holds; it is read once',
    );
  });
});
