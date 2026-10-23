import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  atomsOf,
  cli,
  countByKind,
  invariantOf,
  type LintData,
  lintData,
  render,
  SETTINGS_SOURCES,
  type SettingsSource,
  title,
  type Variant,
} from './support/estate-variants';

// Each test scans or builds an estate: on a loaded runner that takes longer than the default 5 seconds.
vi.setConfig({ testTimeout: 120_000 });

/**
 * Where an estate's settings come from, and what a check does when they were not read. Rules, over roles
 * (policies are the guards wired by the settings, strays are parts nothing names), never over file names:
 *
 *   S1 a settings source handed over is read like the stored one, in the place the profile gives it
 *   S2 a check that compares with the wiring needs the settings: without them it does not run, reports nothing,
 *      and says what it lacked; the scan says it read 0 guards
 *   S3 a part only the wiring can name is left out of the orphans when the wiring was not read, and listed as left out
 *   S4 the same source is needed again to lint; a second source for a place the estate stores is refused
 */

const SEED = 11;

type Pair = { scan: Awaited<ReturnType<typeof cli>>; lint: Awaited<ReturnType<typeof cli>>; data?: LintData };

/** Renders a variant of the project layout, scans it with the settings handed over, and lints with them. */
async function read(source: SettingsSource, policies: number, strays: number) {
  const variant: Variant = {
    layout: 'project',
    settings: source,
    roles: { capabilities: 0, policies, strays },
    seed: SEED + policies,
  };
  const rendered = await render(variant);
  const handed = rendered.settingsFile ? ['--settings', rendered.settingsFile] : [];
  const scan = await cli(
    ['estate', 'scan', rendered.root, '--no-model', ...handed, '--out', join(rendered.top, 'map.yaml')],
    rendered.top,
  );
  const lint = await cli(['estate', 'lint', 'map.yaml', ...handed, '--json', '--verbose'], rendered.top);
  const atoms = await atomsOf(join(rendered.top, 'map.yaml'));
  return { variant, rendered, scan, lint, data: lintData(lint.out), atoms } satisfies Pair &
    Record<string, unknown>;
}

