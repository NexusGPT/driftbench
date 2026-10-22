import { rm } from 'node:fs/promises';
import {
  buildPlan,
  diffEstateMaps,
  type EstateMap,
  estateImpact,
  lintEstate,
  readerFor,
  scanEstate,
} from '@agent-nexus/driftbench-estate';
import { generateEstateSuite, type PhraseBank } from '@agent-nexus/driftbench-generate';
import { RUNTIME } from '../layout';
import { writeEstate } from '../pipeline';
import { truthPointer } from '../truth-pointer';
import { scaleEstate } from './scale-estate';

/**
 * Runs one stage of the estate loop on a scale estate and prints one JSON line: the atoms, the stage's own
 * time in milliseconds, and what it produced. The parent kills it at the stage's time budget, so a stage too
 * slow to finish is a failure, not a wait. Usage: scale-worker <stage> <atoms> <seed>.
 */

async function main(): Promise<void> {
  const [stage, sizeText, seedText] = process.argv.slice(2);
  const size = Number(sizeText);
  const seed = Number(seedText);
  const planted = scaleEstate(size, seed);
  const root = await writeEstate(planted.files);
  const reader = readerFor(RUNTIME);
  if (!reader) throw new Error('no reader');
  try {
    let started = Date.now();
    const result = await scanEstate({
      root,
      reader,
      pointer: truthPointer({
        files: planted.files,
        atoms: planted.expected,
        answers: new Map(),
        gates: planted.gates,
      }),
      now: () => new Date('2026-10-11T00:00:00.000Z'),
    });
    const scanMs = Date.now() - started;
    const map: EstateMap = {
      ...result.map,
      atoms: result.map.atoms.map((atom) => ({ ...atom, approved: true })),
    };
    const out: Record<string, unknown> = { stage, size, atoms: map.atoms.length, planted: planted.atoms };
    if (stage === 'scan') {
      out.ms = scanMs;
    } else if (stage === 'lint') {
      started = Date.now();
      const lint = lintEstate(map, result.raw);
      out.ms = Date.now() - started;
      out.findings = lint.findings.filter((finding) => finding.code !== 'UNENFORCED').length;
    } else if (stage === 'plan') {
      started = Date.now();
      const plan = buildPlan(map);
      out.ms = Date.now() - started;
      out.rows = plan.plan.rows.length;
    } else if (stage === 'generate') {
      const plan = buildPlan(map);
      const bank: PhraseBank = {
        version: 1,
        estate: 'scale',
        mapHash: map.hash,
        workspaces: [],
        situations: map.atoms
          .filter((atom) => atom.kind === 'skill')
          .map((atom, index) => ({
            id: `ask-${index}`,
            title: `ask ${index}`,
            use: 'trigger' as const,
            atoms: [atom.id],
            touches: { created: [], changed: [], deleted: [] },
            phrases: [{ text: `Please do task ${index}.`, lang: 'en', approved: true }],
          })),
        deviations: [],
      };
      started = Date.now();
      const suite = generateEstateSuite(
        {
          map: { runtime: map.runtime, hash: map.hash, atoms: map.atoms },
          plan: {
            mapHash: plan.plan.mapHash,
            rows: plan.plan.rows.map((row) => ({ ...row, status: 'approved' as const })),
          },
          bank,
        },
        { seed, paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
      );
      out.ms = Date.now() - started;
      out.specs = suite.specs.length;
    } else if (stage === 'impact') {
      const changed = scaleEstate(size, seed, { drop: 1 });
      const root2 = await writeEstate(changed.files);
      try {
        const second = await scanEstate({
          root: root2,
          reader,
          pointer: truthPointer({
            files: changed.files,
            atoms: changed.expected,
            answers: new Map(),
            gates: changed.gates,
          }),
          now: () => new Date('2026-10-11T00:00:00.000Z'),
        });
        started = Date.now();
        const diff = diffEstateMaps(map, second.map);
        const tests = map.atoms.map((atom, index) => ({
          id: `t${index}`,
          path: `t${index}.yaml`,
          file: `t${index}.yaml`,
          atoms: [atom.id],
        }));
        const impact = estateImpact(diff, tests);
        out.ms = Date.now() - started;
        out.retired = impact.retire.length;
        out.removed = diff.atoms.removed.length;
      } finally {
        await rm(root2, { recursive: true, force: true });
      }
    } else {
      throw new Error(`unknown stage ${stage}`);
    }
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((cause) => {
  process.stdout.write(
    `${JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) })}\n`,
  );
  process.exitCode = 1;
});
