import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src/index';
import { estate } from '../support';

describe('one string of registry rules', () => {
  it.each(['CHECK-REGISTRY.json', 'CATALOGUE.json'])(
    'reads a comma-separated declaration in %s',
    async (file) => {
      const root = await estate({
        'CLAUDE.md': '# Instructions\n',
        [`.claude/${file}`]: JSON.stringify(
          { checks: [{ id: 'G1', guard: 'check.py', rules: 'R3, R5' }] },
          null,
          2,
        ),
      });
      const raw = await new ClaudeCodeReader().read(root);
      expect(raw.registry[0]?.enforces).toEqual([{ id: 'R3' }, { id: 'R5' }]);
    },
  );
  it.each(['CHECK-REGISTRY.json', 'CATALOGUE.json'])('keeps an array declaration in %s', async (file) => {
    const root = await estate({
      'CLAUDE.md': '# Instructions\n',
      [`.claude/${file}`]: JSON.stringify(
        { checks: [{ id: 'G1', guard: 'check.py', enforces: ['R3', 'R5'] }] },
        null,
        2,
      ),
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.registry[0]?.enforces).toEqual([{ id: 'R3' }, { id: 'R5' }]);
  });
  it.each(['CHECK-REGISTRY.json', 'CATALOGUE.json'])(
    'preserves an unlabelled passage in %s',
    async (file) => {
      const passage = 'Read the guide before editing';
      const root = await estate({
        'CLAUDE.md': '# Instructions\n',
        [`.claude/${file}`]: JSON.stringify(
          { checks: [{ id: 'G1', guard: 'check.py', enforces: passage }] },
          null,
          2,
        ),
      });
      const raw = await new ClaudeCodeReader().read(root);
      expect(raw.registry[0]?.enforces).toEqual([{ quote: passage }]);
    },
  );
});
