import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { type LoadedSpec, loadSpecs, type Spec } from '@driftbench/core';
import { compileSpace, isForbidden } from '@driftbench/space';
import { beforeAll, describe, expect, it } from 'vitest';
import { type GenerateResult, generateSuite } from '../../src/enumerate/generate';
import { loadApprovedMap } from '../../src/enumerate/load';
import type { PreparedMap } from '../../src/seed/map';
import { ACME, ACME_MAP, ACME_PROPOSAL, userTexts } from './support';

const GENERATED = `${ACME}generated`;

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else out.push(full);
  }
  return out.sort();
}

describe('generate on the approved Acme map', () => {
  let prepared: PreparedMap;
  let result: GenerateResult;
  let handWritten: Spec[];

  beforeAll(async () => {
    const loaded = await loadApprovedMap(ACME_MAP);
    if (!loaded.ok) throw new Error(`${loaded.code}: ${loaded.message}`);
    prepared = loaded.prepared;
    const hand = await loadSpecs([`${ACME}specs`]);
    handWritten = hand.filter((entry): entry is LoadedSpec => entry.ok).map((entry) => entry.spec);
    result = generateSuite(prepared, {
      mapPath: '../map/approved.yaml',
      baseline: { label: 'examples/acme/specs', specs: handWritten },
    });
  }, 60_000);

  it('reads the 46 approved dimensions, the 34 constraints and the 21 approved phrases', () => {
    expect(prepared.map.dimensions).toHaveLength(46);
    expect(prepared.map.constraints).toHaveLength(34);
    expect(prepared.phrases).toHaveLength(21);
    expect(prepared.tools.map((tool) => tool.name)).toEqual([
      'catalog.search',
      'coverage.check',
      'port.check',
      'order.create',
      'notify_sales',
    ]);
    // Every tool data dimension of the map is matched to its schema property.
    const toolDimensions = prepared.map.dimensions.filter((dimension) => /\.(in|out)\./.test(dimension.id));
    expect(prepared.toolDimensions.size).toBe(toolDimensions.length);
  });

  it('is byte for byte the suite committed in examples/acme/generated', async () => {
    const committed = (await files(GENERATED)).map((path) => relative(GENERATED, path));
    expect(committed).toEqual(result.files.map((file) => file.path).sort());
    for (const file of result.files) {
      expect(await readFile(join(GENERATED, file.path), 'utf8'), file.path).toBe(file.text);
    }
  });

  it('walks every edge of the stage graph from needs', () => {
    expect(result.report.graph).toMatchObject({ stages: 11, start: 'needs', edges: 23, covered: 23 });
    expect(result.report.graph.unreachable).toEqual([]);
    expect(result.report.graph.unparsed).toEqual([]);
  });

  it('covers every allowed pair of the 44 non-stage dimensions and applies all 34 constraints', () => {
    const twise = result.report.twise;
    expect(twise.dimensions).toHaveLength(44);
    expect(twise.covered).toBe(twise.allowed);
    // behaviour (14 values) x rule (12 values): no pairwise array has fewer rows than 168.
    expect(twise.rows).toBeGreaterThanOrEqual(168);
    expect(result.report.constraints.applied).toBe(34);
    const space = compileSpace(prepared.map);
    for (const spec of result.all.filter(
      (entry) => (entry.metadata as { generated: { seeder: string } }).generated.seeder === 'twise',
    )) {
      const cell = (spec.metadata as { generated: { cell: Record<string, string> } }).generated.cell;
      const row = space.dimensions.map((dimension) => dimension.index.get(cell[dimension.id] ?? '') ?? -1);
      // Stage and transitions are outside the array: the row is checked on the dimensions it fixes.
      expect(isForbidden(space, row), spec.id).toBe(false);
    }
  });

  it('writes valid specs only; the complete ones lint clean', () => {
    expect(result.report.invalid).toEqual([]);
    expect(result.report.lint).toEqual([]);
    expect(result.report.summary).toMatchObject({ complete: 193, incomplete: 92 });
  });

  it('probes all 10 deviation classes, each user turn an approved phrase', () => {
    expect(result.report.deviation.probes.map((probe) => probe.class)).toHaveLength(10);
    const approved = new Set(prepared.phrases.map((phrase) => phrase.text));
    for (const spec of result.complete) {
      for (const text of userTexts(spec)) expect(approved.has(text), `${spec.id}: ${text}`).toBe(true);
    }
  });

  it('lists the values with no approved phrase: every stage transition, every data value', () => {
    const gaps = new Set(result.report.no_phrase.map((gap) => gap.dimension));
    expect(gaps.has('stage_transition')).toBe(true);
    expect(gaps.has('coverage.check.out.found')).toBe(true);
    expect(result.report.no_phrase.length).toBeGreaterThan(80);
  });

  it('covers far more of the map than the hand-written specs', () => {
    const coverage = result.report.coverage;
    expect(coverage.baseline?.specs).toBe(7);
    expect(coverage.complete.covered).toBeGreaterThan((coverage.baseline?.covered ?? 0) * 10);
    expect(coverage.complete.share).toBeGreaterThan(0.5);
  });

  it('refuses the unapproved proposal with the count', async () => {
    const loaded = await loadApprovedMap(ACME_PROPOSAL);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe('MAP_NOT_APPROVED');
    expect(loaded.message).toContain('230 of 230 entries are not approved');
  });
});
