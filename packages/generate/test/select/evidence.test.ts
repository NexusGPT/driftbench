import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evidenceFromReport, mergeEvidence, sealFromJson, specOfKey } from '../../src/select';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REPORT = `${ROOT}examples/acme/gated/gate-report.json`;
const SEAL = `${ROOT}examples/acme/gated/holdout/seal.json`;

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** A report with one fault of each kind that must not count, and blocks in every state. */
function report() {
  return {
    mutation: {
      by_fault: [
        { id: 'real', kind: 'drift', class: 'X3_flow', equivalent: false },
        { id: 'same', kind: 'drift', class: 'X2_contradiction', equivalent: true },
        { id: 'ctl', kind: 'control', class: 'control', equivalent: false },
      ],
    },
    blocks: [
      { key: 'kept#b1', status: 'accepted', faults: { real: { outcome: 'fail', changed: true } } },
      { key: 'kept#b2', status: 'accepted', faults: { same: { outcome: 'fail', changed: true } } },
      { key: 'kept#b3', status: 'accepted', faults: { ctl: { outcome: 'fail', changed: true } } },
      { key: 'unchanged#b1', status: 'accepted', faults: { real: { outcome: 'fail', changed: false } } },
      { key: 'green#b1', status: 'accepted', faults: { real: { outcome: 'pass', changed: true } } },
      { key: 'rejected#b1', status: 'rejected', faults: { real: { outcome: 'fail', changed: true } } },
    ],
  };
}

describe('evidenceFromReport', () => {
  it('counts a fault only when an accepted block fails on it and the fault changed what it observed', () => {
    const evidence = evidenceFromReport(report());
    if (typeof evidence === 'string') throw new Error(evidence);
    expect([...evidence.faults.keys()]).toEqual(['real']);
    expect([...evidence.kills]).toEqual([['kept', ['real']]]);
  });

  it('reads the Acme gate report: every gated spec turns the wrong-language fault red', async () => {
    const evidence = evidenceFromReport(await json(REPORT));
    if (typeof evidence === 'string') throw new Error(evidence);
    // Counted independently from the same file: 9 counted faults, 168 specs with a red fault.
    expect([...evidence.faults.keys()].sort()).toEqual([
      'd2-ignores-goal-shift',
      'd4-order-on-loose-yes',
      'd6-obeys-instruction',
      'd8-hides-tool-failure',
      'd9-answers-out-of-scope',
      'x1-invents-price',
      'x3-skips-recap',
      'x4-wrong-language',
      'x5-drops-coverage-check',
    ]);
    expect(evidence.kills.size).toBe(168);
    expect(evidence.kills.get('gen-twise-080')).toEqual([
      'd2-ignores-goal-shift',
      'd4-order-on-loose-yes',
      'x3-skips-recap',
      'x4-wrong-language',
    ]);
    const perFault = new Map<string, number>();
    for (const list of evidence.kills.values())
      for (const fault of list) perFault.set(fault, (perFault.get(fault) ?? 0) + 1);
    expect(Object.fromEntries(perFault)).toEqual({
      'x4-wrong-language': 168,
      'x3-skips-recap': 95,
      'x5-drops-coverage-check': 71,
      'd4-order-on-loose-yes': 29,
      'd8-hides-tool-failure': 18,
      'd6-obeys-instruction': 13,
      'd9-answers-out-of-scope': 13,
      'd2-ignores-goal-shift': 8,
    });
  });

  it('names what is wrong with a file that is not a gate report', () => {
    expect(evidenceFromReport({ blocks: [] })).toMatch(/^not a gate report: mutation/);
    expect(evidenceFromReport('text')).toMatch(/^not a gate report/);
  });

  it('merges reports: a spec keeps the faults of both', () => {
    const one = evidenceFromReport(report());
    const two = evidenceFromReport({
      mutation: { by_fault: [{ id: 'other', kind: 'deviation', class: 'D4', equivalent: false }] },
      blocks: [{ key: 'kept#b9', status: 'accepted', faults: { other: { outcome: 'fail', changed: true } } }],
    });
    if (typeof one === 'string' || typeof two === 'string') throw new Error('unreadable');
    const merged = mergeEvidence([one, two]);
    expect(merged.kills.get('kept')).toEqual(['other', 'real']);
    expect([...merged.faults.keys()].sort()).toEqual(['other', 'real']);
  });

  it('takes the spec id before the last #', () => {
    expect(specOfKey('gen-twise-001#b1-needs-to-identify')).toBe('gen-twise-001');
    expect(specOfKey('odd#id#2')).toBe('odd#id');
    expect(specOfKey('plain')).toBe('plain');
  });
});

describe('the gate seal and its split', () => {
  it('reads the Acme seal', async () => {
    const seal = sealFromJson(await json(SEAL));
    if (typeof seal === 'string') throw new Error(seal);
    expect(seal.seed).toBe(1);
    expect(seal.share).toBe(0.2);
    expect(seal.specs).toHaveLength(34);
    expect(seal.specs[0]).toEqual({
      id: 'gen-boundary-058',
      path: 'holdout/boundary/gen-boundary-058.yaml',
      hash: '94ab091e10fa',
    });
  });

  it('rejects a seal that is not sealed', () => {
    expect(sealFromJson({ sealed: false, seed: 1, share: 0.2, specs: [] })).toMatch(
      /^not a gate seal: sealed/,
    );
  });
});
