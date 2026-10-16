import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { mainRouteDeclarations, mainRoutingCorpus } from './routing-main-corpus';

describe('main-based routing precision', () => {
  it.each(mainRoutingCorpus)('$name', async ({ table, routes: expected, ambiguous }) => {
    const root = await estate({ ...mainRouteDeclarations, 'CLAUDE.md': table });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const routes = map.atoms.filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table');
    expect(routes.map((atom) => [atom.fields?.ask, atom.fields?.target])).toEqual(expected);
    expect(raw.notes.some((note) => note.message.startsWith('Ambiguous routing table'))).toBe(ambiguous);
    for (const atom of routes)
      expect(table.split('\n')[atom.provenance.startLine - 1]).toBe(atom.provenance.quote);
  });
  it.each(mainRoutingCorpus)(
    'header labels do not change precision: $name',
    async ({ table, routes: expected, ambiguous }) => {
      const text = table.replace(/^[^\n]+/, table.split('\n')[0]?.replace(/[^|]+/g, ' λ ') ?? '');
      const root = await estate({ ...mainRouteDeclarations, 'CLAUDE.md': text });
      const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
      expect(
        map.atoms
          .filter((atom) => atom.kind === 'route' && atom.fields?.via === 'table')
          .map((atom) => [atom.fields?.ask, atom.fields?.target]),
      ).toEqual(expected);
      expect(raw.notes.some((note) => note.message.startsWith('Ambiguous routing table'))).toBe(ambiguous);
    },
  );
});
