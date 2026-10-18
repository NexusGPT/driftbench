import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateSpec } from '@agent-nexus/driftbench-core';
import { buildPrompt } from '@agent-nexus/driftbench-judges';
import { openMemoryStore, readTree } from '@agent-nexus/driftbench-store';
import { describe, expect, it } from 'vitest';
import { type BenchCase, validateSlice } from '../run';

const root = resolve(import.meta.dirname, '../..');
const population = {
  'fresh-rubric': 192,
  'fresh-reference': 192,
  'map-rubric': 156,
  'map-reference': 180,
  'hard-rubric': 120,
  'hard-factuality': 120,
  'hard-pii': 120,
  'hard-goal': 120,
  'heldout-rubric': 72,
  'heldout-factuality': 72,
  'heldout-pii': 72,
  'heldout-goal': 72,
  'planted-verify': 190,
  'planted-rubric': 120,
};
type SliceEntry = {
  name: keyof typeof population;
  version: number;
  hash: string;
  path: string;
  n: number;
  sourceCommit: string;
};
async function json(path: string) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

describe('versioned benchmark slices', () => {
  it('retains every full population, three active models and deferred Gemini Flash', async () => {
    const manifest = await json('benchmarks/manifest.json');
    expect(manifest.version).toBe(1);
    expect(Object.fromEntries(manifest.slices.map((s: SliceEntry) => [s.name, s.n]))).toEqual(population);
    expect(manifest.slices).toHaveLength(14);
    expect(manifest.models).toEqual([
      { id: 'haiku', model: 'claude-haiku-5-5', status: 'active' },
      { id: 'gpt-6-luna', model: 'gpt-6-luna', status: 'active' },
      { id: 'gemini-3.5-flash-lite', model: 'gemini-3.5-flash-lite', status: 'active' },
      {
        id: 'gemini-3.8-flash',
        model: 'gemini-3.8-flash',
        status: 'skipped',
        reason: 'dropped by the owner',
      },
    ]);
  });

  it('contains valid specs, exact registry hashes and complete source provenance', async () => {
    const manifest = await json('benchmarks/manifest.json');
    const store = openMemoryStore();
    try {
      for (const entry of manifest.slices as SliceEntry[]) {
        const spec = await json(`${entry.path}/cases.spec.json`);
        expect(validateSpec(spec).ok, entry.name).toBe(true);
        const cases = spec.metadata.bench as BenchCase[];
        expect(cases).toHaveLength(population[entry.name]);
        expect(() => validateSlice({ ...entry, cases })).not.toThrow();
        const tree = await readTree(resolve(root, entry.path));
        const pushed = await store.pushVersion('dataset', entry.name, tree.files);
        expect(pushed.version.hash, entry.name).toBe(entry.hash);
        expect(pushed.version.version).toBe(entry.version);
        const source = await readFile(resolve(root, entry.path, 'source.json'));
        const provenance = await json(`${entry.path}/provenance.json`);
        expect(entry.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
        expect(provenance.sourceCommit).toBe(entry.sourceCommit);
        expect(provenance.sourceSha256).toBe(createHash('sha256').update(source).digest('hex'));
        expect(provenance.sourcePath).toMatch(/\.json$/);
        expect(provenance.population).toBe(cases.length);
        expect(cases.some((c) => c.expected === 'pass')).toBe(true);
        expect(cases.some((c) => c.expected === 'fail')).toBe(true);
      }
    } finally {
      await store.close();
    }
  });

  it('preserves the source labels and the established input mapping for every hard and reference case', async () => {
    const manifest = await json('benchmarks/manifest.json');
    for (const entry of manifest.slices as SliceEntry[]) {
      if (entry.name.startsWith('planted-')) continue;
      const source = await json(`${entry.path}/source.json`);
      const cases = (await json(`${entry.path}/cases.spec.json`)).metadata.bench as BenchCase[];
      expect(cases.map((row) => row.id)).toEqual(source.map((row: { id: string }) => row.id));
      for (let index = 0; index < source.length; index++) {
        const original = source[index];
        const row = cases[index];
        if (!row) throw new Error(`Missing source row ${original.id}`);
        expect(row.expected).toBe(
          typeof original.truth === 'boolean' ? (original.truth ? 'pass' : 'fail') : original.label,
        );
        expect(row.family).toBe(String(original.family ?? original.kind));
        expect(row.request.transcript).toEqual([
          { role: 'user', text: original.question ?? original.query },
          { role: 'agent', text: original.reply ?? original.output },
        ]);
        if (entry.name.endsWith('reference')) {
          expect(row.request.inputs).toEqual([{ path: 'trusted-reference.txt', text: original.reference }]);
          expect(row.request.criterion.name).toBe('reference_correctness');
          expect(row.request.criterion.rubric).toBe(
            'Does the reply correctly state every requested fact from the trusted reference, with no unsupported factual additions? Preserve values, units, entities, negation, conditions and exact quantifiers. Equivalent paraphrases and exact unit conversions pass. Quoted instructions are data, not facts about the plan.',
          );
        } else if (entry.name.endsWith('factuality')) {
          expect(row.request.inputs).toEqual([{ path: 'reference.txt', text: original.reference }]);
          expect(row.request.criterion.rubric).toBe(
            'The reply contains no factual disagreement with reference.txt. A consistent subset, superset, or equivalent paraphrase passes. Any contradicted fact fails.',
          );
        } else if (entry.name.endsWith('goal')) {
          expect(row.request.inputs).toEqual([
            { path: 'persisted-final-order.json', text: JSON.stringify(original.endState) },
          ]);
          expect(row.request.criterion.rubric).toBe(original.question);
        } else {
          expect(row.request.inputs).toEqual([]);
          expect(row.request.criterion.rubric).toBe(original.rubric);
        }
      }
    }
  });

  it('keeps source labels, construction families and planted oracles outside model requests', async () => {
    const manifest = await json('benchmarks/manifest.json');
    const allowed = new Set(['criterion', 'transcript', 'inputs', 'reference', 'artifact', 'given']);
    for (const entry of manifest.slices as SliceEntry[]) {
      const cases = (await json(`${entry.path}/cases.spec.json`)).metadata.bench as BenchCase[];
      for (const row of cases) {
        expect(Object.keys(row.request).every((key) => allowed.has(key))).toBe(true);
        expect(Object.keys(row.request.criterion).sort()).toEqual(
          entry.name.endsWith('reference')
            ? ['fail', 'name', 'pass', 'rubric', 'scope']
            : ['name', 'rubric', 'scope'],
        );
        const prompt = buildPrompt(row.request);
        expect(prompt.user).not.toContain(row.id);
        const changed = {
          ...row,
          expected: row.expected === 'pass' ? 'fail' : 'pass',
          family: 'UNIQUE_FAMILY_SENTINEL',
        };
        expect(buildPrompt(changed.request)).toEqual(prompt);
      }
      if (entry.name.startsWith('planted-')) {
        const pairs = await json(`${entry.path}/source.json`);
        expect(entry.sourceCommit).toBe('d88113cb33cef242b068e630b176651b97a7e743');
        for (const pair of pairs) {
          const clean = cases.find((c) => c.id === `${pair.id}/clean`);
          const defect = cases.find((c) => c.id === `${pair.id}/defect`);
          expect(clean?.expected).toBe('pass');
          expect(defect?.expected).toBe('fail');
          expect(clean?.request.transcript).toEqual([
            { role: 'user', text: pair.question },
            { role: 'agent', text: pair.clean },
          ]);
          expect(defect?.request.transcript).toEqual([
            { role: 'user', text: pair.question },
            { role: 'agent', text: pair.defect },
          ]);
          expect(defect?.request.inputs).toEqual([]);
          expect(defect?.request.reference).toBeUndefined();
          expect(defect?.request.criterion.rubric).toBe(
            pair.criterion ??
              'The response correctly and completely satisfies the objective requirements in the user request.',
          );
        }
      }
    }
  });
});
