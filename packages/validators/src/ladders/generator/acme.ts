import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { BankItem, Verdict } from './bank';

/**
 * The Acme items: the generator on the fictional Acme example, gated the way examples/acme/gated/README.md
 * states. They read no seed, so they run once per bank run. Each names a gap the owner found in the
 * generated Acme suite: every allowed pair covered by a complete spec, the price faults of the sales and
 * the ops agent killed, and a dev-split price-sheet spec carrying an instruction in data.
 *
 * The run: `driftbench generate --map examples/acme/map/approved.yaml --t 2`, then `driftbench gate` on the
 * complete specs with the sales and ops references, the price-sheet route, the Acme faults and the
 * hand-written origin, as the README does.
 */

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const CLI = join(ROOT, 'packages/cli/src/bin.ts');

type AcmeRun = {
  error?: string;
  coverage?: { allowed: number; covered: number };
  faults: Array<{ id: string; killed: boolean; equivalent: boolean; ranOn: number; targeting: number }>;
  /** The gated specs of the dev split, as parsed YAML. */
  dev: Array<Record<string, unknown>>;
};

function cli(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      out += String(chunk);
    });
    proc.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return yamlFiles(path);
    return name.endsWith('.yaml') ? [path] : [];
  });
}

let running: Promise<AcmeRun> | undefined;

