/**
 * Offline spec-cap comparison, using only the validator's fictional scaled maps and fault classes.
 * node --import tsx tools/analysis/generator-cap.ts <output.json> [10,100] [512,709,710,4096,6126,6127]
 * CPU covers one map load, generation, file write and YAML reload. Fault-run CPU is reported separately.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname } from 'node:path';
import { cellsOf, generateSuite, measuredCoverage } from '../../packages/generate/src/enumerate/generate';
import { seederOf } from '../../packages/generate/src/enumerate/spec-cap';
import { FAULT_CLASSES, faultFamily } from '../../packages/validators/src/ladders/generator/faults';
import {
  type Generation,
  generateFrom,
  runAll,
} from '../../packages/validators/src/ladders/generator/measure';
import { renderMap } from '../../packages/validators/src/ladders/generator/render';
import { scaledSpec } from '../../packages/validators/src/ladders/generator/scale';

const cpuMs = (since: NodeJS.CpuUsage) => {
  const used = process.cpuUsage(since);
  return (used.user + used.system) / 1000;
};

/** Same causal kill rule as bank.ts: reference passes, fault fails at or after its first changed block. */
async function faultsOf(generated: Generation) {
  const started = process.cpuUsage();
  const family = faultFamily(generated.hidden).filter((fault) => fault.where === 'any' && fault.rate === 1);
  const caught = new Set<string>();
  const changed = new Set<string>();
  const witnesses: Record<string, { spec: string; block: number }> = {};
  let followerFailures = 0;
  const errors: string[] = [];
  // Probe-first order only shortens the measurement. Every surviving class still sees every spec.
  const ordered = [...generated.complete].sort(
    (a, b) => Number(/gen-(twise|cover)/.test(a.spec.id)) - Number(/gen-(twise|cover)/.test(b.spec.id)),
  );
  for (let offset = 0; offset < ordered.length; offset += 50) {
    const runs = await runAll(
      { ...generated, complete: ordered.slice(offset, offset + 50) },
      { k: 1, cheaters: [], faults: () => family.filter((fault) => !caught.has(fault.class)) },
    );
    errors.push(...runs.errors);
    followerFailures += runs.blocks.filter(
      (block) => !block.reference.every((outcome) => outcome === 'pass'),
    ).length;
    for (const record of runs.faults) {
      if (record.changedOn.length > 0) changed.add(record.fault.class);
      const killed = runs.blocks.find((block) => {
        const first = record.firstChange[block.spec];
        return (
          block.fields.length > 0 &&
          block.reference.every((outcome) => outcome === 'pass') &&
          block.faults[record.fault.def.id] === 'fail' &&
          first !== undefined &&
          block.index >= first
        );
      });
      if (!killed) continue;
      caught.add(record.fault.class);
      witnesses[record.fault.class] = { spec: killed.spec, block: killed.index };
    }
  }
  return {
    total: FAULT_CLASSES.length,
    caught: [...caught].sort(),
    survivors: FAULT_CLASSES.filter((entry) => !caught.has(entry.id)).map((entry) => ({
      id: entry.id,
      changed: changed.has(entry.id),
    })),
    witnesses,
    followerFailures,
    errors,
    cpuMs: cpuMs(started),
    repeats: 1,
    instances: 'every-time, anywhere; all validator fault classes; deterministic scripted follower',
  };
}

