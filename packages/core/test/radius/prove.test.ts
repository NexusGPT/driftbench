import { describe, expect, it } from 'vitest';
import { blockOutcomes, linksRule, proveRuleLinks } from '../../src/radius/prove';
import type { BlockLink } from '../../src/schema/links';
import type { RunResult } from '../../src/schema/run';
import type { Spec } from '../../src/schema/spec';
import { specHash } from '../../src/spec/identity';
import { specOf } from '../runner/support';

/** Fictional data only: the Northwind ops estate. */
const RULE = 'instruction.standing.tell-the-user-about-a-late';
const LEDGER = 'q7c2m4xk9a';

const rule = (
  extra: Partial<BlockLink> = {},
  to: Partial<{ rule: string; ledger: string }> = {},
): BlockLink => ({
  block: 'ask',
  to: { kind: 'rule', rule: RULE, ...to },
  relation: 'verifies',
  status: 'declared',
  created_by: 'generator',
  ...extra,
});

function spec(id: string, links: BlockLink[], blocks = ['ask']): Spec {
  return specOf({
    id,
    blocks: blocks.map((block) => ({
      id: block,
      when: { user: `Where is ${block}?` },
      expect: { must: ['late'] },
    })),
    metadata: { links },
  });
}

/** A run of `spec` whose blocks passed as `passes` says, by block id; `false` fails, `'not_run'` did not run. */
function run(of: Spec, passes: Array<boolean | 'not_run'>, hash = specHash(of)): RunResult {
  return {
    specId: of.id,
    specHash: hash,
    status: 'completed',
    blocks: of.blocks.map((block, index) => ({
      index,
      blockId: block.id,
      pass: passes[index] === true,
      ...(passes[index] === 'not_run' ? { status: 'not_run' } : {}),
    })),
  } as unknown as RunResult;
}

const prove = (specs: Spec[], original: RunResult[], mutated: RunResult[]) =>
  proveRuleLinks({
    specs: specs.map((each) => ({ spec: each, path: `${each.id}.yaml` })),
    rule: { rule: RULE, ledger: LEDGER },
    mutant: { id: 'map-of-the-mutant', op: 'delete' },
    original,
    mutated,
  });

