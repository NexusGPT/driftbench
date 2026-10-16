import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  analyzeGraph,
  buildGraph,
  ClaudeCodeReader,
  type Edge,
  ReferenceIndex,
  scanEstate,
} from '../src/index';
import { estate, NOW } from './support';

/** Independent, deliberately expanded baseline: the old representation was one closure per reader. */
function expanded(result: Awaited<ReturnType<typeof scanEstate>>): Edge[] {
  const refs = result.map.atoms.filter((a) => a.kind === 'reference');
  const byFile = new Map<string, typeof refs>();
  for (const ref of refs) byFile.set(ref.provenance.file, [...(byFile.get(ref.provenance.file) ?? []), ref]);
  const edges: Edge[] = [];
  for (const unit of result.map.atoms.filter((a) => a.kind === 'skill' || a.kind === 'subagent')) {
    const todo = [unit.provenance.file];
    const seen = new Set<string>();
    for (let i = 0; i < todo.length; i++) {
      const file = todo[i] as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const ref of byFile.get(file) ?? []) {
        edges.push({ from: unit.id, to: ref.id, kind: 'reference' });
        if (typeof ref.fields?.path === 'string') todo.push(ref.fields.path);
      }
    }
  }
  return edges;
}

async function crossReferenced(skills: number, depth: number) {
  const files: Record<string, string> = { 'CLAUDE.md': 'Read `.claude/skills/capability-0/SKILL.md`.' };
  const path = (index: number) =>
    `.claude/skills/capability-${index % skills}/references/page-${Math.floor(index / skills)}.md`;
  for (let s = 0; s < skills; s++) {
    files[`.claude/skills/capability-${s}/SKILL.md`] =
      `---\nname: capability-${s}\ndescription: Review fictional delivery records.\n---\nRead [first](references/page-0.md).\n`;
  }
  for (let i = 0; i < skills * depth; i++)
    files[path(i)] = `Read [next](${path((i + 1) % (skills * depth))}).\n`;
  return scanEstate({ root: await estate(files), reader: new ClaudeCodeReader(), now: NOW });
}

describe('cross-referenced estate storage', () => {
  it('preserves every per-owner and estate reachability answer without expanded edges', async () => {
    const result = await crossReferenced(18, 14);
    const previous = expanded(result);
    const index = new ReferenceIndex(result.map.atoms);
    const direct = result.map.edges.filter((e) => e.kind === 'reference');
    expect(direct).toHaveLength(18);
    expect(previous).toHaveLength(18 * (18 * 14 + 1));
    for (const unit of result.map.atoms.filter((a) => a.kind === 'skill')) {
      expect(index.reachableFrom(unit.id)).toEqual(
        new Set(previous.filter((e) => e.from === unit.id).map((e) => e.to)),
      );
    }
    const before = analyzeGraph(
      result.map.atoms,
      [...result.map.edges.filter((e) => e.kind !== 'reference'), ...previous],
      result.raw.files,
    );
    expect(result.analysis.reachableAtoms).toEqual(before.reachableAtoms);
    expect(result.analysis.reachableFiles).toEqual(before.reachableFiles);
    expect(result.analysis.orphans).toEqual(before.orphans);
    expect(result.analysis.unreachableFiles).toEqual(before.unreachableFiles);
  }, 60_000);

  it.skipIf(!process.env.ESTATE_REFERENCE_BENCHMARK)(
    'measures the same synthetic graph in either representation',
    async () => {
      const result = await crossReferenced(60, 60);
      globalThis.gc?.();
      const old = process.env.ESTATE_REFERENCE_BENCHMARK === 'before';
      const baseline =
        old && process.env.ESTATE_REFERENCE_BASELINE
          ? await import(/* @vite-ignore */ process.env.ESTATE_REFERENCE_BASELINE)
          : undefined;
      globalThis.gc?.();
      const heapBefore = process.memoryUsage().heapUsed;
      const start = performance.now();
      const edges = old
        ? baseline
          ? (baseline.buildGraph(result.map.atoms, result.raw).edges as Edge[])
          : expanded(result)
        : buildGraph(result.map.atoms, result.raw).edges;
      const index = old ? undefined : new ReferenceIndex(result.map.atoms);
      const ms = performance.now() - start;
      globalThis.gc?.();
      const retainedHeapBytes = process.memoryUsage().heapUsed - heapBefore;
      const queryStart = performance.now();
      let reachCount = 0;
      for (const unit of result.map.atoms.filter((a) => a.kind === 'skill')) {
        reachCount += old
          ? edges.filter((e) => e.from === unit.id && e.kind === 'reference').length
          : (index?.reachableFrom(unit.id).size ?? 0);
      }
      const report = {
        mode: old ? 'before' : 'after',
        skills: 60,
        citations: result.map.atoms.filter((a) => a.kind === 'reference').length,
        referenceEdges: edges.filter((e) => e.kind === 'reference').length,
        reachCount,
        graphMs: ms,
        queryMs: performance.now() - queryStart,
        retainedHeapBytes,
        peakRssKiB: process.resourceUsage().maxRSS,
        gc: !!globalThis.gc,
      };
      console.log('REFERENCE_BENCHMARK', JSON.stringify(report));
      if (process.env.ESTATE_REFERENCE_REPORT)
        await writeFile(process.env.ESTATE_REFERENCE_REPORT, JSON.stringify(report, null, 2));
      expect(reachCount).toBe(60 * 3601);
    },
    120_000,
  );
});
