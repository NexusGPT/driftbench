import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classes } from '../../src/index';
import { FakeModelPort } from '../../src/model';
import { loadPlanted } from '../fixtures/classes/planted/load';

const PLANTED = resolve(import.meta.dirname, '../fixtures/classes/planted');

/** The recorded equivalence judge (claude-haiku-5-5), replay only: a request it never saw throws. */
async function recordedJudge() {
  const cassette = await classes.readCassette(resolve(PLANTED, 'judge.cassette.jsonl'));
  return cassette.port({ family: 'anthropic', model: 'claude-haiku-5-5' });
}

describe('the class gate on the H4 planted set', () => {
  it('refuses 20 of the 20 planted bad realisations and accepts every seed', async () => {
    const { byId, items } = await loadPlanted();
    const judge = await recordedJudge();
    const caught: string[] = [];
    for (const item of items) {
      const cls = byId.get(item.class) as classes.UtteranceClass;
      const verdict = await classes.gateCandidate(cls, item.text, null, [], { judge });
      if (!verdict.accepted) caught.push(item.id);
    }
    expect(caught).toHaveLength(20);
    // The control: a gate that refuses everything would also catch 20 of 20.
    for (const cls of byId.values()) {
      const verdict = await classes.gateCandidate(cls, cls.seed, null, [], { judge });
      expect(verdict.accepted, `${cls.id}: ${verdict.reason}`).toBe(true);
    }
  });

  it('catches the value defects by containment and machine format, and leaves meaning to the judge', async () => {
    const { byId, items } = await loadPlanted();
    const byStage = new Map<string, string[]>();
    for (const item of items) {
      const cls = byId.get(item.class) as classes.UtteranceClass;
      const failed = classes.deterministicStages(cls, item.text, null).find((s) => !s.ok)?.stage ?? 'none';
      byStage.set(failed, [...(byStage.get(failed) ?? []), item.id]);
    }
    // Swapped digits and missing items: no approved form is contained. P01 is also B2's minimal value.
    expect(byStage.get('slot_presence')?.sort()).toEqual(
      ['P01', 'P02', 'P03', 'P04', 'P05', 'P16', 'P17', 'P18', 'P19', 'P20'].sort(),
    );
    // A second phone or email: found by its machine format, not by any word.
    expect(byStage.get('slot_exclusivity')?.sort()).toEqual(['P11', 'P12', 'P14', 'P15']);
    // Negations, and a second address (no machine format): only the judge reads meaning.
    expect(byStage.get('none')?.sort()).toEqual(['P06', 'P07', 'P08', 'P09', 'P10', 'P13']);
  });

  it('needs the judge: a judge that says yes to everything lets the six meaning defects through', async () => {
    const { byId, items } = await loadPlanted();
    const yes = new FakeModelPort(
      Array.from({ length: 20 }, () => '{"same": true, "confidence": 1, "reason": "same"}'),
    );
    const passed = [];
    for (const item of items) {
      const verdict = await classes.gateCandidate(byId.get(item.class) as never, item.text, null, [], {
        judge: yes,
      });
      if (verdict.accepted) passed.push(item.id);
    }
    expect(passed.sort()).toEqual(['P06', 'P07', 'P08', 'P09', 'P10', 'P13']);
    // The model stages run only after every deterministic stage passed: six calls, not twenty.
    expect(yes.requests).toHaveLength(6);
  });

  it('gives the judge every listed spelling, and refuses below the confidence floor or on no readable answer', async () => {
    const { byId } = await loadPlanted();
    const cls = byId.get('acme.planted.b2') as classes.UtteranceClass;
    const unsure = new FakeModelPort([
      '{"same": true, "confidence": 0.6, "reason": "maybe"}',
      'no json here',
    ]);
    const a = await classes.gateCandidate(cls, 'Call me on (202) 555-0131 please.', null, [], {
      judge: unsure,
    });
    expect(a.accepted).toBe(false);
    expect(unsure.requests[0]?.user).toContain('"+1 202 555 0131", "(202) 555-0131", "202.555.0131"');
    const b = await classes.gateCandidate(cls, 'Call me on (202) 555-0131 please.', null, [], {
      judge: unsure,
    });
    expect(b.accepted).toBe(false);
    expect(b.reason).toContain('no readable answer');
  });

  it('checks the planned spelling, near duplicates, invariants and minimal pairs', async () => {
    const loaded = classes.validateClass({
      id: 'refund.one',
      intent: 'The customer asks for a refund of one order.',
      seed: 'I want a refund for order 1042, the blue kettle.',
      slots: [
        {
          name: 'order',
          format: 'number',
          surface_forms: [
            { form: '1042', approved: true },
            { form: '#1042', approved: true },
          ],
          minimal: ['1043'],
        },
      ],
      invariants: { keep: ['blue kettle'], max_chars: 80 },
      minimal_pairs: ['I want a refund for order 1043, the blue kettle.'],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const cls = loaded.class;
    const failed = (text: string, row: classes.Row | null = null, accepted: string[] = []) =>
      classes
        .deterministicStages(cls, text, row, accepted)
        .filter((s) => !s.ok)
        .map((s) => s.stage);
    expect(failed('Refund order #1042 please, the blue kettle.')).toEqual([]);
    expect(failed('Refund order #1042 please, the blue kettle.', { slot_surface: 's1' })).toEqual([]);
    expect(failed('Refund order 1042 please, the blue kettle.', { slot_surface: 's1' })).toEqual([
      'slot_surface',
    ]);
    expect(failed('Refund order 1042 and 7 others, the blue kettle.')).toEqual(['slot_exclusivity']);
    expect(failed('Refund order 1042 or 1043, the blue kettle.')).toContain('minimal_pair');
    expect(failed('I want a refund for order 1042, the blue kettle!')).toContain('minimal_pair');
    expect(failed('Refund order 1042 please.')).toEqual(['invariants']);
    expect(failed(`Refund order 1042, the blue kettle. ${'x'.repeat(80)}`)).toEqual(['invariants']);
    expect(
      failed('Refund order 1042, the blue kettle.', null, ['Refund order 1042, the blue kettle!']),
    ).toEqual(['near_duplicate']);
  });

  it('feeds the rejection reason back to the realiser on the next attempt', async () => {
    const { byId } = await loadPlanted();
    const cls = byId.get('acme.planted.b3') as classes.UtteranceClass;
    // Three rows, one per approved spelling (s0, s1, s2). The first attempt at the canonical spelling carries a
    // swapped digit and is refused; the retry is accepted.
    const answer = (request: { user: string }) => {
      if (request.user.includes('- phone: +1 202 555 0150')) {
        return request.user.includes('A previous attempt')
          ? '{"text": "Port +1 202 555 0150 please"}'
          : '{"text": "It is +1 202 555 0105"}';
      }
      if (request.user.includes('- phone: (202) 555-0150'))
        return '{"text": "The number is (202) 555-0150."}';
      return '{"text": "2025550150, that one"}';
    };
    const realiser = new FakeModelPort([answer, answer, answer, answer]);
    const yes = '{"same": true, "confidence": 0.95, "reason": "same"}';
    const judge = new FakeModelPort([yes, yes, yes]);
    const { set, candidates } = await classes.realiseClass(cls, { realiser, models: { judge }, tries: 1 });
    expect(candidates.filter((c) => c.accepted)).toHaveLength(3);
    const retry = realiser.requests.find((r) => r.user.includes('A previous attempt was rejected'));
    expect(retry?.user).toContain('"It is +1 202 555 0105"');
    expect(retry?.user).toContain('slot_presence');
    expect(set.items.map((i) => i.text).sort()).toEqual([
      '2025550150, that one',
      'Port +1 202 555 0150 please',
      'The number is (202) 555-0150.',
    ]);
    expect(set.gate).toMatchObject({
      planned: 3,
      candidates: 4,
      accepted: 3,
      unfilled: 0,
      rejectedBy: { slot_presence: 1 },
    });
    expect(set.gate.coverage.share).toBe(1);
  });
});

describe('text primitives', () => {
  it('finds a declared value only at character boundaries', () => {
    expect(classes.containsValue('at 88 Summit Avenue, Acmeville', '8 Summit Avenue')).toBe(false);
    expect(classes.containsValue('at 88 Summit Avenue, Acmeville', '88 Summit Avenue')).toBe(true);
    expect(classes.containsValue('call +1 202 555 0131.', '+1 202 555 0131')).toBe(true);
    expect(classes.containsValue('order 10421', '1042')).toBe(false);
  });

  it('reads phone numbers, emails and numbers by machine format', () => {
    const found = classes.machineValues(
      'It is +1 202 555 0150 or (202) 555-0165, mail Sam@x.example and order 1042',
    );
    expect(found.map((f) => `${f.format}:${f.key}`)).toEqual([
      'email:sam@x.example',
      'phone:2025550150',
      'phone:2025550165',
      'number:1042',
    ]);
  });

  it('scores diversity from 1 (one string) to n (unrelated strings)', () => {
    expect(classes.vendi(['same text here', 'same text here', 'same text here'])).toBeCloseTo(1, 6);
    expect(classes.vendi(['aaaaaaa', 'bbbbbbb', 'ccccccc', 'ddddddd'])).toBeCloseTo(4, 6);
  });
});
