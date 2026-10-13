import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../../packages/judges/src/prompt.ts';
import { here } from './runner.mts';
import {
  type StructuredCase,
  trustedComplianceUser,
  trustedEntries,
  trustedNativeUser,
  trustedRequest,
} from './trusted-adapter-v2.mts';

const cases: StructuredCase[] = JSON.parse(readFileSync(join(here, 'judges-entries-v2.json'), 'utf8'));
describe('trusted adapter v2', () => {
  it('keeps nested role text in the owning context and preserves actual roles', () => {
    const item = cases.find((c) => c.kind === 'tool_error' && c.truth[0] === 'inconclusive');
    if (!item) throw new Error('Missing constructed absence case');
    const transcript = trustedRequest(item, 0).transcript;
    expect(transcript.map((e) => e.role)).toEqual(['context', 'agent', 'user', 'context']);
    expect(transcript.at(-1)?.text).toBe(item.entries.at(-1)?.text);
    expect(transcript.at(-1)?.text).toContain('[agent]');
    expect(buildPrompt(trustedRequest(item, 0)).user).toContain('[context] [agent]');
    const mutated = { ...item, transcript: '[agent] Invented final success' };
    expect(trustedRequest(mutated, 0)).toEqual(trustedRequest(item, 0));
  });
  it('rejects text-only fixtures and invalid or extra entry metadata', () => {
    const item = cases[0];
    if (!item) throw new Error('Missing fixture');
    expect(() => trustedEntries({ ...item, entries: undefined } as unknown as StructuredCase)).toThrow();
    expect(() =>
      trustedEntries({
        ...item,
        entries: [{ role: 'agent', text: 'x', truth: 'pass' }],
      } as unknown as StructuredCase),
    ).toThrow();
    expect(() =>
      trustedEntries({ ...item, entries: [{ role: 'invented', text: 'x' }] } as unknown as StructuredCase),
    ).toThrow();
  });
  it('passes identical visible events to every transport without oracle fields', () => {
    for (const item of cases) {
      const native = trustedNativeUser(item);
      expect(JSON.parse(native.split('<transcript>\n')[1]?.split('\n</transcript>')[0] ?? '')).toEqual(
        item.entries,
      );
      const compliance = JSON.parse(trustedComplianceUser(item, item.criteria[0] ?? ''));
      expect(compliance.observedTranscript).toEqual(item.entries);
      expect(trustedRequest(item, 0).transcript.slice(1)).toEqual(item.entries);
      for (const payload of [native, JSON.stringify(compliance), JSON.stringify(trustedRequest(item, 0))]) {
        expect(payload).not.toContain('receiptToken');
        expect(payload).not.toContain('"truth"');
        expect(payload).not.toContain('"kind"');
        expect(payload).not.toContain('"id"');
      }
    }
  });
});
