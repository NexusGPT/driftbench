import { expect, it } from 'vitest';
import type { ListedCandidates } from '../../src/ladders/pointer/sut/port';
import { fetchOf } from '../../src/ladders/pointer/sut/reader';
import { SentRecorder } from '../../src/ladders/pointer/sut/sent';

/**
 * The probes of the codex review of the head b1c6defcd (run 39765802115): a wire the renderer never returned ran
 * without clearing the enclosing async context, so an unrendered request nested in a known call inherited its
 * candidates.
 */

const candidate = { id: 'instruction.parent', title: 'the parent candidate' };

function setup() {
  const into = { rows: [] as ListedCandidates[], seen: new Set<string>() };
  const recorder = new SentRecorder(into);
  const wire = {};
  recorder.note(wire, {
    where: { file: 'parent.md', window: 'parent', set: 'agent-rules' },
    byLink: { topic: [candidate] },
  });
  const bodies: string[] = [];
  const fetch = fetchOf((request) => {
    bodies.push(request.body);
    return { status: 200, body: '{}' };
  }, recorder);
  return { into, recorder, wire, fetch, bodies };
}

it('outside a known call an unnoted wire produces no listed candidates', async () => {
  const { into, recorder, fetch } = setup();
  await recorder.during({}, () => fetch('https://labeler.invalid/', { body: JSON.stringify(candidate) }));
  expect(into.rows).toEqual([]);
});

it('an unnoted wire nested inside a known call must not inherit its candidate context', async () => {
  const { into, recorder, wire, fetch, bodies } = setup();
  await recorder.during(wire, async () => {
    await recorder.during({}, () => fetch('https://labeler.invalid/', { body: JSON.stringify(candidate) }));
  });
  expect(bodies).toEqual([JSON.stringify(candidate)]);
  expect(into.rows).toEqual([]);
});

it('a known outer call regains its context after an unnoted nested call', async () => {
  const { into, recorder, wire, fetch } = setup();
  await recorder.during(wire, async () => {
    await recorder.during({}, async () => {
      await Promise.resolve();
      await fetch('https://labeler.invalid/', { body: JSON.stringify({ unknown: true }) });
    });
    await fetch('https://labeler.invalid/', { body: JSON.stringify(candidate) });
  });
  expect(into.rows).toHaveLength(1);
  expect(into.rows[0]?.candidates).toEqual([candidate]);
});
