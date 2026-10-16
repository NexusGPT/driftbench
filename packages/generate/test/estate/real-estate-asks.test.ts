import { parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { actOf, codeAsk, imperative, OUTSIDE_ASK, ruleTopic } from '../../src/estate/asks';
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
  it('reads a description in the third person for a verb outside any list', () => {
    const cases: Array<[string, string]> = [
      [
        'Handles customer complaints and logs the outcome.',
        'Please handle customer complaints and log the outcome.',
      ],
      [
        'Onboards a new vendor and collects their tax forms.',
        'Please onboard a new vendor and collect their tax forms.',
      ],
      [
        'Proofreads a customer notice for tone and missing facts.',
        'Please proofread a customer notice for tone and missing facts.',
      ],
      ['Balances the pool of crates between depots.', 'Please balance the pool of crates between depots.'],
      [
        'Totals the driver hours and returns a payroll file.',
        'Please total the driver hours and return a payroll file.',
      ],
    ];
    for (const [description, ask] of cases) {
      expect(codeAsk('trigger', [unit('x', description)], []).text, description).toBe(ask);
    }
  });

  it('asks for the work a description names, not its examples, its purpose or its own behaviour', () => {
    const cases: Array<[string, string]> = [
      [
        'Reconciles carrier invoices (paper, EDI, portal exports) against delivery receipts so that a payment run starts clean.',
        'Please reconcile carrier invoices against delivery receipts.',
      ],
      [
        'Plans courier pickups for the docks, which writes a verdict file per run.',
        'Please plan courier pickups for the docks.',
      ],
      [
        'Files damage claims with carriers (see the claims folder).',
        'Please file damage claims with carriers.',
      ],
      // A head that would be left without a verb and its object keeps the whole sentence.
      ['Audits it so that nothing leaks.', 'Please audit it so that nothing leaks.'],
    ];
    for (const [description, ask] of cases) {
      expect(codeAsk('trigger', [unit('x', description)], []).text, description).toBe(ask);
    }
  });

  it('takes the moment of a read-when table row from its own cell, and the task from a cell that states one', () => {
    const owner = unit('apps', 'Builds and deploys hosted apps for the office.');
    const row = (readWhen: string) => atom('reference.apps.x', { fields: { readWhen } });
    // A cell that is a task is the ask itself.
    expect(codeAsk('trigger', [row('Publishing the weekly report | `refs/db.md`'), owner], []).text).toBe(
      'Please publish the weekly report.',
    );
    // An activity of two words rides as the moment; the unit's work stays the task.
    expect(codeAsk('trigger', [row('Designing screens | `refs/ux.md`'), owner], []).text).toBe(
      'Please build and deploy hosted apps for the office. Designing screens.',
    );
    // A noun pair names the content of a file, not a moment.
    expect(codeAsk('trigger', [row('`refs/ux.md` | layout rules'), owner], []).text).toBe(
      'Please build and deploy hosted apps for the office.',
    );
  });

  it('reads the route request of a unit in the third person as well', () => {
    const route = atom('route.x.ledger', {
      situation: 'Checks a ledger extract for duplicate payments and returns findings.',
    });
    expect(codeAsk('trigger', [route], []).text).toBe(
      'Please check a ledger extract for duplicate payments and return findings.',
    );
  });

  it('keeps a noun that is followed by a function word, and a verb that states what a unit holds, as no task', () => {
    for (const description of [
      'Rules for the warehouse layout and the pallet racks.',
      'Tables of carrier rates and surcharges.',
      'Holds the open orders of the week so a session can resume them.',
      'Provides the shared glossary of the desk.',
      'Customers return parcels through this desk.',
    ]) {
      const ask = codeAsk('trigger', [unit('x', description)], []);
      expect(ask.text, description).toBeUndefined();
      expect(ask.refused, description).toMatch(/describes the unit/);
    }
  });

  it('does not read a possessive or a plural noun with a noun ending as a verb', () => {
    for (const description of [
      "File's frame, exit 1.",
      'Analytics response shapes for the dashboard.',
      'Logistics partner contacts and escalation paths.',
    ]) {
      const ask = codeAsk('trigger', [unit('x', description)], []);
      expect(ask.text, description).toBeUndefined();
      expect(ask.refused, description).toMatch(/describes the unit/);
    }
  });

  it('keeps a pasted rule or a long fragment out of the situation of a read-when line', () => {
    const owner = unit('stock', 'Counts stock in the aisles.');
    const row = (readWhen: string) => atom('reference.stock.x', { fields: { readWhen } });
    for (const readWhen of [
      'The yard office has to confirm every dock slot of the week in writing with the dock lead and the carrier desk and the roster owner | `refs/a.md`',
      'You must always close the count with the yard office | `refs/a.md`',
    ]) {
      expect(codeAsk('trigger', [row(readWhen), owner], []).text, readWhen).toBe(
        'Please count stock in the aisles.',
      );
    }
  });

  it('does not turn a coordinated noun into a verb', () => {
    expect(imperative('Reconciles invoices and returns')).toBe('reconcile invoices and returns');
    expect(imperative('Reconciles invoices and returns for the depot')).toBe(
      'reconcile invoices and returns for the depot',
    );
    expect(imperative('Checks a ledger and returns findings')).toBe('check a ledger and return findings');
    expect(imperative('Audits the ledger for payments and invoices paid twice')).toBe(
      'audit the ledger for payments and invoices paid twice',
    );
    expect(imperative('Lists the documents and skills of the desk')).toBe(
      'list the documents and skills of the desk',
    );
    expect(imperative('Sort the inbox and archives items')).toBe('sort the inbox and archives items');
  });

  it('falls back to the request that routes to the unit when its description names no task', () => {
    const owner = unit('stock', 'Holds the cycle count sheets of the warehouse.');
    const rule = atom('reference.stock.sizes', { fields: { readWhen: '`refs/sizes.md`: size classes' } });
    const route = atom('route.standing.count', {
      situation: 'Plan the quarterly stock count for aisle three',
      fields: { target: 'stock' },
    });
    const routesOf = (id: string) => (id === owner.id ? [route] : []);
    expect(codeAsk('trigger', [rule, owner], [], false, undefined, undefined, { routesOf }).text).toBe(
      'Please plan the quarterly stock count for aisle three.',
    );
    expect(codeAsk('trigger', [rule, owner], []).refused).toMatch(/describes the unit/);
    expect(actOf([rule, owner], undefined, routesOf).source).toBe('route.standing.count (situation)');
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

describe('a helper-owned prerequisite asks for the work to be handed to a helper', () => {
  const helper = unit('auditor', 'Audits the ledger extract for duplicate payments.', 'subagent');
  const ref = atom('reference.auditor.codes', {
    fields: { path: '.claude/shared/codes.md', readWhen: '`.claude/shared/codes.md`: code list' },
  });
  const gate = atom('gate.auditor.before-audit', {
    fields: { trigger: 'auditing the ledger extract', first: '.claude/shared/codes.md' },
  });

  it('delegates for a reference and a gate, never for the helper itself or a skill-owned atom', () => {
    expect(codeAsk('trigger', [ref, helper], []).text).toBe(
      'Please have a helper agent audit the ledger extract for duplicate payments.',
    );
    expect(codeAsk('trigger', [gate, helper], []).text).toBe(
      'Please have a helper agent audit the ledger extract.',
    );
    expect(codeAsk('trigger', [helper], []).text).toBe(
      'Please audit the ledger extract for duplicate payments.',
    );
    const owner = unit('stock', 'Counts stock in the aisles.');
    expect(codeAsk('trigger', [ref, owner], []).text).toBe('Please count stock in the aisles.');
  });
});

describe('the negative control of a guard comes near its own rule and breaks nothing', () => {
  const guard = (fields: Record<string, unknown>) => atom('guard.settings.x', { fields });

  it('asks about the act the rule governs', () => {
    const ask = codeAsk(
      'outside',
      [guard({ ruleText: 'Require a review note before editing a pricing entry.' })],
      [],
      false,
      undefined,
      undefined,
      { testType: 'guard_negative' },
    );
    expect(ask.text).toBe(
      'Without changing anything, tell me in one sentence what it would mean to edit a pricing entry.',
    );
  });

  it('asks about the subject of a rule that names no act', () => {
    const ask = codeAsk(
      'outside',
      [guard({ ruleText: 'Block uploads of customer lists outside the shared drive.' })],
      [],
      false,
      undefined,
      undefined,
      { testType: 'guard_negative' },
    );
    expect(ask.text).toBe(
      'Without changing anything, tell me in one sentence what applies here to uploads of customer lists outside the shared drive.',
    );
    expect(ruleTopic('Block uploads of customer lists outside the shared drive.')).toBe(
      'uploads of customer lists outside the shared drive',
    );
    expect(ruleTopic('The hook reads JSON on stdin.')).toBeUndefined();
  });

  it('asks about the act of a rule the guard enforces', () => {
    const rule = atom('instruction.standing.no-deletes', { title: 'Never delete a shipping manifest' });
    const ask = codeAsk(
      'outside',
      [guard({ enforces: [{ atom: rule.id }] })],
      [],
      false,
      (id) => (id === rule.id ? rule : undefined),
      undefined,
      { testType: 'guard_negative' },
    );
    expect(ask.text).toBe(
      'Without changing anything, tell me in one sentence what it would mean to delete a shipping manifest.',
    );
  });

  it('writes no generic request for a guard that documents no rule', () => {
    const ask = codeAsk(
      'outside',
      [guard({ ruleText: 'Warns when the call is slow.' })],
      [],
      false,
      undefined,
      undefined,
      {
        testType: 'guard_negative',
      },
    );
    expect(ask.text).toBeUndefined();
    expect(ask.refused).toMatch(/documents no rule/);
    // An outside request for a rule of an instruction keeps its neutral wording.
    expect(codeAsk('outside', [atom('instruction.x.y', { title: 'Never paste a secret' })], []).text).toBe(
      OUTSIDE_ASK,
    );
  });

  it('gives each guard its own request', () => {
    const asks = [
      'Require a review note before editing a pricing entry.',
      'Refuse changes to a locked payroll file.',
    ].map(
      (ruleText) =>
        codeAsk('outside', [guard({ ruleText })], [], false, undefined, undefined, {
          testType: 'guard_negative',
        }).text,
    );
    expect(new Set(asks).size).toBe(2);
    expect(asks.every((text) => text !== OUTSIDE_ASK)).toBe(true);
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
        user: 'Please count stock in the aisles. When a count sheet is late.',
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

describe('a guard whose rule text names a situation, not an act', () => {
  const guard = (ruleText: string) => atom('guard.catalogue.x', { fields: { ruleText } });
  const ask = (ruleText: string, use: 'trigger' | 'outside' = 'trigger') =>
    codeAsk(use, [guard(ruleText)], [], false, undefined, undefined, {
      testType: use === 'outside' ? 'guard_negative' : 'guard_positive',
    });

  it('asks the act named by an opening gerund or by a connective clause', () => {
    expect(ask('Deploying to the production cluster without a release tag.').text).toBe(
      'Please deploy to the production cluster.',
    );
    expect(ask('A signed-off quote before sending the offer to a carrier.').text).toBe(
      'Please send the offer to a carrier.',
    );
    expect(
      ask('Nothing leaves the building. Sending a price list while the contract is unsigned.').text,
    ).toBe('Please send a price list.');
  });

  it('asks for help with the situation when the rule names no act', () => {
    expect(ask('A force push to the shared release branch is blocked.').text).toBe(
      'Please help me with a force push to the shared release branch.',
    );
    expect(ask('Two pallets for the same dock slot, when the roster is full.').text).toBe(
      'Please help me with two pallets for the same dock slot.',
    );
  });

  it('writes no ask for a condition, a hook description or a phrase with too few words', () => {
    for (const ruleText of [
      'The last reply is too long.',
      'Nudges the owner when a reply runs long.',
      'After each task.',
      'Start-up of a session.',
      'A declaration edited before the broker confirms the code.',
    ]) {
      const written = ask(ruleText);
      expect(written.text, ruleText).toBeUndefined();
      expect(written.refused, ruleText).toMatch(/no task/);
    }
  });

  it('writes no ask from a clause pasted out of a sentence, a statement about the hook, or a noun in disguise', () => {
    for (const ruleText of [
      'The bytecode of the file it compiles is never cached.',
      'As a hook it never blocks anything.',
      'Calls of ANY tool (Edit, Write) are logged.',
      'Process reads each feed ONCE, never twice.',
      "Notes on the carrier's cutoff are kept.",
      'No command that changes what anyone else would read.',
      'A pallet moved with the roster of the dock they.',
    ]) {
      const written = ask(ruleText);
      expect(written.text, ruleText).toBeUndefined();
      expect(written.refused, ruleText).toMatch(/no task/);
    }
  });

  it('uses the same situation for the negative control, so it comes near the rule', () => {
    expect(ask('A force push to the shared release branch is blocked.', 'outside').text).toBe(
      'Without changing anything, tell me in one sentence what applies here to a force push to the shared release branch.',
    );
  });
});
