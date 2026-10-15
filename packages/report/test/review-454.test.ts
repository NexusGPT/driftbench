import type { RunResult } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { attributionOf, nonDefaultOf, type ReportDiagnosis, type ReportObject } from '../src/attribution';
import type { CampaignData } from '../src/data';
import { attributionZone } from '../src/html-attribution';
import { attributionText } from '../src/text';

function block(ids: string[], diagnoses: ReportDiagnosis[] = [], objects: ReportObject[] = []) {
  return {
    index: 0,
    pass: ids.length === 0,
    verdicts: ids.map((id) => ({
      id,
      kind: 'machine',
      name: 'tools',
      gating: true,
      outcome: 'fail',
      evidence: id,
    })),
    diagnoses,
    resolved: { objects },
  } as unknown as RunResult['blocks'][number];
}
function run(blocks: RunResult['blocks'], extra: Partial<RunResult> = {}): RunResult {
  return { runId: 'r', status: 'completed', blocks, ...extra } as RunResult;
}
function summary(...runs: RunResult[]) {
  return attributionOf({ runs } as unknown as CampaignData, { fixes: [] });
}

describe('PR 454 review regressions', () => {
  it.each(['setup', 'credited', 'excluded'])(
    'keeps independent end failures unassigned after %s credit',
    (disposition) => {
      const blocks = [block(['a'], [{ verdictRef: 'a', disposition }])];
      for (const extra of [{ endState: { match: false } }, { endVerdict: 'failure' }]) {
        const result = summary(run(blocks, extra as Partial<RunResult>));
        expect(result?.machine).toMatchObject({ k: 0, n: 1 });
        expect(result?.agent).toBeUndefined();
        expect(result?.unassigned).toBe(1);
      }
      expect(summary(run(blocks))?.agent).toMatchObject({ k: 1, n: 1 });
    },
  );

  it('still counts a known agent failure when the end state also fails', () => {
    const result = summary(
      run([block(['a'], [{ verdictRef: 'a', disposition: 'agent' }])], {
        endVerdict: 'failure',
      }),
    );
    expect(result?.agent).toMatchObject({ k: 0, n: 1 });
    expect(result?.unassigned).toBe(0);
  });

  it('classifies a block with a missing failure diagnosis as unassigned', () => {
    const result = summary(run([block(['a', 'b'], [{ verdictRef: 'a', disposition: 'setup' }])]));
    expect(result?.blocks).toEqual({
      failing: 1,
      setup: 0,
      agent: 0,
      excluded: 0,
      credited: 0,
      unassigned: 1,
    });
    expect(result?.unassigned).toBe(1);
    expect(
      summary(
        run([
          block(
            ['a', 'b'],
            [
              { verdictRef: 'a', disposition: 'setup' },
              { verdictRef: 'b', disposition: 'agent' },
            ],
          ),
        ]),
      )?.blocks.agent,
    ).toBe(1);
  });

  it.each(['custom', '(block)'])(
    'preserves all versions of %s across blocks and runs, deduplicating identical versions',
    (id) => {
      // A shared short prefix must not make two distinct rule versions indistinguishable.
      const first = { kind: 'policy/blame', id, hash: '01234567aaaaaaaa' };
      const second = { kind: 'policy/blame', id, hash: '01234567bbbbbbbb' };
      const a = block([], [], [first]);
      const b = block([], [], [second]);
      const expected = [`policy/blame:${id}@${first.hash}`, `policy/blame:${id}@${second.hash}`];
      expect(nonDefaultOf(run([a, b, a]))).toEqual(expected);
      expect(summary(run([a]), run([b]), run([a]))?.nonDefault).toEqual(expected);
      expect(
        attributionOf({ runs: [run([b])] } as unknown as CampaignData, { fixes: [], objects: [first] })?.nonDefault,
      ).toEqual(expected);
    },
  );

  it('states the two denominators: all completed machine runs; unassigned excluded only from agent rate', () => {
    const result = summary(
      run([block([])]),
      run([block(['a'], [{ verdictRef: 'a', disposition: 'credited' }])]),
      run([block(['a'])]),
      run([block([])], { status: 'stopped' }),
    );
    expect(result?.machine).toMatchObject({ k: 1, n: 3 });
    expect(result?.agent).toMatchObject({ k: 2, n: 2 });
    expect(result?.unassigned).toBe(1);
    for (const rendered of [attributionZone(result), attributionText(result).join('\n')]) {
      expect(rendered).toContain('all completed runs');
      expect(rendered).toContain('excluded from the agent-attributed rate');
      expect(rendered).not.toContain('neither rate');
    }
  });
});
