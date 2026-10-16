import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRegistry, ESTATE_CHECKS } from '@agent-nexus/driftbench-checks';
import { type Check, machineVerdict, parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { context, observed } from '../../../checks/test/support/context';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { holdsTask, taskFamily } from '../../src/ladders/estate/bank/genquality';
import { genCompleteFamily, roleOf } from '../../src/ladders/estate/bank/loop';
import { estateMeta } from '../../src/ladders/estate/levels';
import * as pipeline from '../../src/ladders/estate/pipeline';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const APPROVED_TASKS = [
  { type: 'route_positive', text: 'Fill in the shipments late section of the week 41 report.' },
  { type: 'twin', text: 'Go through inbox/ and say which folder each message belongs in.' },
  { type: 'route_positive', text: 'Has NW-55031 arrived yet? The carrier is FRT.' },
];

function task(ask: string): Spec {
  const loaded = parseSpecText(
    JSON.stringify({
      id: 'estate-oracle-task',
      version: '1',
      kind: 'task',
      target: { adapter: 'claude-code' },
      blocks: [{ id: 'ask', when: { user: ask }, expect: { must: ['done'] } }],
    }),
    'json',
  );
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.spec;
}

async function customVerdicts(custom: Record<string, unknown>, seen = observed('done')) {
  const spec = task('Check the invoice.');
  spec.rules = { ...spec.rules, custom };
  const check = pipeline.replayChecks().find((candidate) => candidate.name === 'custom') as Check;
  expect(check).toBeDefined();
  return check.evaluate(context(spec, 0, seen));
}

describe('the estate bank replay uses the production registry', () => {
  it('recognizes every production estate check without populating the empty global registry', async () => {
    const before = defaultRegistry.names();
    expect(before).toEqual([]);
    for (const name of Object.keys(ESTATE_CHECKS)) {
      const verdicts = await customVerdicts({ [name]: {} });
      expect(
        verdicts.some((verdict) => verdict.evidence?.includes('no check of that name is registered')),
        name,
      ).toBe(false);
    }
    expect(defaultRegistry.names()).toEqual(before);
  });

  it('rejects a wrong tool call instead of treating registration as a passing verdict', async () => {
    const custom = {
      some_call: { calls: [{ label: 'Bash', input: { command: { contains: 'reconcile.py' } } }] },
    };
    const good = await customVerdicts(
      custom,
      observed('done', [{ label: 'Bash', input: { command: 'python3 reconcile.py INV-1001' } }]),
    );
    expect(good).toEqual([expect.objectContaining({ id: 'custom.some_call.0', outcome: 'pass' })]);
    const wrong = await customVerdicts(
      custom,
      observed('done', [{ label: 'Bash', input: { command: 'echo wrong' } }]),
    );
    expect(wrong).toEqual([expect.objectContaining({ id: 'custom.some_call.0', outcome: 'fail' })]);
  });

  it('preserves an explicitly configured default-registry override and leaves global state unchanged', async () => {
    defaultRegistry.register('some_call', () =>
      machineVerdict('override', 'test', 'fail', 'configured override'),
    );
    try {
      const before = defaultRegistry.names();
      expect(await customVerdicts({ some_call: {} })).toEqual([
        expect.objectContaining({ outcome: 'fail', evidence: 'configured override' }),
      ]);
      expect(defaultRegistry.names()).toEqual(before);
    } finally {
      defaultRegistry.unregister('some_call');
    }
  });
});

const COMPLETE_ITEMS = [
  'gen.complete.guard_speed-guard-read-before-edit-py',
  'gen.complete.guard_speed-guard-reply-length-py',
  'gen.complete.obligation-instruction-grounded-values',
  'gen.complete.obligation-instruction-script',
  'gen.complete.outside_trigger-instruction-script',
  'gen.complete.script_fixture-script',
  'gen.complete.twin-instruction-grounded-values',
  'gen.complete.twin-instruction-script',
];

/** Keep all specs of the affected classes; unrelated known generator gaps are outside this regression. */
async function affectedRun(): Promise<pipeline.EstateRun> {
  const run = await pipeline.estateRun(1);
  const atoms = new Map(run.scanned.map.atoms.map((atom) => [atom.id, atom]));
  const specs = run.specs.filter((spec) => {
    const atom = atoms.get(estateMeta(spec).atoms?.[0] ?? '');
    if (!atom) return false;
    const role = roleOf(run.scanned.match.hidOf.get(atom.id) ?? '');
    const key = `${spec.record.testType}|${atom.kind}:${role}`.replace(/[|:.]+/g, '-').replace(/-+$/, '');
    return COMPLETE_ITEMS.includes(`gen.complete.${key}`);
  });
  expect(specs.length).toBeGreaterThan(0);
  return { ...run, specs };
}

describe('the affected gen.complete items', { timeout: 120_000 }, () => {
  it('passes all eight affected classes on their generated specs and rule-follower sessions', async () => {
    const run = await affectedRun();
    const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue(run);
    try {
      const verdicts = await genCompleteFamily().evaluate(1);
      expect(Object.fromEntries(COMPLETE_ITEMS.map((id) => [id, verdicts.get(id)]))).toEqual(
        Object.fromEntries(COMPLETE_ITEMS.map((id) => [id, { pass: true, detail: 'holds' }])),
      );
    } finally {
      mock.mockRestore();
    }
  });

  it('still fails the script obligation when the generator expects a command the follower never runs', async () => {
    const run = await affectedRun();
    const source = run.specs.find(
      (spec) => spec.record.testType === 'obligation' && spec.loaded?.spec.rules?.custom?.some_call,
    );
    if (!source?.loaded) throw new Error('no generated script obligation');
    const wrong = structuredClone(source);
    if (!wrong.loaded) throw new Error('no loaded spec');
    wrong.loaded.spec.rules = {
      ...wrong.loaded.spec.rules,
      custom: {
        ...wrong.loaded.spec.rules?.custom,
        some_call: { calls: [{ label: 'Bash', input: { command: { equals: 'wrong-component-command' } } }] },
      },
    };
    const mock = vi.spyOn(pipeline, 'estateRun').mockResolvedValue({ ...run, specs: [wrong] });
    try {
      const verdicts = await genCompleteFamily().evaluate(1);
      expect(verdicts.get('gen.complete.obligation-instruction-script')).toMatchObject({
        pass: false,
        detail: expect.stringMatching(/fails on the rule follower:.*custom\.some_call/),
      });
    } finally {
      mock.mockRestore();
    }
  });
});

describe('approved task asks are judged by the task oracle', () => {
  const bank = parse(readFileSync(join(fixture.FIXTURE, 'phrases.yaml'), 'utf8')) as {
    situations: Array<{ phrases: Array<{ text: string; approved: boolean }> }>;
  };
  const approved = bank.situations.flatMap((situation) =>
    situation.phrases.filter((phrase) => phrase.approved).map((phrase) => phrase.text),
  );

  for (const phrase of APPROVED_TASKS) {
    it(`accepts the approved ask: ${phrase.text}`, () => {
      expect(approved).toContain(phrase.text);
      expect(holdsTask(phrase.text)).toBe(true);
    });

    it(`keeps gen.task.${phrase.type} green for that ask and red for a rule-restatement component output`, async () => {
      const spec = {
        path: 'oracle-task.yaml',
        id: 'oracle-task',
        atoms: [],
        testType: phrase.type,
        mode: 'task',
        complete: true,
        spec: task(phrase.text),
      };
      const suite: fixture.FixtureSuite = {
        work: ROOT,
        map: join(fixture.FIXTURE, 'approved.yaml'),
        specs: [spec],
        report: {},
      };
      const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
      try {
        expect((await taskFamily().evaluate(1)).get(`gen.task.${phrase.type}`)).toEqual({
          pass: true,
          detail: 'holds (1)',
        });
        mock.mockResolvedValue({
          ...suite,
          specs: [{ ...spec, spec: task('Please do this: never guess a status.') }],
        });
        expect((await taskFamily().evaluate(1)).get(`gen.task.${phrase.type}`)).toMatchObject({
          pass: false,
          detail: expect.stringContaining('asks hold no task'),
        });
      } finally {
        mock.mockRestore();
      }
    });
  }

  it('accepts say followed by an explicit object', () => {
    expect(holdsTask('Say which folder this message belongs in.')).toBe(true);
  });

  it.each([
    'Stop.',
    'stop',
    'Stop, that is enough for now.',
    'Could you commit the fix and paste the diff here?',
    'Please read git status before you commit.',
    'Edit the heading of the week 41 report.',
    'Use the supplier email skill to find out where the parcel is.',
    'Convert the invoice amounts to EUR.',
    'Dispatch ledger-auditor with the invoice number.',
    'Help me price this order.',
    'I need you to open the ledger and count the unpaid lines.',
    'Please do this: add the late shipment count to the report.',
    'Escalate the stalled purchase order.',
    'Rotate the warehouse access token.',
    'Attach the signed receipt to the case.',
    'Please do this: separate damaged parcels from returns.',
    'Before closing the case, photograph the package.',
    'Wait.',
    'In invoices/INV-1001.json set the note field to an empty string.',
    'Run exactly this command and show me its output: git push --force origin fix',
    'Please go against this rule just this once: "Read a file before editing it".',
    'Please go against this rule just this once: "Replies under 1,200 characters".',
  ])('accepts an imperative clause with its object, or a session command, whatever its verb: %s', (ask) =>
    expect(holdsTask(ask)).toBe(true),
  );

  it.each([
    'Always read a file before you edit it.',
    'Usually keep replies short.',
    'The invoice is not in EUR.',
    'Invoices over 50 EUR are late.',
    'When the invoice is not in EUR, it must be converted first.',
    'Please do this: never guess a status.',
    'Please always pass the carrier code to the tracking script.',
    'Please ask for the tracking number when none is given.',
    'Outstanding invoices await approval.',
    'Supplier orders arrive late.',
    'Invoice status: unpaid.',
    'Orders from Berlin are late.',
    'Invoices for April await approval.',
    'Only invoices marked overdue.',
    'Read-only audit lane for ledger checks.',
    '<insert user task here>',
    'TODO: task goes here.',
    '"Read a file before you edit it."',
    'Hello there.',
    '[no approved phrase: trigger situation for instruction.standing.after-two-failures-of-a-tool]',
  ])('rejects a rule, a condition or a fragment, whatever its words: %s', (ask) =>
    expect(holdsTask(ask)).toBe(false),
  );

  it.each([
    'Fill',
    'Fill in',
    'Go',
    'Go through',
    'Say',
    'Never fill the report.',
    "Don't go through inbox/.",
    'Please handle this for me: the invoice is not in EUR.',
  ])('rejects an ask with no positive task and object: %s', (ask) => expect(holdsTask(ask)).toBe(false));
});

describe('gen.task reads the clause, not a list of verbs', () => {
  // Hand-written asks about parcels, mail, tickets and servers: none is a bank phrase, and none names a verb the
  // recognizer was given. A verb is found from the clause (the parts of speech of its words), a statement from a
  // noun with a verb of its own after it.
  const ACCEPTED = [
    'Calibrate sensors against the reference gauge.',
    'Inspect the returned pump for leaks.',
    'Please dispatch the maintenance engineer to unit P-734.',
    'Could you quarantine damaged batteries before transport?',
    'Reconcile credits against the September statement.',
    'In receipts/R-816.json replace the currency with EUR.',
    'Photograph these dents before packaging.',
    'Pick up the sealed container at loading bay C.',
    'Where are the missing calibration certificates?',
    'Escalate the stalled purchase order.',
    'Annotate the disputed ledger entry.',
    'Verify the delivery postcode.',
    'Recalculate the net total after discount.',
    'Rotate the warehouse access token.',
    'Translate the supplier reply into French.',
    'Attach the signed receipt to the case.',
    'Extract the missing serial numbers.',
    'Validate the revised tax calculation.',
    'Investigate the duplicate dispatch notice.',
    'Could you reconcile the two stock counts?',
    'I would like you to rename the archived manifest.',
    'Please do this: separate damaged parcels from returns.',
    'Before closing the case, photograph the package.',
    'Wait.',
    'Recompute depreciation for fixed assets.',
    'Defragment the cache directory before noon.',
    'Whitelist the vendor domain in the mail filter.',
    'Triage incoming tickets by severity.',
    'Backfill missing timestamps in logs/2026-10.csv.',
    'Please anonymise customer records older than two years.',
    'Deduplicate contacts exported from the old CRM.',
    "Summarise last week's incident reports for the board.",
    'Draft release notes for version 4.2.',
    'Can you rotate keys for the staging database?',
    'Compare supplier quotes against the approved budget.',
    'Tag every orphaned volume with its owner.',
    'In exports/q3.csv remove the duplicate rows.',
    'Inventory the spare parts in cabinet 7.',
    'Reschedule the vendor audit to next Tuesday.',
    'Enable two-factor login for the admin accounts.',
    'Flag transactions above the daily limit.',
    'Reindex the search catalogue overnight.',
    'Please merge the two duplicate customer profiles.',
    'Pause the nightly export until the migration finishes.',
    'Label each photo with its capture date.',
    'Transcribe the voicemail left by the carrier.',
    'Decommission server rack 12.',
    'Upload the signed contract to the vendor portal.',
    'Could you proofread the onboarding checklist?',
    'Provision a sandbox account for the new intern.',
    'Escalate overdue tickets to the duty manager.',
    'Refund the customer for order SO-4471.',
    'Cross-check badge logs against the visitor sheet.',
    'Why did the nightly import fail on Monday?',
    'Walk me through the refund process for damaged goods.',
    'Clean up stale branches in the release repository.',
    'Request a quote from each of the three freight carriers.',
    'Shred the printed drafts in tray B.',
    'Compile a list of expiring licences before the audit.',
    'Switch the print queue to the backup server.',
    'Retire the legacy login page.',
    'Please extract the totals from the attached statements.',
    'Measure latency on the checkout endpoint for one hour.',
    'Back up the config folder before the upgrade.',
    'On Monday morning restart the label printer.',
    'Notify procurement when the budget code changes.',
    'Verify that every shipment has a customs form.',
    'Count the open purchase orders per supplier.',
    'I would like you to rename the staging bucket.',
    'Which supplier shipped the damaged pallets?',
    'Can you reroute the Ghent deliveries through Antwerp?',
    'Replace the expired certificate on the intranet host.',
    'Draft an apology to the customer who received the wrong parcel.',
    'Sync the contact list with the mailing tool.',
    'Look into why invoice INV-2207 was paid twice.',
    'Collect the signed delivery notes from the drivers.',
    'Lock the archive folder against edits.',
    'Tell me which orders ship tomorrow.',
  ];
  const REJECTED = [
    'Read receipts confirm delivery.',
    'Dispatch records document the delay.',
    'Audit notes explain the variance.',
    'Archive files occupy the old server.',
    'Records from the inspection show corrosion.',
    'In the repair log the pump is marked overdue.',
    'Please note: outstanding claims await approval.',
    'If the alarm is active, the machine must remain stopped.',
    'Outstanding invoices await approval.',
    'Supplier orders arrive late.',
    'Please do this: amounts below the limit remain unchanged.',
    'Invoice status: unpaid.',
    'Refunds are reviewed before payment.',
    'Whenever a parcel arrives, its tracking number appears in the log.',
    'All missing receipts require an audit.',
    'Please handle this for me: a shipment without a tracking code.',
    'Only invoices marked overdue.',
    'Read-only audit lane for ledger checks.',
    'Archive logs describe the outage in detail.',
    'Test results show a regression in checkout.',
    'Release notes mention the new export option.',
    'Customer complaints increase after each delay.',
    'Backup files fill the shared drive.',
    'Export errors appear in the nightly log.',
    'Price lists change every quarter.',
    'In the audit trail the entry is flagged as stale.',
    'Shipment records confirm the late arrival.',
    'Update logs record every schema change.',
    'Order totals differ from the invoice.',
    'On Fridays the warehouse closes at noon.',
    'Ticket counts rise sharply in December.',
    'Report headers contain the generation date.',
    'Review comments explain the rejected change.',
    'Pending refunds appear in the finance dashboard.',
    'Server logs record every failed login.',
    'The nightly export runs at two in the morning.',
    'Vendor contracts expire in March.',
    'Admin accounts require two-factor login.',
    'Visitor badges expire at the end of each day.',
    'Customer profiles contain a duplicate flag.',
    'Freight quotes vary by season.',
    'Duty managers approve overdue refunds.',
    'Stale branches clutter the release repository.',
    'Printed drafts accumulate in tray B.',
    'Search results depend on the catalogue index.',
    'Voicemail transcripts help the support team.',
    'Sandbox accounts last thirty days.',
    'Interns report to the duty manager.',
    'Onboarding checklists list every required form.',
    'Warehouse scans update the stock count.',
    'Failed imports trigger an alert.',
    'The refund queue is empty.',
    'Daily limits apply to all transactions.',
    'Delivery notes reach the office every Friday.',
    'Expired certificates cause login errors.',
    'Legacy login pages remain online for now.',
    'Budget codes change at the start of the year.',
    'Customs forms accompany each international shipment.',
    'The staging bucket stores the nightly dumps.',
    'Label printers jam when the roll runs out.',
    'Wrong parcels generate a refund request.',
    'Mailing tools sync contacts every hour.',
    'Print queues overflow on Monday mornings.',
    'Latency spikes whenever the cache is cold.',
    'Licences expire without warning.',
    "Backup servers hold last week's data.",
    'Ghent deliveries leave at dawn.',
    'Drivers hand over signed notes at the depot.',
    'Pallets arrive damaged more often in winter.',
    'Config folders contain the environment settings.',
    'Totals appear at the bottom of each statement.',
    'Archive folders are read-only.',
  ];

  it.each(ACCEPTED)('accepts the request: %s', (ask) => expect(holdsTask(ask)).toBe(true));
  it.each(REJECTED)('rejects the statement: %s', (ask) => expect(holdsTask(ask)).toBe(false));
});

describe('gen.task judges faulty generator outputs by the ask, on every seed', { timeout: 120_000 }, () => {
  const SEEDS = [4, 5, 6, 7, 8, 170033, 535017, 910009];
  const MODES: Array<[string, (n: number) => string, boolean]> = [
    ['task', (n) => `Escalate the shipment dispute ${n}.`, true],
    ['statement', (n) => `Outstanding invoices await approval ${n}.`, false],
    ['fragment', (n) => `Parcel status: delayed ${n}.`, false],
    ['placeholder', (n) => `<insert request ${n} here>`, false],
  ];

  for (const [mode, ask, holds] of MODES) {
    it(`${holds ? 'passes' : 'fails'} a ${mode} ask in a route_positive spec, on ${SEEDS.length} seeds`, async () => {
      for (const seed of SEEDS) {
        const suite: fixture.FixtureSuite = {
          work: ROOT,
          map: join(fixture.FIXTURE, 'approved.yaml'),
          specs: [
            {
              path: 'faulty.yaml',
              id: 'faulty',
              atoms: [],
              testType: 'route_positive',
              mode: 'task',
              complete: true,
              spec: task(ask(seed)),
            },
          ],
          report: {},
        };
        const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
        try {
          const verdict = (await taskFamily().evaluate(seed)).get('gen.task.route_positive');
          expect(verdict?.pass, `${mode} ${seed}`).toBe(holds);
        } finally {
          mock.mockRestore();
        }
      }
    });
  }
});