async function measure(factor: number, cap: number | undefined) {
  const hidden = scaledSpec(1, factor);
  const started = process.cpuUsage();
  const generated = await generateFrom(
    hidden,
    renderMap(hidden),
    1,
    {
      generate: (prepared, options) =>
        generateSuite(prepared, {
          ...options,
          ...(cap === undefined ? {} : { specCap: cap, specCapMode: 'pairs' }),
        }),
    },
    { once: true },
  );
  const generationCpuMs = cpuMs(started);
  if (!generated.prepared || !generated.report || generated.refused)
    throw new Error(`generation refused: ${JSON.stringify(generated.refused)}`);
  const specs = generated.complete.map((entry) => entry.spec);
  const files = [...generated.first.keys()].filter((path) => path.endsWith('.yaml'));
  if (files.length !== generated.report.summary.specs || generated.loaded.some((entry) => !entry.ok))
    throw new Error('written spec count or YAML reload differs from the report');
  const fileHashes = new Map(
    [...generated.first]
      .filter(([path]) => path.endsWith('.yaml'))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, text]) => [path, createHash('sha256').update(text).digest('hex')]),
  );
  const ready = new Set(generated.complete.map((entry) => entry.spec.id));
  const protectedFiles = generated.loaded.flatMap((entry) =>
    entry.ok && (!ready.has(entry.spec.id) || !['twise', 'cover'].includes(seederOf(entry.spec)))
      ? [{ id: entry.spec.id, path: entry.path, sha256: fileHashes.get(entry.path) }]
      : [],
  );
  if (protectedFiles.some((entry) => entry.sha256 === undefined))
    throw new Error('protected spec is absent from written files');
  const suiteManifestSha256 = createHash('sha256')
    .update([...fileHashes].map(([path, hash]) => `${path}\t${hash}\n`).join(''))
    .digest('hex');
  const faults = await faultsOf(generated);
  if (faults.errors.length > 0 || faults.followerFailures > 0)
    throw new Error(`follower or runner failed: ${JSON.stringify(faults)}`);
  return {
    factor,
    cap: cap ?? null,
    specs: files.length,
    fileHashes,
    suiteManifestSha256,
    protectedFiles,
    generationCpuMs,
    pair: measuredCoverage(generated.prepared, specs, 2),
    triple: measuredCoverage(generated.prepared, specs, 3),
    uncoveredPairs: cellsOf(generated.prepared, specs, 2)
      .filter((cell) => cell.count === 0)
      .map((cell) => cell.values),
    protected: generated.report.spec_cap?.protected ?? null,
    preserving: generated.report.spec_cap?.preserving ?? null,
    trimmed: generated.report.spec_cap?.trimmed ?? {},
    faults,
  };
}

const [output = '.exec/generator-cap.json', factorText = '10,100', capText = '512,709,710,4096,6126,6127'] =
  process.argv.slice(2);
const numbers = (text: string) =>
  text.split(',').map((value) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error(`invalid positive integer: ${value}`);
    return number;
  });
const rows: Array<
  Omit<Awaited<ReturnType<typeof measure>>, 'fileHashes'> & {
    pairsLost: number;
    triplesLost: number;
    faultsLost: string[];
    changedFiles: string[];
    protectedLost: string[];
    passes: boolean;
  }
> = [];
const stamp = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  at: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  seed: 1,
  cpuScope: 'one generation, file write and YAML reload; excludes fault assay; process user plus system CPU',
};
await mkdir(dirname(output), { recursive: true });
for (const factor of numbers(factorText)) {
  const baseline = await measure(factor, undefined);
  for (const cap of [undefined, ...numbers(capText)]) {
    const row = cap === undefined ? baseline : await measure(factor, cap);
    const faultsLost = baseline.faults.caught.filter((id) => !row.faults.caught.includes(id));
    const changedFiles = [...row.fileHashes]
      .filter(([path, hash]) => baseline.fileHashes.get(path) !== hash)
      .map(([path]) => path);
    const protectedLost = baseline.protectedFiles
      .filter((entry) => row.fileHashes.get(entry.path) !== entry.sha256)
      .map((entry) => entry.path);
    const lost = row.uncoveredPairs.filter(
      (pair) => !baseline.uncoveredPairs.some((other) => JSON.stringify(pair) === JSON.stringify(other)),
    );
    const { fileHashes: _fileHashes, ...evidence } = row;
    rows.push({
      ...evidence,
      pairsLost: lost.length,
      triplesLost: baseline.triple.covered - row.triple.covered,
      faultsLost,
      changedFiles,
      protectedLost,
      passes:
        lost.length === 0 &&
        faultsLost.length === 0 &&
        changedFiles.length === 0 &&
        protectedLost.length === 0,
    });
    await writeFile(output, `${JSON.stringify({ stamp, rows }, null, 2)}\n`);
    process.stdout.write(
      `${factor}x cap ${row.cap ?? 'none'}: ${row.specs} specs, ${row.pair.covered}/${row.pair.allowed} pairs, ${row.triple.covered}/${row.triple.allowed} triples, ${row.faults.caught.length}/${row.faults.total} faults, CPU ${row.generationCpuMs} ms\n`,
    );
  }
}
