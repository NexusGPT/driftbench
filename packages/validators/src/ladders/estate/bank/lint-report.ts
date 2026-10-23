import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import {
  type LintFinding,
  type ProseInventory,
  proseListing,
  resolveMapRoot,
  summariseLint,
} from '@agent-nexus/driftbench-estate';
import type { ItemResult, Tier } from './frame';

/**
 * Items of lint.defect about how a report is cut and where a map's estate is, not about one planted defect.
 * Each is a small matrix over the axes of its rule, with the expected values worked out here from the rule:
 *
 *   a report states the true total of every code and lists a bounded part, in order, unless asked for all
 *   a map's root is a relation to the map file: it resolves the same wherever the pair is, in any written
 *   form, and a root that names no folder is refused with the facts a fix needs
 */

export type ReportCase = { key: string; tier: Tier; title: string; judge(): Promise<ItemResult> };

function verdict(problems: string[]): ItemResult {
  return {
    pass: problems.length === 0,
    detail: problems.length === 0 ? 'holds' : problems.slice(0, 3).join('; '),
  };
}

const SIZES = [0, 1, 9, 10, 11, 100, 1000];
const CODES = ['ORPHAN', 'MISSING_REFERENCE', 'REGISTRY_ROW'] as const;

function findings(per: Record<string, number>): LintFinding[] {
  return CODES.flatMap((code) =>
    Array.from({ length: per[code] ?? 0 }, (_, index) => ({
      code,
      subject: `${code}-${index}`,
      message: `${code} number ${index}`,
    })),
  );
}

function totalsRule(limit: number): string[] {
  const problems: string[] = [];
  for (const size of SIZES) {
    for (const others of [0, 3]) {
      const per = { ORPHAN: size, MISSING_REFERENCE: others, REGISTRY_ROW: size > 10 ? 2 : 0 };
      const input = findings(per);
      const cut = summariseLint(input, { limit });
      const all = summariseLint(input);
      for (const code of CODES) {
        const want = per[code];
        const entry = cut.totals.find((candidate) => candidate.code === code);
        const listed = cut.shown.filter((finding) => finding.code === code);
        if ((entry?.total ?? 0) !== want) problems.push(`${code}: total ${entry?.total ?? 0}, not ${want}`);
        if (listed.length !== Math.min(want, limit))
          problems.push(`${code} ${want}: listed ${listed.length}`);
        if ((entry?.shown ?? 0) !== listed.length)
          problems.push(`${code} ${want}: the shown count is not the list`);
        if ((entry?.omitted ?? 0) !== Math.max(0, want - limit))
          problems.push(`${code} ${want}: omitted count wrong`);
        // Metamorphic: what is listed is the start of the full list, in its order.
        const full = all.shown.filter((finding) => finding.code === code);
        if (full.length !== want) problems.push(`${code} ${want}: the full report lists ${full.length}`);
        if (listed.some((finding, index) => finding.subject !== full[index]?.subject))
          problems.push(`${code} ${want}: the cut list is not the start of the full list`);
      }
      // A code with no finding is not reported at all.
      if (cut.totals.some((entry) => entry.total === 0)) problems.push('a code with no finding was reported');
    }
  }
  return problems;
}

function chunkInventory(count: number): ProseInventory {
  const chunks = Array.from({ length: count }, (_, index) => ({
    id: `part-${index}`,
    file: `part-${index}.md`,
    source: 'skill' as const,
    startLine: 1,
    endLine: 3,
    characters: 100,
  }));
  return {
    chunks,
    characters: count * 100,
    bySource: {
      standing: { chunks: 0, characters: 0 },
      memory: { chunks: 0, characters: 0 },
      skill: { chunks: count, characters: count * 100 },
      reference: { chunks: 0, characters: 0 },
      subagent: { chunks: 0, characters: 0 },
      other: { chunks: 0, characters: 0 },
    },
  };
}

