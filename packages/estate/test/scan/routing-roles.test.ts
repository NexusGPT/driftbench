import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { routingRoleCorpus, routingRoleDeclarations } from './routing-role-corpus';

describe('table column roles come from their content and metadata relationships', () => {
  it.each(routingRoleCorpus)('$name', async ({ table, routes }) => {
    const root = await estate({ ...routingRoleDeclarations, 'CLAUDE.md': table });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const actual = map.atoms.filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table');
    expect(actual.map((atom) => [atom.fields?.ask, atom.fields?.target, atom.fields?.targetKind])).toEqual(
      routes,
    );
    for (const atom of actual)
      expect(table.split('\n')[atom.provenance.startLine - 1]).toBe(atom.provenance.quote);
  });
});
