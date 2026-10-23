import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectedKinds } from './model';
import {
  type Base,
  CHECK_MISSING_SCRIPT,
  type GuardRole,
  guardScripts,
  type HomePlace,
  kindsOf,
  lintResult,
  modelOfRole,
  type Role,
  render,
  runRole,
  SHAPES,
  SPELLINGS,
} from './roles';

/**
 * The rule: a guard that runs a script from a base the runtime expands (the project folder, the plugin folder,
 * the user's home folder) is ANCHORED, whatever the spelling. The part that guards references a script part; the
 * reference is judged only where the run can read the base. The home folder is read only when the run was given
 * the folder that stands for it, never from the machine, so the same estate gives the same findings on every
 * machine. With the folder given, the script is missing exactly when that folder does not hold it. With none
 * given, the guard is skipped and the check says why: "home not mapped". A base the shell does not expand (a
 * quoted `~`) is text, a path from the working folder: the guard is not anchored.
 *
 * Expected findings come from model.ts (aspects and links, written from this rule), never from a first run.
 */

const PLACES: HomePlace[] = ['none', 'in-layout', 'beside-layout', 'outside-root'];

/** A guard role; the shape rotates so every command shape meets every base over a matrix. */
const guard = (base: Base, spelling: number, shape: number, tag: string, present: boolean): GuardRole => ({
  base,
  spelling,
  shape,
  script: `guards/check-${tag}.py`,
  present,
});

describe('guards that run a script from an expanded base (matrix)', () => {
  const cases = (['project', 'plugin', 'home'] as const).flatMap((base) =>
    SPELLINGS[base]
      .map((spelling, spell) => ({ base, spelling: spelling.id, spell, expands: spelling.expands }))
      .filter((entry) => entry.expands)
      .flatMap((entry) =>
        (base === 'home' ? PLACES : (['none'] as const)).flatMap((place) =>
          [true, false].map((present) => ({ ...entry, place, present })),
        ),
      ),
  );
  it.each(cases)('$base/$spelling, folder $place, script present: $present', async (c) => {
    const at = cases.indexOf(c);
    const role: Role = {
      guards: [guard(c.base, c.spell, at, `m${at}`, c.present)],
      homeAt: c.place,
    };
    // Aspects and links say what is found; the unreadable home is skipped, so it gives nothing.
    expect(await runRole(role)).toEqual(expectedKinds(modelOfRole(role)));
  });
});

describe('a mapped home is read through the mapping and shown without the machine folder', () => {
  const mapped = PLACES.filter((place) => place !== 'none');
  const spellings = SPELLINGS.home
    .map((spelling, spell) => ({ spelling, spell }))
    .filter((s) => s.spelling.expands);
  const cases = spellings.flatMap(({ spelling, spell }) =>
    mapped.flatMap((place) => [true, false].map((present) => ({ id: spelling.id, spell, place, present }))),
  );
  it.each(cases.map((c) => ({ ...c, label: `${c.id}, folder ${c.place}, script present: ${c.present}` })))(
    '$label',
    async ({ spell, place, present }) => {
      const role: Role = { guards: [guard('home', spell, spell, `v${spell}`, present)], homeAt: place };
      const { scripts, home } = await guardScripts(role);
      // One spelling for every form. A script that is a file of the estate is named by its path in the estate,
      // as any other file; every other script is named from the home folder as `~/...`. Never by the folder of
      // the machine, so a map is the same on every machine.
      const inEstate = place === 'in-layout' && present;
      expect(scripts).toEqual([
        inEstate ? `.claude/user-base/guards/check-v${spell}.py` : `~/guards/check-v${spell}.py`,
      ]);
      expect(home).toBeDefined();
      expect(scripts.join('\n')).not.toContain(String(home));
    },
  );
});

describe('the unmapped home is skipped and says so', () => {
  const homeSpellings = SPELLINGS.home
    .map((spelling, spell) => ({ ...spelling, spell }))
    .filter((s) => s.expands);
  it.each(homeSpellings.map((spelling) => ({ id: spelling.id, spell: spelling.spell })))(
    '$id: no finding, and the script check records that it did not read the guard, because the home is not mapped',
    async ({ spell }) => {
      const role: Role = { guards: [guard('home', spell, spell, `u${spell}`, true)], homeAt: 'none' };
      const { root, home } = await render(role);
      const result = await lintResult(root, home);
      expect(result.findings.filter((finding) => finding.code !== 'UNENFORCED')).toEqual([]);
      const outcome = result.outcomes.find((candidate) => candidate.check === CHECK_MISSING_SCRIPT);
      expect(outcome?.coverage.skipped.map((skipped) => skipped.reason)).toEqual(['home not mapped']);
      // Nothing was read, so the check did not pass: it did not run.
      expect(outcome?.status).toBe('not-run');
    },
  );

  it('does not read the machine: an empty real home folder gives the same result as one that holds the script', async () => {
    const role: Role = { guards: [guard('home', 0, 1, 'machine', true)], homeAt: 'none' };
    const saved = process.env.HOME;
    try {
      for (const holds of [false, true]) {
        const machine = await mkdtemp(join(tmpdir(), 'driftbench-other-home-'));
        if (holds) {
          await mkdir(join(machine, 'guards'), { recursive: true });
          await writeFile(join(machine, 'guards', 'check-machine.py'), '#!/usr/bin/env python3\n');
        }
        process.env.HOME = machine;
        expect(await runRole(role)).toEqual([]);
      }
    } finally {
      if (saved === undefined) delete process.env.HOME;
      else process.env.HOME = saved;
    }
  });
});