describe('proof of rule links by a deletion', () => {
  it('verifies a linked block that flips, refutes one that passes on both, and agrees when nothing else flips', () => {
    const flips = spec('estate.obligation.late', [rule()]);
    const control = spec('estate.dispatch.helper', []);
    const proof = prove(
      [flips, control],
      [run(flips, [true]), run(control, [true])],
      [run(flips, [false]), run(control, [true])],
    );
    expect(proof.counts).toEqual({
      blocks: 2,
      linked: 1,
      flipped: 1,
      verified: 1,
      refuted: 0,
      unproved: 0,
      unlinkedFlips: 0,
      exercised: 0,
    });
    expect(proof.agrees).toBe(true);
    expect(proof.updates).toEqual([
      {
        spec: flips.id,
        path: `${flips.id}.yaml`,
        links: [
          {
            ...rule(),
            status: 'verified',
            evidence: {
              verified: { mutant: 'map-of-the-mutant', op: 'delete', original: 'pass', mutated: 'fail' },
            },
          },
        ],
      },
    ]);

    const stays = spec('estate.pairwise.0094', [rule()]);
    const refuted = prove([stays], [run(stays, [true])], [run(stays, [true])]);
    expect(refuted.blocks[0]?.verdict).toBe('refuted');
    expect(refuted.updates[0]?.links[0]).toMatchObject({
      status: 'refuted',
      evidence: { refuted: { mutant: 'map-of-the-mutant', original: 'pass', mutated: 'pass' } },
    });
    expect(refuted.agrees).toBe(false);
  });

  it('reports a block that flips with no link to the rule, and does not count it as verified', () => {
    const linked = spec('estate.obligation.late', [rule()]);
    const silent = spec('estate.twin.late', [
      { ...rule(), to: { kind: 'rule', rule: 'instruction.standing.never-force-push' } },
    ]);
    const proof = prove(
      [linked, silent],
      [run(linked, [true]), run(silent, [true])],
      [run(linked, [false]), run(silent, [false])],
    );
    expect(proof.blocks.map((block) => block.verdict)).toEqual(['verified', 'unlinked-flip']);
    expect(proof.counts.unlinkedFlips).toBe(1);
    expect(proof.agrees).toBe(false);
    expect(proof.updates.map((update) => update.spec)).toEqual([linked.id]);
  });

  it('gives no proof for a block that fails on the original, did not run, or ran with different results', () => {
    const fails = spec('a.fails', [rule()]);
    const notRun = spec('a.not-run', [rule()]);
    const mixed = spec('a.mixed', [rule()]);
    const missing = spec('a.missing', [rule()]);
    const proof = prove(
      [fails, notRun, mixed, missing],
      [
        run(fails, [false]),
        run(notRun, [true]),
        run(mixed, [true]),
        run(mixed, [false]),
        run(missing, [true]),
      ],
      [run(fails, [false]), run(notRun, ['not_run']), run(mixed, [false])],
    );
    expect(proof.blocks.map((block) => [block.spec, block.verdict, block.original, block.mutant])).toEqual([
      ['a.fails', 'unproved', 'fail', 'fail'],
      ['a.not-run', 'unproved', 'pass', 'not_run'],
      ['a.mixed', 'unproved', 'mixed', 'fail'],
      ['a.missing', 'unproved', 'pass', 'missing'],
    ]);
    expect(proof.updates).toEqual([]);
    expect(proof.agrees).toBe(false);
  });

  it('reads only the runs of the exact spec: another spec hash under the same id is no outcome', () => {
    const one = spec('estate.obligation.late', [rule()]);
    expect(blockOutcomes(one, [run(one, [true], 'another-hash')])).toEqual(['missing']);
    expect(blockOutcomes(one, [run(one, [true]), run(one, [true])])).toEqual(['pass']);
  });

  it('matches a link by the ledger id of its unit, and by an absent block for every block', () => {
    expect(
      linksRule(rule({}, { rule: 'instruction.renamed.alias', ledger: LEDGER }), {
        rule: RULE,
        ledger: LEDGER,
      }),
    ).toBe(true);
    expect(linksRule(rule({}, { rule: 'instruction.renamed.alias' }), { rule: RULE, ledger: LEDGER })).toBe(
      false,
    );
    expect(linksRule(rule({}, { rule: 'instruction.renamed.alias', ledger: LEDGER }), { rule: RULE })).toBe(
      false,
    );
    const both = spec(
      'estate.stop_resume.late',
      [{ ...rule({}, { rule: 'instruction.renamed.alias', ledger: LEDGER }), block: undefined }],
      ['ask', 'resume'],
    );
    const proof = prove([both], [run(both, [true, true])], [run(both, [false, true])]);
    expect(proof.blocks.map((block) => block.verdict)).toEqual(['verified', 'refuted']);
    // One link holds for both blocks: the block that does not flip refutes it, and the evidence names it.
    expect(proof.updates[0]?.links).toEqual([
      expect.objectContaining({
        status: 'refuted',
        evidence: {
          refuted: {
            mutant: 'map-of-the-mutant',
            op: 'delete',
            blocks: [{ block: 'resume', original: 'pass', mutated: 'pass' }],
          },
        },
      }),
    ]);
  });

  it('leaves a negative control alone: a link that exercises the rule is not proved by a deletion', () => {
    const control = spec('estate.outside_trigger.late', [rule({ relation: 'exercises' })]);
    const proof = prove([control], [run(control, [true])], [run(control, [true])]);
    expect(proof.blocks[0]?.verdict).toBe('out');
    expect(proof.counts.exercised).toBe(1);
    expect(proof.updates).toEqual([]);
    // Nothing is linked with verifies, so there is nothing the deletion could agree with.
    expect(proof.agrees).toBe(false);
  });
});
