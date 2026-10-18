import { describe, expect, it } from 'vitest';
import { localizeRuns } from '../../src/radius/localize';
import type { SectionRegistry } from '../../src/radius/sections';
import type { BlockLink } from '../../src/schema/links';
import type { RunResult } from '../../src/schema/run';
import type { Spec } from '../../src/schema/spec';
import { specHash } from '../../src/spec/identity';

/** Fictional data only. A run position is not the authored position: an injected block shifts the ones after it. */
const link = (block: string, section: string): BlockLink => ({
  block,
  to: { kind: 'prompt_section', prompt: 'p', section },
  status: 'declared',
});
const spec = {
  id: 's',
  kind: 'conversation',
  blocks: ['a', 'b', 'c'].map((id) => ({ id, when: { user: id } })),
  metadata: { links: [link('a', 'intro'), link('b', 'offer'), link('c', 'close')] },
} as Spec;
const registry: SectionRegistry = {
  prompt_id: 'p',
  version: 'v1',
  text_sha256: '0'.repeat(64),
  sections: ['intro', 'offer', 'close'].map((id, index) => ({
    id,
    scope: 'local' as const,
    span: { start: index * 10, end: index * 10 + 9 },
    sha256: '0'.repeat(64),
    anchor: { quote: id },
  })),
};
const verdict = (index: number, pass: boolean, extra: Record<string, unknown> = {}) => ({
  index,
  pass,
  status: pass ? 'pass' : 'fail',
  verdicts: [],
  drift: [],
  ...extra,
});

describe('localizeRuns reads the authored block of a run block', () => {
  it('charges the sections of the authored block after an injected one in mode P', () => {
    // Run positions: 0 = a, 1 = injected, 2 = b (fails), 3 = c.
    const run = {
      runId: 'r',
      specId: 's',
      specHash: specHash(spec),
      mode: 'P',
      repeat: 0,
      target: { adapter: 'function', agent: 'x' },
      status: 'completed',
      blocks: [verdict(0, true), verdict(1, true, { injected: true }), verdict(2, false), verdict(3, true)],
    } as unknown as RunResult;
    const { localization } = localizeRuns([spec], [run], registry, { mode: 'P' });
    expect(localization.roots).toEqual(['s#b']);
    expect(localization.sections[0]?.section).toBe('offer');
  });
});