describe('a base the shell does not expand', () => {
  it('a quoted tilde is a path from the working folder: the guard is not anchored, and its script is not there', async () => {
    const quoted = SPELLINGS.home.findIndex((spelling) => !spelling.expands);
    const role: Role = { guards: [guard('home', quoted, 1, 'quoted', false)], homeAt: 'beside-layout' };
    expect(await runRole(role)).toEqual(expectedKinds(modelOfRole(role)));
    expect(expectedKinds(modelOfRole(role))).toContain('unanchored-guard');
  });
});

describe('metamorphic: what must not change the findings', () => {
  it('moving the home folder around the estate keeps the findings', async () => {
    for (const present of [true, false]) {
      const seen = new Set<string>();
      for (const homeAt of PLACES.filter((place) => place !== 'none')) {
        seen.add(JSON.stringify(await runRole({ guards: [guard('home', 0, 1, 'move', present)], homeAt })));
      }
      expect(seen.size).toBe(1);
    }
  });

  it('files an ignore rule skips, beside the root or inside the home folder, change nothing', async () => {
    for (const present of [true, false]) {
      const plain: Role = { guards: [guard('home', 1, 1, 'junk', present)], homeAt: 'beside-layout' };
      const noisy: Role = {
        ...plain,
        files: {
          'node_modules/dep/index.py': '# dependency\n',
          '.git/hooks/pre-commit.py': '# repository hook\n',
          'user-base/node_modules/dep/check-junk.py': '# a copy inside an ignored folder\n',
        },
      };
      expect(await runRole(noisy)).toEqual(await runRole(plain));
    }
  });

  it('writing the hooks to the local settings file instead of the shared one changes nothing', async () => {
    for (const present of [true, false]) {
      const role: Role = { guards: [guard('home', 0, 1, 'render', present)], homeAt: 'in-layout' };
      expect(await runRole({ ...role, settingsFile: 'settings.local.json' })).toEqual(await runRole(role));
    }
  });

  it('moving the estate to another folder changes nothing', async () => {
    const role: Role = { guards: [guard('home', 0, 1, 'moved', false)], homeAt: 'beside-layout' };
    const parent = await mkdtemp(join(tmpdir(), 'driftbench-moved-'));
    expect(await runRole(role, join(parent, 'elsewhere', 'deeper'))).toEqual(await runRole(role));
  });

  it('a script that is missing makes the missing-script finding appear, and only it', async () => {
    const present = await runRole({ guards: [guard('home', 0, 1, 'delta', true)], homeAt: 'beside-layout' });
    const absent = await runRole({ guards: [guard('home', 0, 1, 'delta', false)], homeAt: 'beside-layout' });
    expect(absent.filter((kind) => !present.includes(kind))).toEqual(['missing-script']);
  });
});

describe('size', () => {
  it('many guards over the same base give one finding per missing script, no more and no fewer', async () => {
    const count = 60;
    const expands = SPELLINGS.home
      .map((spelling, spell) => ({ spelling, spell }))
      .filter((s) => s.spelling.expands);
    const guards = Array.from({ length: count }, (_, index) =>
      guard(
        'home',
        expands[index % expands.length]?.spell ?? 0,
        index % SHAPES.length,
        `size-${index}`,
        index % 3 !== 0,
      ),
    );
    const role: Role = { guards, homeAt: 'beside-layout' };
    const found = await runRole(role);
    expect(found).toEqual(expectedKinds(modelOfRole(role)));
    expect(found).toHaveLength(count / 3);
  });
});

describe('a check over zero guards did not run', () => {
  it('an estate with no guard has no script check that passed', async () => {
    const { root, home } = await render({ skills: ['intake-notes'] });
    const outcome = (await lintResult(root, home)).outcomes.find((o) => o.check === CHECK_MISSING_SCRIPT);
    expect(outcome?.status).toBe('not-run');
    expect(
      (await kindsOf(root, home)).filter((kind) => kind.endsWith('-script') || kind.endsWith('-guard')),
    ).toEqual([]);
  });
});
