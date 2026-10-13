import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

const row = { id: 'G1', guard: 'check.py', enforces: ['R3'] };
describe('registry entry containers', () => {
  it.each([
    ['guards', { guards: [row] }],
    ['keyed', { G1: { hook: 'check.py', rules: ['R3'] } }],
    ['event', { PreToolUse: [row] }],
    ['wrapper', { version: 2, catalogue: { checks: [row] } }],
    ['checks', { checks: [row] }],
  ])('reads the %s container', async (_name, registry) => {
    const root = await estate({
      'CLAUDE.md': '# Instructions\n',
      '.claude/CATALOGUE.json': JSON.stringify(registry, null, 2),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry).toHaveLength(1);
    expect(raw.registry[0]).toMatchObject({ id: 'G1', guard: 'check.py', enforces: [{ id: 'R3' }] });
    expect(raw.registry[0]?.at.quote).toContain('G1');
  });
  it('does not search unrelated nested metadata for registry entries', async () => {
    const root = await estate({
      'CLAUDE.md': '# Instructions\n',
      '.claude/CATALOGUE.json': JSON.stringify({ checks: [row], metadata: { example: row } }, null, 2),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry).toHaveLength(1);
  });
  it('retains the containing event when the entry has none', async () => {
    const root = await estate({
      'CLAUDE.md': '# Instructions\n',
      '.claude/CATALOGUE.json': JSON.stringify({ PreToolUse: [row] }, null, 2),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry[0]?.event).toBe('PreToolUse');
  });
  it('preserves an explicit entry event over its containing group', async () => {
    const root = await estate({
      'CLAUDE.md': '# Instructions\n',
      '.claude/CATALOGUE.json': JSON.stringify({ PreToolUse: [{ ...row, event: 'Stop' }] }, null, 2),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry[0]?.event).toBe('Stop');
  });
});
