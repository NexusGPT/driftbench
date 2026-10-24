import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
 *   S2 a check that compares the registry with the guards needs a guard, whatever source it came from: with
 *      none read it does not run, reports nothing, and says what it lacked; the scan says no guard was read
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
          // S2: the registry checks did not run, and lack a guard; the invariant does not hold.
          for (const code of ['REGISTRY_ROW', 'REGISTRY_GUARD']) {
            expect(checks.get(code)).toMatchObject({
              status: 'not-run',
              notRun: 'missing-capability',
              missing: ['guards'],
            });
          }
          expect(registry?.fields?.holds).toBe(false);
          expect(registry?.fields?.guardsRead).toBe(0);
          expect(run.scan.out).toMatch(/no guard was read/);
          // S3: the scripts only the wiring names are left out, one per policy, and are no orphans.
          expect(checks.get('ORPHAN')?.skipped).toBe(policies);
        } else {
          for (const code of ['REGISTRY_ROW', 'REGISTRY_GUARD'])
            expect(checks.get(code)?.status).toBe('pass');
          expect(registry?.fields?.holds).toBe(true);
          expect(checks.get('ORPHAN')?.skipped).toBe(0);
          expect(run.scan.out).not.toMatch(/no guard was read/);
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

describe('S5: the closing verdict names what did not run', () => {
  for (const source of SETTINGS_SOURCES) {
    it(`${source}: with nothing wrong the verdict is clean, and the checks that lacked a guard are listed as not run`, async () => {
      const run = await read(source, 2, 0);
      expect(run.data.failed).toBe(false);
      expect(run.data.summary).toBe('clean');
      const lacking = run.data.checks
        .filter((entry) => entry.missing.includes('guards'))
        .map((entry) => entry.check);
      // The wiring was read: nothing lacked it. It was not: exactly the registry checks lacked it.
      expect(lacking.sort()).toEqual(source === 'absent' ? ['REGISTRY_GUARD', 'REGISTRY_ROW'] : []);
      const text = await cli(
        [
          'estate',
          'lint',
          'map.yaml',
          ...(run.rendered.settingsFile ? ['--settings', run.rendered.settingsFile] : []),
        ],
        run.rendered.top,
      );
      expect(text.code).toBe(0);
      expect(/^ {2}not-run {5}.*REGISTRY_GUARD/m.test(text.out)).toBe(source === 'absent');
    });
  }
});

describe('S6: a guard from any source, not only the settings', () => {
  type Shape = 'complete' | 'ghost-row' | 'other-row' | 'no-guard';

  /** An estate with no settings file whose only guard, if any, is declared in a skill's own frontmatter. */
  async function skillGuard(shape: Shape) {
    const top = await mkdtemp(join(tmpdir(), 'driftbench-guard-source-'));
    const script = '.claude/skills/quay/scripts/watch.sh';
    const hooks = [
      'hooks:',
      '  PreToolUse:',
      '    - matcher: Bash',
      '      hooks:',
      '        - type: command',
      `          command: "$CLAUDE_PROJECT_DIR/${script}"`,
    ];
    const rows =
      shape === 'ghost-row'
        ? ['| G1 | watch.sh | none |', '| G2 | ghost-check.sh | none |']
        : shape === 'other-row'
          ? ['| G1 | other-check.sh | none |']
          : ['| G1 | watch.sh | none |'];
    const files: Record<string, string> = {
      'home/CLAUDE.md': '# Quay desk assistant\n\nAlways answer in the language of the user.\n',
      'home/.claude/skills/quay/SKILL.md': [
        '---',
        'name: quay',
        'description: Watches the quay desk.',
        ...(shape === 'no-guard' ? [] : hooks),
        '---',
        '',
        'Watch the desk.',
        '',
      ].join('\n'),
      [`home/${script}`]: '#!/bin/sh\nexit 0\n',
      'home/.claude/guards/CHECK-REGISTRY.md': `# Check registry\n\n| Id | Guard | Enforces |\n|---|---|---|\n${rows.join('\n')}\n`,
    };
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(top, path)), { recursive: true });
      await writeFile(join(top, path), text);
    }
    const scan = await cli(['estate', 'scan', 'home', '--no-model', '--out', 'map.yaml'], top);
    const lint = await cli(['estate', 'lint', 'map.yaml', '--json', '--verbose'], top);
    const atoms = await atomsOf(join(top, 'map.yaml'));
    return { scan, data: lintData(lint.out), atoms, script };
  }

  const status = (data: LintData, check: string) => data.checks.find((entry) => entry.check === check);
  const total = (data: LintData, code: string) =>
    data.totals.find((entry) => entry.code === code)?.total ?? 0;

  it('a complete registry passes, and the scan counts the guard and does not say none was read', async () => {
    const run = await skillGuard('complete');
    expect(countByKind(run.atoms).guard ?? 0).toBe(1);
    expect(run.scan.out).not.toMatch(/no guard was read/);
    expect(run.scan.out).toMatch(/Settings: none read; 1 guard was read from other sources/);
    expect(status(run.data, 'REGISTRY_ROW')?.status).toBe('pass');
    expect(status(run.data, 'REGISTRY_GUARD')?.status).toBe('pass');
    expect(invariantOf(run.atoms, 'registry_complete')?.fields?.holds).toBe(true);
    expect(total(run.data, 'REGISTRY_ROW') + total(run.data, 'REGISTRY_GUARD')).toBe(0);
    expect(total(run.data, 'ORPHAN')).toBe(0);
  });

  it('a registry row naming no guard fails REGISTRY_GUARD, a registry that omits the guard fails both', async () => {
    const ghost = await skillGuard('ghost-row');
    expect(status(ghost.data, 'REGISTRY_ROW')?.status).toBe('pass');
    expect(status(ghost.data, 'REGISTRY_GUARD')?.status).toBe('fail');
    expect(total(ghost.data, 'REGISTRY_GUARD')).toBe(1);
    expect(invariantOf(ghost.atoms, 'registry_complete')?.fields?.holds).toBe(false);
    const other = await skillGuard('other-row');
    expect(status(other.data, 'REGISTRY_ROW')?.status).toBe('fail');
    expect(status(other.data, 'REGISTRY_GUARD')?.status).toBe('fail');
    expect(total(other.data, 'REGISTRY_ROW')).toBe(1);
    expect(total(other.data, 'REGISTRY_GUARD')).toBe(1);
    expect(other.data.failed).toBe(true);
  });

  it('with no guard from any source the registry checks do not run and say they lacked a guard', async () => {
    const run = await skillGuard('no-guard');
    expect(countByKind(run.atoms).guard ?? 0).toBe(0);
    expect(run.scan.out).toMatch(/no guard was read/);
    for (const code of ['REGISTRY_ROW', 'REGISTRY_GUARD'])
      expect(status(run.data, code)).toMatchObject({
        status: 'not-run',
        notRun: 'missing-capability',
        missing: ['guards'],
      });
    expect(invariantOf(run.atoms, 'registry_complete')?.fields).toMatchObject({
      holds: false,
      guardsRead: 0,
    });
    expect(total(run.data, 'REGISTRY_ROW') + total(run.data, 'REGISTRY_GUARD')).toBe(0);
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
