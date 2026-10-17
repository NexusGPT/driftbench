import { describe, expect, it, vi } from 'vitest';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { coverageFamily } from '../../src/ladders/estate/bank/genquality';

const STANDING_REFERENCES = [
  'reference.standing.read-claude-steps-json',
  'reference.standing.read-claude-memory-memory-md',
  'reference.memory-memory.read-supplier-languages-md',
];
const REPLAYED_GUARDS = [
  'guard.settings.pretooluse-bash-guard-block-force-push',
  'guard.settings.pretooluse-edit-write-guard-read-before',
  'guard.settings.posttooluse-bash-guard-ledger-guard-py',
  'guard.settings.userpromptsubmit-guard-stop-word-sh',
  'guard.settings.stop-guard-reply-length-py',
  'guard.shipment-tracker.pretooluse-bash-guard-check-carrier-sh',
];

async function verdicts(planted?: fixture.FixtureSuite) {
  const suite = planted ?? (await fixture.fixtureSuite());
  const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(suite);
  try {
    return await coverageFamily().evaluate(1);
  } finally {
    mock.mockRestore();
  }
}

describe('the fixture suite meets the two gen.coverage items that need fixture data', {
  timeout: 600_000,
}, () => {
  it('has no spec that waits on a recorded session: the sessions sit beside the map, one per replayed guard', async () => {
    const suite = await fixture.fixtureSuite();
    expect((suite.report.gaps ?? []).find((gap) => gap.marker === 'needs-recorded-session')).toBeUndefined();
    for (const guard of REPLAYED_GUARDS) {
      const replay = suite.specs.filter(
        (spec) => spec.mode === 'replay' && spec.testType === 'guard_positive' && spec.atoms[0] === guard,
      );
      expect(replay.length, guard).toBeGreaterThan(0);
      expect(
        replay.every((spec) => spec.complete),
        guard,
      ).toBe(true);
    }
    expect((await verdicts()).get('gen.coverage.needs-recorded-session')).toEqual({
      pass: true,
      detail: 'holds',
    });
  });

  it('names every standing reference in a complete spec', async () => {
    const suite = await fixture.fixtureSuite();
    for (const atom of STANDING_REFERENCES)
      expect(
        suite.specs.some((spec) => spec.complete && spec.atoms.includes(atom)),
        atom,
      ).toBe(true);
    expect((await verdicts()).get('gen.coverage.one-per-reference')).toMatchObject({ pass: true });
  });

  it('fails when a replay row waits on a recorded session again', async () => {
    const suite = await fixture.fixtureSuite();
    const planted: fixture.FixtureSuite = {
      ...suite,
      report: {
        ...suite.report,
        gaps: [
          ...(suite.report.gaps ?? []),
          { marker: 'needs-recorded-session', specs: 1, atoms: [REPLAYED_GUARDS[2] as string] },
        ],
      },
    };
    expect((await verdicts(planted)).get('gen.coverage.needs-recorded-session')).toMatchObject({
      pass: false,
    });
  });

  it('fails when a standing reference has no complete spec', async () => {
    const suite = await fixture.fixtureSuite();
    for (const atom of STANDING_REFERENCES) {
      const planted: fixture.FixtureSuite = {
        ...suite,
        specs: suite.specs.filter((spec) => !(spec.complete && spec.atoms.includes(atom))),
      };
      const out = (await verdicts(planted)).get('gen.coverage.one-per-reference');
      expect(out, atom).toMatchObject({ pass: false });
      expect(out?.detail, atom).toContain(atom);
    }
  });
});