describe('S1 to S3: the settings sources, whatever their place', () => {
  for (const policies of [1, 3]) {
    for (const source of SETTINGS_SOURCES) {
      const label = title({
        layout: 'project',
        settings: source,
        roles: { capabilities: 0, policies, strays: 2 },
        seed: SEED,
      });
      it(label, async () => {
        const run = await read(source, policies, 2);
        const { expected } = run.rendered;
        expect(run.scan.code).toBe(0);
        // S1: the guards read are the policies wired in the source the scan was given.
        expect(countByKind(run.atoms).guard ?? 0).toBe(expected.policies);
        const registry = invariantOf(run.atoms, 'registry_complete');
        const checks = new Map(run.data.checks.map((entry) => [entry.check, entry]));
        if (expected.policies === 0) {
          // S2: the registry checks did not run, and lack the settings; the invariant does not hold.
          for (const code of ['REGISTRY_ROW', 'REGISTRY_GUARD']) {
            expect(checks.get(code)).toMatchObject({
              status: 'not-run',
              notRun: 'missing-capability',
              missing: ['settings'],
            });
          }
          expect(registry?.fields?.holds).toBe(false);
          expect(registry?.fields?.guardsRead).toBe(0);
          expect(run.scan.out).toMatch(/0 guards were read/);
          // S3: the scripts only the wiring names are left out, one per policy, and are no orphans.
          expect(checks.get('ORPHAN')?.skipped).toBe(policies);
        } else {
          for (const code of ['REGISTRY_ROW', 'REGISTRY_GUARD'])
            expect(checks.get(code)?.status).toBe('pass');
          expect(registry?.fields?.holds).toBe(true);
          expect(checks.get('ORPHAN')?.skipped).toBe(0);
          expect(run.scan.out).not.toMatch(/0 guards were read/);
        }
        const counts = Object.fromEntries(run.data.totals.map((entry) => [entry.code, entry.total]));
        // The strays are the only parts nothing names; the guard scripts are named by the wiring, or the wiring is not there to say.
        expect(counts.ORPHAN ?? 0).toBe(expected.strays);
        expect(counts.UNREACHABLE ?? 0).toBe(0);
        for (const code of ['REGISTRY_ROW', 'REGISTRY_GUARD', 'MISSING_SCRIPT', 'UNANCHORED_GUARD'])
          expect(counts[code] ?? 0, code).toBe(0);
      });
    }
  }

  it('metamorphic: the wiring kept in the stored file, the local file or a handed-over copy gives one estate', async () => {
    const seen: string[] = [];
    for (const source of ['stored', 'local', 'rendered'] as const) {
      const run = await read(source, 3, 2);
      seen.push(
        JSON.stringify([
          countByKind(run.atoms),
          run.data.totals,
          run.data.checks.map((entry) => [entry.check, entry.status]),
        ]),
      );
    }
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });

  it('metamorphic: removing the wiring removes the guards and no finding appears from the loss', async () => {
    const wired = await read('stored', 2, 2);
    const wiredCounts = Object.fromEntries(wired.data.totals.map((entry) => [entry.code, entry.total]));
    await rm(join(wired.rendered.root, '.claude', 'settings.json'));
    const scan = await cli(
      ['estate', 'scan', wired.rendered.root, '--no-model', '--out', join(wired.rendered.top, 'after.yaml')],
      wired.rendered.top,
    );
    expect(scan.code).toBe(0);
    const lint = await cli(['estate', 'lint', 'after.yaml', '--json', '--verbose'], wired.rendered.top);
    const after = lintData(lint.out);
    const counts = Object.fromEntries(after.totals.map((entry) => [entry.code, entry.total]));
    expect(countByKind(await atomsOf(join(wired.rendered.top, 'after.yaml'))).guard ?? 0).toBe(0);
    expect(counts.ORPHAN ?? 0).toBe(wiredCounts.ORPHAN ?? 0);
    expect(counts.REGISTRY_GUARD ?? 0).toBe(0);
  });
});

describe('S4: the same source again, and one source for one place', () => {
  it('lints a handed-over copy only when handed over again, and records it in the map', async () => {
    const run = await read('rendered', 2, 1);
    expect(await readFile(join(run.rendered.top, 'map.yaml'), 'utf8')).toContain('settings: true');
    const bare = await cli(['estate', 'lint', 'map.yaml'], run.rendered.top);
    expect(bare.code).toBe(2);
    expect(bare.err).toMatch(/--settings/);
    const missing = await cli(['estate', 'lint', 'map.yaml', '--settings', 'nowhere.json'], run.rendered.top);
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/Cannot find the settings file/);
  });

  it('refuses a handed-over copy beside a stored file of its place, and accepts one beside the local file', async () => {
    const stored = await render({
      layout: 'project',
      settings: 'stored',
      roles: { capabilities: 1, policies: 1, strays: 0 },
      seed: SEED,
    });
    await mkdir(join(stored.top, 'copy'), { recursive: true });
    await writeFile(join(stored.top, 'copy', 'settings.json'), '{}\n');
    const refused = await cli(
      [
        'estate',
        'scan',
        stored.root,
        '--no-model',
        '--settings',
        join(stored.top, 'copy', 'settings.json'),
        '--out',
        join(stored.top, 'map.yaml'),
      ],
      stored.top,
    );
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/holds its own/);
    const local = await render({
      layout: 'project',
      settings: 'local',
      roles: { capabilities: 1, policies: 1, strays: 0 },
      seed: SEED,
    });
    await mkdir(join(local.top, 'copy'), { recursive: true });
    await writeFile(join(local.top, 'copy', 'settings.json'), '{}\n');
    const accepted = await cli(
      [
        'estate',
        'scan',
        local.root,
        '--no-model',
        '--settings',
        join(local.top, 'copy', 'settings.json'),
        '--out',
        join(local.top, 'map.yaml'),
      ],
      local.top,
    );
    expect(accepted.code).toBe(0);
  });
});