/** The forms a root is written in, for a map at `maps/map.yaml` under `top` and an estate at `top/estates/home`. */
function forms(top: string, estate: string, mapFile: string): Array<{ form: string; root: string }> {
  const rel = relative(resolve(mapFile, '..'), estate).split(sep).join('/');
  return [
    { form: 'relative', root: rel },
    { form: 'relative with a trailing slash', root: `${rel}/` },
    { form: 'relative with a detour', root: `../maps/${rel}` },
    { form: 'absolute', root: estate },
  ].map((entry) => ({ ...entry, root: entry.root }));
}

export const REPORT_CASES: ReportCase[] = [
  {
    key: 'moved-map-root',
    tier: 1,
    title:
      'a map root written in any form as resolved to its estate, and one that names no folder as refused with a fix',
    judge: async () => {
      const top = await mkdtemp(join(tmpdir(), 'driftbench-map-root-'));
      try {
        const problems: string[] = [];
        // The pair is placed at several depths; the relation between the map and its estate is the same.
        for (const depth of [0, 1, 3]) {
          const base = join(top, ...Array.from({ length: depth }, (_, index) => `level-${index}`));
          const estate = join(base, 'estates', 'home');
          const mapFile = join(base, 'maps', 'map.yaml');
          await mkdir(estate, { recursive: true });
          await mkdir(join(base, 'maps'), { recursive: true });
          for (const { form, root } of forms(top, estate, mapFile)) {
            const found = await resolveMapRoot(mapFile, { root });
            if (!found.ok || resolve(found.root) !== resolve(estate))
              problems.push(`depth ${depth}, ${form}: not resolved to the estate`);
          }
          // The map alone, somewhere its relation names nothing: refused with the facts.
          const lonely = join(base, 'elsewhere', 'deeper', 'map.yaml');
          const refused = await resolveMapRoot(lonely, { root: relative(join(base, 'maps'), estate) });
          if (refused.ok) problems.push(`depth ${depth}: a root naming nothing was accepted`);
          else if (refused.recorded === '' || refused.fix === '' || refused.root === '')
            problems.push(`depth ${depth}: the refusal lacks the folder, the recorded root or the fix`);
        }
        return verdict(problems);
      } finally {
        await rm(top, { recursive: true, force: true });
      }
    },
  },
  {
    key: 'finding-totals',
    tier: 2,
    title:
      'a report of findings as the true total of every code and a bounded start of its list, whatever the sizes',
    judge: async () => verdict([...totalsRule(10), ...totalsRule(1)]),
  },
  {
    key: 'prose-list-limit',
    tier: 2,
    title:
      'a list of unanswered prose chunks as a listing that carries shown, total and omitted, bounded when a limit is given and complete when none is',
    judge: async () => {
      const problems: string[] = [];
      for (const count of [0, 1, 10, 11, 50, 400]) {
        const inventory = chunkInventory(count);
        const cut = proseListing(inventory, { limit: 10 });
        const all = proseListing(inventory);
        const want = Math.min(count, 10);
        if (all.total !== count || all.shown.length !== count || all.omitted !== 0)
          problems.push(
            `${count} chunks: the full listing is ${all.shown.length} of ${all.total}, ${all.omitted} omitted`,
          );
        if (cut.total !== count) problems.push(`${count} chunks: the total is ${cut.total}`);
        if (cut.shown.length !== want)
          problems.push(`${count} chunks: ${cut.shown.length} shown, not ${want}`);
        if (cut.omitted !== count - want)
          problems.push(`${count} chunks: ${cut.omitted} omitted, not ${count - want}`);
        // Metamorphic: what is shown is the start of the full list, in its order.
        if (cut.shown.some((chunk, index) => chunk.id !== all.shown[index]?.id))
          problems.push(`${count} chunks: the cut listing is not the start of the full one`);
      }
      return verdict(problems);
    },
  },
];
