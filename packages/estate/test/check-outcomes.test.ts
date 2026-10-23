import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, invariantOutcomes, lintEstate, measureInvariants } from '../src/index';
import { estate, scanFixture } from './support';

describe('lint and invariant outcomes with coverage', () => {
  it('gives every lint check of an empty estate not-run, never pass', async () => {
    const root = await estate({});
    const raw = await new ClaudeCodeReader().read(root);
    const result = lintEstate({ ...(await scanFixture()).map, atoms: [], edges: [] }, raw);
    expect(result.failed).toBe(false);
    // A policy check requires the settings, which an empty estate lacks: it did not run for that reason.
    const needsSettings = new Set([
      'PERMISSION_UNKNOWN_SKILL',
      'PERMISSION_UNKNOWN_HELPER',
      'PERMISSION_READ_BYPASS',
      'PERMISSION_BYPASS_MODE',
    ]);
    expect(result.outcomes.map((outcome) => [outcome.check, outcome.status, outcome.notRun])).toEqual(
      result.outcomes.map((outcome) => [
        outcome.check,
        'not-run',
        needsSettings.has(outcome.check) ? 'missing-capability' : 'no-input',
      ]),
    );
  });

  it('fails the checks the fixture plants defects for, and reports what each read', async () => {
    const { map, raw } = await scanFixture();
    const result = lintEstate(map, raw);
    const status = Object.fromEntries(result.outcomes.map((outcome) => [outcome.check, outcome.status]));
    expect(status.ORPHAN).toBe('fail');
    expect(status.REGISTRY_ROW).toBe('fail');
    expect(status.QUOTE_DRIFT).toBe('pass');
    for (const outcome of result.outcomes)
      expect(outcome.findings).toEqual(result.findings.filter((finding) => finding.code === outcome.check));
    expect(result.outcomes.find((outcome) => outcome.check === 'ORPHAN')?.coverage.read).toBe(
      raw.files.length,
    );
  });

  it('gives an invariant with nothing to read not-run', async () => {
    const root = await estate({ 'CLAUDE.md': '# Rules\n\nAnswer in English.\n' });
    const raw = await new ClaudeCodeReader().read(root);
    const outcomes = invariantOutcomes(raw, measureInvariants(raw, [], 40_000));
    expect(Object.fromEntries(outcomes.map((outcome) => [outcome.check, outcome.status]))).toEqual({
      standing_size: 'pass',
      no_orphans: 'pass',
      guard_paths_anchored: 'not-run',
      registry_complete: 'not-run',
    });
  });
});
