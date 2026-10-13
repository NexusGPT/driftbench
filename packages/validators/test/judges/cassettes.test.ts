import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCassette, requestKey } from '@agent-nexus/driftbench-judges';
import { describe, expect, it } from 'vitest';
import { cassetteFile, cassetteText, PERSONAS, recordCassettes, requestsToRecord } from './record';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('the scripted judge cassettes', () => {
  it('are current: a fresh recording gives the files byte for byte', async () => {
    const fresh = await recordCassettes(ROOT);
    for (const persona of PERSONAS) {
      const file = await readFile(cassetteFile(ROOT, persona), 'utf8');
      expect(
        file === cassetteText(fresh[persona]),
        `${persona}: run packages/validators/test/judges/record.ts`,
      ).toBe(true);
    }
  });

  it('load as cassettes and hold an answer for every request the validator can ask', async () => {
    const keys = new Set((await requestsToRecord(ROOT)).map((asked) => asked.key));
    expect(keys.size).toBeGreaterThan(700);
    for (const persona of PERSONAS) {
      const cassette = await loadCassette(cassetteFile(ROOT, persona));
      for (const judge of cassette.judges) {
        const held = new Set(
          cassette.entries.filter((entry) => entry.judge === judge.id).map((entry) => entry.key),
        );
        expect(
          [...keys].filter((key) => !held.has(key)),
          `${persona} ${judge.id}`,
        ).toEqual([]);
      }
    }
  });

  it('key every request by what the judge reads', async () => {
    const [first] = await requestsToRecord(ROOT);
    expect(first && requestKey(first.request, { cls: 'system1' })).toBe(first?.key);
  });
});
