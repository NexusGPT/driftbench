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

  it('fail today, naming the missing function, and are reachable in the documented pages', async () => {
    for (const item of newcapItems(ROOT, only)) {
      const result = await runItem(item, 1, ROOT, real);
      expect(result.pass, item.id).toBe(false);
      expect(result.detail, item.id).toContain('does not exist in the statistics package');
    }
  });
});
