import { type Check, machineVerdict, type Verdict, type WorkspaceDiff } from '@agent-nexus/driftbench-core';
import { listed, normalizePath as normalize } from '../support/values';

const NAME = 'workspace';

type SetName = 'created' | 'changed' | 'deleted';
const SETS: readonly SetName[] = ['created', 'changed', 'deleted'];

/**
 * `expect.workspace` against the workspace diff of the block. A listed path must be in its set; an empty
 * list asserts that the set is empty. `others_untouched: true` fails on any path the diff holds that none
 * of the three lists names. An adapter that reports no diff observed no workspace, so each verdict is
 * inconclusive rather than a pass on nothing.
 */
export const workspace: Check = {
  name: NAME,
  applies: (ctx) => {
    const expected = ctx.expect.workspace;
    if (expected === undefined) return false;
    return SETS.some((set) => expected[set] !== undefined) || expected.others_untouched === true;
  },
  evaluate(ctx) {
    const expected = ctx.expect.workspace ?? {};
    const diff = ctx.observed.workspaceDiff;
    const verdicts: Verdict[] = [];
    const asked = [
      ...SETS.filter((set) => expected[set] !== undefined),
      ...(expected.others_untouched === true ? ['others_untouched'] : []),
    ];
    if (diff === undefined) {
      return asked.map((id) =>
        machineVerdict(NAME, id, 'inconclusive', 'the adapter reported no workspace diff for this block'),
      );
    }
    const observed = normalized(diff);

    for (const set of SETS) {
      const paths = expected[set]?.map(normalize);
      if (paths === undefined) continue;
      if (paths.length === 0) {
        const extra = observed[set];
        verdicts.push(
          machineVerdict(
            NAME,
            set,
            extra.length === 0 ? 'pass' : 'fail',
            extra.length === 0
              ? `nothing ${set}, as expected`
              : `${set} ${listed(extra)}; the block expects nothing ${set}`,
          ),
        );
        continue;
      }
      const missing = paths.filter((path) => !observed[set].includes(path));
      if (missing.length === 0) {
        verdicts.push(machineVerdict(NAME, set, 'pass', `${set} ${listed(paths)}`));
      } else {
        const notes = missing.map((path) => `${path} was not ${set}${elsewhere(path, set, observed)}`);
        verdicts.push(
          machineVerdict(
            NAME,
            set,
            'fail',
            `${notes.join('; ')}; ${set} in this block: ${listed(observed[set])}`,
          ),
        );
      }
    }

    if (expected.others_untouched === true) {
      const named = new Set(SETS.flatMap((set) => (expected[set] ?? []).map(normalize)));
      const others = SETS.flatMap((set) =>
        observed[set].filter((path) => !named.has(path)).map((path) => `${path} (${set})`),
      );
      verdicts.push(
        machineVerdict(
          NAME,
          'others_untouched',
          others.length === 0 ? 'pass' : 'fail',
          others.length === 0 ? 'no other path changed' : `other paths changed: ${others.join(', ')}`,
        ),
      );
    }
    return verdicts;
  },
};

function normalized(diff: WorkspaceDiff): Record<SetName, string[]> {
  return {
    created: diff.created.map(normalize),
    changed: diff.changed.map(normalize),
    deleted: diff.deleted.map(normalize),
  };
}

function elsewhere(path: string, set: SetName, observed: Record<SetName, string[]>): string {
  const other = SETS.find((name) => name !== set && observed[name].includes(path));
  return other === undefined ? '' : ` (it was ${other})`;
}
