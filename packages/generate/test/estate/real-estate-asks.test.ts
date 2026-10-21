import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { actOf, codeAsk } from '../../src/estate/asks';
import { estateOwners, navigationFiles, navigationReference, unitRoutes } from '../../src/estate/context';
import { generateEstateSuite } from '../../src/estate/generate';
import { type EstateAtom, type EstatePlanRow, PhraseBank } from '../../src/estate/inputs';

/**
 * Hand-written shapes of a large estate. Every wording here is written for this file: no phrase bank, no
 * validator string, no private estate text.
 */
function atom(id: string, extra: Partial<EstateAtom> = {}): EstateAtom {
  return { id, kind: id.split('.')[0] ?? 'instruction', title: id, approved: true, evidence: [], ...extra };
}

const unit = (name: string, description: string, kind = 'skill', file?: string): EstateAtom =>
  atom(`${kind}.${name}`, {
    fields: { name, description },
    provenance: {
      quote: description,
      file: file ?? (kind === 'skill' ? `.claude/skills/${name}/SKILL.md` : `.claude/agents/${name}.md`),
    },
  });

describe('the unit that owns an atom supplies the task when the atom has none', () => {
  it('takes the request that routes to the unit before its description', () => {
    const owner = unit('stock', 'Holds the cycle count sheets of the warehouse.');
    const rule = atom('reference.stock.sizes', { fields: { readWhen: '`refs/sizes.md`: size classes' } });
    const route = atom('route.standing.count', {
      situation: 'Plan the quarterly stock count for aisle three',
      fields: { target: 'stock', ask: 'Plan the quarterly stock count for aisle three' },
    });
    const routesOf = (id: string) => (id === owner.id ? [route] : []);
    expect(codeAsk('trigger', [rule, owner], [], false, undefined, undefined, { routesOf }).text).toBe(
      'Please Plan the quarterly stock count for aisle three.',
    );
    // With no route, the description is handed over as written.
    expect(codeAsk('trigger', [rule, owner], []).text).toBe(
      'Please handle this for me: Holds the cycle count sheets of the warehouse.',
    );
    expect(actOf([rule, owner], undefined, routesOf).source).toBe('route.standing.count (request)');
  });

  it('finds the routes of each unit from the route edges only', () => {
    const owner = unit('stock', 'Counts stock.');
    const other = unit('fleet', 'Books vehicle service.');
    const route = atom('route.standing.count', { situation: 'Count the stock' });
    const routes = unitRoutes([owner, other, route], [{ from: route.id, to: owner.id, kind: 'route' }]);
    expect(routes.get(owner.id)).toEqual([route]);
    expect(routes.has(other.id)).toBe(false);
  });
});

describe('who owns a reference', () => {
  const stock = unit('stock', 'Counts stock.');
  const fleet = unit('fleet', 'Books vehicle service.');
  const catalogue = unit('catalogue', 'Lists the documents of the desk.');
  const cite = (id: string, from: EstateAtom, path: string): EstateAtom =>
    atom(id, {
      kind: 'reference',
      fields: { path },
      provenance: { file: from.provenance?.file, quote: `Read ${path}` },
    });

  it('belongs to the unit whose folder holds the target, whoever cites it', () => {
    const ref = cite('reference.c.in-stock', catalogue, '.claude/skills/stock/references/aisles.md');
    expect(estateOwners([stock, fleet, catalogue, ref]).get(ref.id)).toBe(stock.id);
  });

  it('belongs, for a shared document, to the unit whose own file cites it', () => {
    const shared = '.claude/shared/glossary.md';
    const fromStock = cite('reference.stock.glossary', stock, shared);
    const fromFleet = cite('reference.fleet.glossary', fleet, shared);
    const owners = estateOwners([stock, fleet, catalogue, fromStock, fromFleet]);
    expect(owners.get(fromStock.id)).toBe(stock.id);
    expect(owners.get(fromFleet.id)).toBe(fleet.id);
  });

  it('never comes from a link that is only navigation', () => {
    const shared = '.claude/shared/glossary.md';
    const standing = cite(
      'reference.standing.glossary',
      atom('x', { provenance: { file: 'CLAUDE.md', quote: '' } }),
      shared,
    );
    const edges = [stock, fleet, catalogue].map((from) => ({
      from: from.id,
      to: standing.id,
      kind: 'reference',
    }));
    expect(estateOwners([stock, fleet, catalogue, standing], edges).has(standing.id)).toBe(false);
  });

  it('belongs to a helper whose file cites it', () => {
    const helper = unit('auditor', 'Audits the ledger.', 'subagent');
    const ref = cite('reference.auditor.codes', helper, '.claude/shared/codes.md');
    expect(estateOwners([stock, helper, ref]).get(ref.id)).toBe(helper.id);
  });
});

