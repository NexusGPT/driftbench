import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { plantedRoutes } from './support';

const FILES = {
  'CLAUDE.md': [
    '# Routing',
    '',
    '| When the user wants to | Load |',
    '|---|---|',
    '| reconcile an invoice with its order | `invoice-reconcile` |',
    '| audit the ledger for duplicates | the `ledger-auditor` agent |',
    '| know the weather | nothing here |',
    '',
  ].join('\n'),
  '.claude/skills/invoice-reconcile/SKILL.md':
    '---\nname: invoice-reconcile\ndescription: Reconcile a supplier invoice.\n---\n\n# Reconcile\n',
  '.claude/agents/ledger-auditor.md':
    '---\nname: ledger-auditor\ndescription: Audits the ledger.\n---\n\nYou audit the ledger.\n',
};

const SKILL = 'skill.invoice-reconcile.skill-invoice-reconcile';
const HELPER = 'subagent.ledger-auditor.helper-ledger-auditor';

describe('a routing table read by the pointer reader', () => {
  it('gives no route from a table without the reader: code reads the structure only', async () => {
    const root = await estate(FILES);
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'route' && atom.provenance.file === 'CLAUDE.md')).toEqual(
      [],
    );
  });

  it('builds a route from the request cell, its target cell and the skill or helper the labeler links', async () => {
    const root = await estate(FILES);
    const { map, pointer: scanned } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: plantedRoutes({
        'reconcile an invoice': ['route-skill', SKILL],
        'audit the ledger': ['route-helper', HELPER],
      }),
    });
    expect(scanned?.refusals).toEqual([]);
    const found = map.atoms.filter((atom) => atom.kind === 'route' && atom.provenance.file === 'CLAUDE.md');
    expect(found.map((atom) => [atom.title, atom.fields?.target, atom.fields?.targetKind])).toEqual([
      ['An ask to reconcile an invoice with its order loads invoice-reconcile', 'invoice-reconcile', 'skill'],
      ['An ask to audit the ledger for duplicates dispatches ledger-auditor', 'ledger-auditor', 'subagent'],
    ]);
    expect(found[0]?.situation).toBe('reconcile an invoice with its order');
    expect(found[0]?.evidence).toContainEqual({ type: 'skill_loaded', name: 'invoice-reconcile' });
    expect(found[1]?.evidence).toContainEqual({
      type: 'tool_called',
      label: 'Agent',
      input: { subagent_type: 'ledger-auditor' },
    });
    // The quote runs over the whole row: the request cell and the target cell.
    expect(found[0]?.provenance.quote).toBe('reconcile an invoice with its order | `invoice-reconcile`');
    // The edge from the route to the unit it loads is drawn from the target field, as for any route.
    expect(map.edges).toContainEqual({ from: found[0]?.id, to: SKILL, kind: 'route' });
  });

  it('drops a route link that names no skill of the estate, and builds no route from it', async () => {
    const root = await estate(FILES);
    const { map, pointer: scanned } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: plantedRoutes({ 'reconcile an invoice': ['route-skill', 'skill.zzz.nothing'] }),
    });
    expect(scanned?.dropped[0]).toMatch(/is not an atom the request listed for route-skill/);
    expect(map.atoms.some((atom) => atom.kind === 'route' && atom.provenance.file === 'CLAUDE.md')).toBe(
      false,
    );
  });
});

describe('a routing row that names two skills', () => {
  const TWO = {
    'CLAUDE.md': [
      '# Routing',
      '',
      '| When the user wants to | Load |',
      '|---|---|',
      '| open and close the day | `day-open` then `day-close` |',
      '',
    ].join('\n'),
    '.claude/skills/day-open/SKILL.md': '---\nname: day-open\ndescription: Opens.\n---\n\n# Open\n',
    '.claude/skills/day-close/SKILL.md': '---\nname: day-close\ndescription: Closes.\n---\n\n# Close\n',
  };

  const BOTH = ['skill.day-open.skill-day-open', 'skill.day-close.skill-day-close'];

  it('gives one route for each skill the labeler links, never only the first', async () => {
    const root = await estate(TWO);
    const { map, pointer: scanned } = await scanEstate({
      root,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: plantedRoutes({ 'open and close the day': ['route-skill', BOTH] }),
    });
    expect(scanned?.refusals).toEqual([]);
    const targets = map.atoms
      .filter((atom) => atom.kind === 'route' && atom.provenance.file === 'CLAUDE.md')
      .map((atom) => atom.fields?.target)
      .sort();
    expect(targets).toEqual(['day-close', 'day-open']);
    const routed = map.edges.filter((edge) => edge.kind === 'route').map((edge) => edge.to).sort();
    expect(routed).toEqual([...BOTH].sort());
  });
});
