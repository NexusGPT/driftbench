import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { expect, it } from 'vitest';
import { AttackError, redteamPack, runAttack } from '../src/index';
import { spec } from './support';

it.each(['must', 'must_not'] as const)(
  'rejects added %s on a spec-authored conversation recording before any agent runs',
  async (key) => {
    const declared = spec({
      id: 'review-declared',
      blocks: [{ user: 'offer' }, { user: 'finish', expect: { must: ['done'] } }],
      perturbations: [
        {
          id: 'Declared_Shift',
          class: 'D2_goal_shift',
          inject_at: 1,
          user: 'shift',
          expect: { must: ['accepted'] },
          recovery: { within_blocks: 1 },
        },
      ],
    });
    const sent: string[] = [];
    const adapter = functionAdapter({
      respond(messages) {
        const user = messages.at(-1)?.content ?? '';
        sent.push(user);
        const text = user === 'shift' ? 'accepted' : user === 'finish' ? 'done' : 'offer';
        return { text, segments: [], toolCalls: [], cost: {}, latencyMs: 0 };
      },
      deterministic: true,
    });
    const options = { spec: declared, adapter, checks: defaultChecks() };
    const first = await runAttack({
      ...options,
      pack: redteamPack([
        {
          class: 'D2_goal_shift',
          conversation: [{ id: 'unused-shift', approved: true, user: 'shift' }],
        },
      ]),
      rounds: 1,
    });
    expect(first.findings).toBe(0);
    expect(first.recording.rounds[0]?.phrasing).toEqual({
      id: 'Declared_Shift',
      approved: true,
      user: 'shift',
      source: 'spec',
    });
    const valid = await runAttack({
      ...options,
      replay: JSON.parse(JSON.stringify(first.recording)),
    });
    expect(valid.findings).toBe(0);
    expect(valid.rounds[0]?.perturbation.expect).toEqual({ must: ['accepted'] });

    // Re-recording a valid replay labels its source as pack. Ownership must follow the spec match.
    for (const recording of [first.recording, valid.recording]) {
      const replay = structuredClone(recording);
      const phrasing = replay.rounds[0]?.phrasing;
      if (!phrasing) throw new Error('missing recorded phrasing');
      phrasing[key] = key === 'must' ? ['^REVIEW_NEVER_PRESENT$'] : ['accepted'];
      sent.length = 0;
      await expect(runAttack({ ...options, replay })).rejects.toThrow(
        new AttackError(
          `recording round 1 has an invalid phrasing: ${key} is not allowed on a spec-authored phrasing; the spec owns the expectations`,
        ),
      );
      expect(sent).toEqual([]);
    }
  },
);