/** Generates and gates the Acme suite once per process. */
export function acmeRun(): Promise<AcmeRun> {
  running ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'driftbench-acme-'));
    try {
      const generated = await cli([
        'generate',
        '--map',
        'examples/acme/map/approved.yaml',
        '--out',
        join(dir, 'generated'),
        '--t',
        '2',
      ]);
      // Exit 1 means incomplete specs exist, which is a normal outcome; 2 is a usage or input error.
      if (generated.code > 1)
        return {
          error: `generate exited ${generated.code}: ${generated.out.slice(-300)}`,
          faults: [],
          dev: [],
        };
      const report = JSON.parse(readFileSync(join(dir, 'generated/generate-report.json'), 'utf8')) as {
        coverage?: { complete?: { allowed: number; covered: number } };
      };
      const gated = await cli([
        'gate',
        join(dir, 'generated/specs'),
        '--reference',
        'function:acme-sales',
        '--reference',
        'process:acme-ops',
        '--route',
        'flow:price-sheet=process:acme-ops',
        '--faults',
        'examples/acme/faults',
        '--origin',
        'examples/acme/specs',
        '--date',
        '2026-10-11',
        '--out',
        join(dir, 'gated'),
        '--force',
      ]);
      const coverage = report.coverage?.complete;
      if (gated.code > 1)
        return {
          error: `gate exited ${gated.code}: ${gated.out.slice(-300)}`,
          ...(coverage ? { coverage } : {}),
          faults: [],
          dev: [],
        };
      const gate = JSON.parse(readFileSync(join(dir, 'gated/gate-report.json'), 'utf8')) as {
        mutation: {
          by_fault: Array<{
            id: string;
            ranOn: number;
            equivalent: boolean;
            suite?: { targeting: number; killed: boolean };
          }>;
        };
      };
      return {
        ...(coverage ? { coverage } : {}),
        faults: gate.mutation.by_fault.map((fault) => ({
          id: fault.id,
          killed: fault.suite?.killed ?? false,
          equivalent: fault.equivalent,
          ranOn: fault.ranOn,
          targeting: fault.suite?.targeting ?? 0,
        })),
        dev: yamlFiles(join(dir, 'gated/specs')).map(
          (file) => parse(readFileSync(file, 'utf8')) as Record<string, unknown>,
        ),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  return running;
}

const verdict = (pass: boolean, detail: string): Verdict => ({ pass, detail });

function faultItem(id: string, cause: string, needs: string): BankItem {
  return {
    id: `acme.fault.${id}`,
    family: 'fault-drift',
    tier: 4,
    level: 'faults',
    component: 'packages/generate/src/seed/scenario.ts#buildScenario',
    cause,
    global: true,
    async check() {
      const run = await acmeRun();
      if (run.error) return verdict(false, run.error);
      const fault = run.faults.find((entry) => entry.id === id);
      if (!fault) return verdict(false, `the Acme fault set has no fault ${id}`);
      return verdict(
        fault.killed,
        fault.killed
          ? `the gated Acme suite kills ${id}`
          : `the gated Acme suite does not kill ${id}: it ran on ${fault.ranOn} specs, ${fault.targeting} gated blocks target it, none goes red${fault.equivalent ? ' (it changed nothing observable: no complete spec reaches it)' : ''}. ${needs}`,
      );
    },
  };
}

function tagsOf(spec: Record<string, unknown>): string[] {
  return (spec.tags as string[] | undefined) ?? [];
}

function carriesD6(spec: Record<string, unknown>): boolean {
  const blocks = (spec.blocks as Array<{ when?: { injection?: { class?: string } } }> | undefined) ?? [];
  const perturbations = (spec.perturbations as Array<{ class?: string }> | undefined) ?? [];
  return (
    blocks.some((block) => block.when?.injection?.class === 'D6_instruction_in_data') ||
    perturbations.some((entry) => entry.class === 'D6_instruction_in_data')
  );
}

/** The Acme items, one per gap the owner named. */
export function acmeItems(): BankItem[] {
  return [
    {
      id: 'acme.coverage.complete-pairs',
      family: 'coverage',
      tier: 3,
      level: 'coverage',
      component: 'packages/generate/src/seed/seeders.ts#twiseSeeder',
      cause: 'acme.coverage',
      global: true,
      async check() {
        const run = await acmeRun();
        if (run.error && !run.coverage) return verdict(false, run.error);
        const coverage = run.coverage;
        if (!coverage) return verdict(false, 'generate-report.json states no coverage.complete');
        return verdict(
          coverage.covered === coverage.allowed,
          `complete Acme specs cover ${coverage.covered} of the ${coverage.allowed} allowed pairs at t = 2 (all of them are wanted). Find the missing pairs with \`pnpm driftbench generate --map examples/acme/map/approved.yaml --out /tmp/acme --t 2\` and \`pnpm driftbench space coverage /tmp/acme/specs --map examples/acme/map/space.yaml --t 2\`; each missing pair needs a t-wise row that some approved path can walk to completion.`,
        );
      },
    },
    faultItem(
      'x1-invents-price',
      'acme.price-slot',
      'No generated block reads a quoted price: give the map an expected-price slot bound to the catalog.search result and make the block that states the offer expect that price (a must on the price text).',
    ),
    faultItem(
      'ops-x1-wrong-price',
      'acme.price-sheet-path',
      'No complete generated spec runs on the ops agent: the price-sheet flow (B-013) has no approved path, so its specs end incomplete. A complete price-sheet spec must check the workbook artifact the ops agent writes.',
    ),
    {
      id: 'acme.split.price-sheet-D6',
      family: 'perturbation',
      tier: 4,
      level: 'modes',
      component: 'packages/generate/src/seed/seeders.ts#deviationSeeder',
      cause: 'acme.price-sheet-d6',
      global: true,
      async check() {
        const run = await acmeRun();
        if (run.error) return verdict(false, run.error);
        const found = run.dev.filter((spec) => tagsOf(spec).includes('flow:price-sheet') && carriesD6(spec));
        return verdict(
          found.length > 0,
          found.length > 0
            ? `${found.length} dev-split gated specs cover the price-sheet flow with an instruction in data`
            : 'no dev-split gated spec covers the price-sheet flow with an instruction in data (D6); the only such spec, acme-price-sheet, is sealed in the holdout. The generator must write a complete price-sheet spec carrying D6 so the gate can place one in the dev split.',
        );
      },
    },
  ];
}
