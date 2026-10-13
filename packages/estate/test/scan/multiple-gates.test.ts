import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

async function gatesIn(line: string) {
  const root = await estate({
    'CLAUDE.md': `# Gates\n\n${line}\n`,
    'edit.md': '# Edit guide\n',
    'send.md': '# Send guide\n',
    'write.md': '# Write guide\n',
  });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms.filter((atom) => atom.kind === 'gate');
}

describe('multiple fixed-form gates on one line', () => {
  it('reads both occurrences of the same form with exact provenance', async () => {
    const line = 'Before editing: read `edit.md`; before sending: read `send.md`.';
    const gates = await gatesIn(line);
    expect(gates.map((gate) => gate.fields?.first)).toEqual(['edit.md', 'send.md']);
    for (const gate of gates) {
      expect(gate.provenance).toMatchObject({ startLine: 3, endLine: 3, quote: line });
    }
  });

  it('reads different forms in source order, not pattern order', async () => {
    const gates = await gatesIn(
      'Read `send.md` before sending; before editing: read `edit.md`; before writing, read `write.md`.',
    );
    expect(gates.map((gate) => gate.fields?.first)).toEqual(['send.md', 'edit.md', 'write.md']);
  });

  it('does not emit a second interpretation of an overlapping form', async () => {
    const gates = await gatesIn('Before editing: read `edit.md` before writing.');
    expect(gates).toHaveLength(1);
    expect(gates[0]?.fields?.trigger).toBe('editing');
  });

  it('keeps distinct ids for repeated declarations and has no regex state between scans', async () => {
    const line = 'Before editing: read `edit.md`; before editing: read `edit.md`.';
    for (let scan = 0; scan < 2; scan += 1) {
      const gates = await gatesIn(line);
      expect(gates).toHaveLength(2);
      expect(new Set(gates.map((gate) => gate.id)).size).toBe(2);
    }
  });
});