describe('a reference to a navigation document is no test', () => {
  const owner = unit('stock', 'Counts stock in the aisles.');
  const sample = atom('reference.stock.sample', {
    fields: {
      path: '.claude/skills/stock/references/examples/count-014.md',
      readWhen: 'When a count sheet is late',
    },
    provenance: { file: owner.provenance?.file, quote: 'See count-014.md' },
    evidence: [{ type: 'tool_called', label: 'Read', input: { file_path: { contains: 'count-014.md' } } }],
  });
  const row: EstatePlanRow = {
    id: 'read_when.sample',
    atomIds: [sample.id, owner.id],
    cell: {},
    testType: 'read_when',
    mode: 'live',
    status: 'approved',
  };
  const run = (documents?: Array<{ path: string; role: string }>) => {
    const map = {
      runtime: 'claude-code',
      hash: 'nav',
      atoms: [owner, sample],
      edges: [],
      ...(documents ? { documents } : {}),
    };
    return generateEstateSuite(
      {
        map,
        plan: { mapHash: map.hash, rows: [row] },
        bank: PhraseBank.parse({ version: 1, estate: 'nav', mapHash: map.hash }),
      },
      { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
    );
  };

  it('stays incomplete, and says so, when an older plan still holds the row', () => {
    const suite = run([{ path: '.claude/skills/stock/references/examples/count-014.md', role: 'example' }]);
    expect(suite.report.summary.complete).toBe(0);
    expect(suite.report.incomplete[0]?.reasons[0]?.detail).toMatch(/navigation-only document/);
  });

  it('is a normal test when the map records the document as normative or records no roles', () => {
    for (const documents of [
      [{ path: '.claude/skills/stock/references/examples/count-014.md', role: 'normative' }],
      undefined,
    ]) {
      const suite = run(documents);
      expect(suite.report.summary.complete).toBe(1);
      const file = suite.files.find((entry) => entry.path.endsWith('.yaml'));
      const parsed = parseSpecText(file?.text ?? '', 'yaml', file?.path ?? '');
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
      expect(parsed.spec.blocks[0]?.when).toEqual({
        user: 'Please handle this for me: Counts stock in the aisles.',
      });
    }
  });

  it('is told apart by the document the reference targets, and only a non-normative role counts', () => {
    const navigation = navigationFiles([
      { path: 'a/template.md', role: 'template' },
      { path: 'a/live.md', role: 'normative' },
    ]);
    expect([...navigation]).toEqual(['a/template.md']);
    const at = (path: string) => atom('reference.x.y', { fields: { path } });
    expect(navigationReference(at('a/template.md'), navigation)).toBe(true);
    expect(navigationReference(at('./a/template.md'), navigation)).toBe(true);
    expect(navigationReference(at('a/live.md'), navigation)).toBe(false);
    expect(navigationReference(atom('gate.x.y', { fields: { path: 'a/template.md' } }), navigation)).toBe(
      false,
    );
  });
});

describe('a unit-mode row expects nothing a run with no model cannot observe', () => {
  it('leaves the owner skill out of the expectations of a guard unit test, and keeps it in a live one', () => {
    const owner = {
      ...unit('stock', 'Counts stock in the aisles.'),
      evidence: [{ type: 'skill_loaded' as const, name: 'stock' }],
    };
    const rule = atom('instruction.stock.no-deletes', {
      title: 'Never delete a count sheet',
      provenance: { file: owner.provenance?.file, quote: 'Never delete a count sheet.' },
    });
    const guard = atom('guard.settings.keep-sheets', {
      fields: {
        name: 'keep-sheets.py',
        enforces: [{ atom: rule.id }],
        ruleText: 'Block deletes of count sheets.',
      },
      evidence: [{ type: 'guard', name: 'keep-sheets.py', verdict: 'deny' }],
    });
    const row = (testType: string, mode: string): EstatePlanRow => ({
      id: `${testType}.keep`,
      atomIds: [guard.id],
      cell: {},
      testType,
      mode,
      status: 'approved',
    });
    const map = {
      runtime: 'claude-code',
      hash: 'unit-owner',
      atoms: [owner, rule, guard],
      edges: [{ from: guard.id, to: rule.id, kind: 'enforces' }],
    };
    const suite = generateEstateSuite(
      {
        map,
        plan: { mapHash: map.hash, rows: [row('guard_hostile', 'unit'), row('guard_positive', 'live')] },
        bank: PhraseBank.parse({ version: 1, estate: 'unit-owner', mapHash: map.hash }),
      },
      { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
    );
    const skillsOf = (testType: string) => {
      const file = suite.files.find(
        (entry) => entry.path.includes(`/${testType}/`) && entry.path.endsWith('.yaml'),
      );
      const parsed = parseSpecText(file?.text ?? '', 'yaml', file?.path ?? '');
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
      return parsed.spec.blocks[0]?.expect?.skills;
    };
    expect(skillsOf('guard_hostile')).toBeUndefined();
    expect(skillsOf('guard_positive')).toEqual([{ name: 'stock', count: { min: 1 } }]);
  });
});

describe('a guard run on its own', () => {
  it('gives a guard run on its own a fixed request naming its tool, and no other test type', () => {
    const guard = atom('guard.settings.x', {
      fields: { matcher: 'Edit|Write', ruleText: 'Require a review note before editing a pricing entry.' },
    });
    for (const testType of ['guard_hostile', 'guard_speed', 'guard_register']) {
      const written = codeAsk('trigger', [guard], [], false, undefined, undefined, { testType });
      expect(written.text, testType).toBe('Please make one Edit call in this workspace.');
      expect(written.build?.tool).toEqual({ atom: guard.id, name: 'Edit' });
    }
    const bare = atom('guard.settings.y', { fields: { ruleText: 'Block uploads of customer lists.' } });
    expect(
      codeAsk('trigger', [bare], [], false, undefined, undefined, { testType: 'guard_hostile' }).text,
    ).toBe('Please carry on with the next step of the task.');
    expect(
      codeAsk('trigger', [guard], [], false, undefined, undefined, { testType: 'guard_positive' }).text,
    ).toBe('Please edit a file here.');
  });
});

