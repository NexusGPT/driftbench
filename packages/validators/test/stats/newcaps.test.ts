import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as stats from '@agent-nexus/driftbench-stats';
import { describe, expect, it } from 'vitest';
import { slug } from '../../../../tools/docs/check-links';
import { runItem, statsBank } from '../../src/ladders/stats/bank/index';
import { newcapGroups, newcapItems } from '../../src/ladders/stats/bank/newcaps';
import { ROOT, real } from './support';

// NEWCAPS_GROUP=descriptive,effectsize restricts the run to those groups: an author checks one group at a time.
const only = process.env.NEWCAPS_GROUP?.split(',');
const groups = newcapGroups(ROOT).filter((g) => only === undefined || only.includes(g.group));
const entries = groups.flatMap((g) => g.functions.map((entry) => ({ group: g.group, entry })));
const FN = /^[a-z][A-Za-z0-9]*$/;
const MODULE = /^[a-z][a-z0-9-]*$/;

describe('the new-capability fixtures', () => {
  it('hold groups with unique function names, none of them already exported', () => {
    const names = entries.map(({ entry }) => entry.fn);
    expect(new Set(names).size).toBe(names.length);
    const exported = new Set(Object.keys(stats));
    expect(names.filter((name) => exported.has(name))).toEqual([]);
    for (const name of names) expect(name, name).toMatch(FN);
  });

  it('give each function a module, three value cases, two domain cases and a page that defines it', () => {
    for (const { group, entry } of entries) {
      expect(entry.module, entry.fn).toMatch(MODULE);
      expect(entry.values.length, `${entry.fn} value cases`).toBeGreaterThanOrEqual(3);
      expect(entry.domain.length, `${entry.fn} domain cases`).toBeGreaterThanOrEqual(2);
      const [path, anchor] = entry.doc.split('#');
      expect(path, entry.fn).toBe(`docs/statistics/${group}.md`);
      const page = readFileSync(join(ROOT, path as string), 'utf8');
      const anchors = new Set([...page.matchAll(/^#{2,4}\s+(.*?)\s*$/gm)].map((m) => slug(m[1] as string)));
      expect(
        anchors.has(anchor as string),
        `${entry.fn}: no heading with the anchor #${anchor} in ${path}`,
      ).toBe(true);
    }
  });

  it('make every function a different cause, two items each, all in the bank', () => {
    const items = newcapItems(ROOT, only);
    expect(items).toHaveLength(entries.length * 2);
    expect(new Set(items.map((item) => item.cause)).size).toBe(entries.length);
    const ids = new Set(statsBank(ROOT).map((item) => item.id));
    for (const item of items) expect(ids.has(item.id), item.id).toBe(true);
  });

  it('leave the roadmap methods to the roadmap, so no cause is counted twice', () => {
    const roadmap = JSON.parse(
      readFileSync(join(ROOT, 'packages/validators/fixtures/stats/roadmap.json'), 'utf8'),
    ) as { methods: Array<{ name: string }> };
    const methods = new Set(roadmap.methods.map((m) => m.name));
    expect(entries.map(({ entry }) => entry.fn).filter((name) => methods.has(name))).toEqual([]);
    const roadmapCauses = new Set(
      statsBank(ROOT)
        .filter((item) => !item.id.startsWith('newcap.'))
        .map((item) => item.cause),
    );
    expect(newcapItems(ROOT, only).filter((item) => roadmapCauses.has(item.cause))).toEqual([]);
  });

  it('give no domain item to a library that throws a RangeError on every call', async () => {
    const thrower = new Proxy(real, {
      get: () => () => {
        throw new RangeError('refused');
      },
    });
    const passing: string[] = [];
    for (const item of newcapItems(ROOT, only))
      if ((await runItem(item, 1, ROOT, thrower)).pass) passing.push(item.id);
    expect(passing).toEqual([]);
  });

  it('pass the domain item of a function written from its page, and fail it when that function throws on valid input', async () => {
    if (only !== undefined && !only.includes('descriptive')) return;
    // median as docs/statistics/descriptive.md defines it, with the RangeError of the shared conventions.
    const median = (xs: number[]): number => {
      if (xs.length === 0 || xs.some((x) => !Number.isFinite(x)))
        throw new RangeError('median of no finite values');
      const s = [...xs].sort((a, b) => a - b);
      const h = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? (s[h] as number) : ((s[h - 1] as number) + (s[h] as number)) / 2;
    };
    const items = newcapItems(ROOT, ['descriptive']).filter((item) => item.id.startsWith('newcap.median.'));
    expect(items.map((item) => item.id).sort()).toEqual(['newcap.median.domain', 'newcap.median.values']);
    const correct = { ...real, median };
    for (const item of items) expect((await runItem(item, 1, ROOT, correct)).pass, item.id).toBe(true);
    // Refusing the even-sized valid arrays is not domain checking: the domain item fails too.
    const picky = {
      ...real,
      median: (xs: number[]) => {
        if (xs.length % 2 === 0) throw new RangeError('refused');
        return median(xs);
      },
    };
    const domain = items.find((item) => item.id === 'newcap.median.domain') as (typeof items)[number];
    expect((await runItem(domain, 1, ROOT, picky)).pass).toBe(false);
  });

  it('fail today, naming the missing function, and are reachable in the documented pages', async () => {
    for (const item of newcapItems(ROOT, only)) {
      const result = await runItem(item, 1, ROOT, real);
      expect(result.pass, item.id).toBe(false);
      expect(result.detail, item.id).toContain('does not exist in the statistics package');
    }
  });
});
