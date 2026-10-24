import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type EstateMap,
  inspectRoot,
  layoutIsEmpty,
  lintEstate,
  readerFor,
  type ScanEstateResult,
  scanEstate,
} from '@agent-nexus/driftbench-estate';
import { GUARDS_DIR, REGISTRY_MD, ROOT, RUNTIME, SETTINGS, STANDING } from '../layout';
import type { ItemResult, Tier } from './frame';

/**
 * Items of lint.defect that read the root of an estate, not one planted defect: what a folder holds before the
 * scan, a map with no atom, a registry compared with no guard, and settings that are rendered at install time.
 * Each estate is a few invented files in a folder of its own; the scan reads structure only (no model).
 */

export type RootCase = {
  key: string;
  tier: Tier;
  title: string;
  judge(): Promise<ItemResult>;
};

const STANDING_TEXT = '# Planted estate\n\nEverything here is invented for testing.\n';
const GUARD_SCRIPT = `${GUARDS_DIR}/check.sh`;
/** Settings that wire one guard, as an install step would render them. */
const RENDERED = `${JSON.stringify(
  {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: `"$CLAUDE_PROJECT_DIR"/${GUARD_SCRIPT}` }],
        },
      ],
    },
  },
  null,
  2,
)}\n`;

/** Writes the files into a folder of their own, runs the check on its path, removes the folder. */
async function inFolder<T>(files: Record<string, string>, check: (root: string, top: string) => Promise<T>) {
  const top = await mkdtemp(join(tmpdir(), 'driftbench-estate-root-'));
  const root = join(top, 'estate');
  try {
    await mkdir(root, { recursive: true });
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    return await check(root, top);
  } finally {
    await rm(top, { recursive: true, force: true });
  }
}

async function scan(root: string, settings?: string): Promise<ScanEstateResult> {
  const reader = readerFor(RUNTIME, settings !== undefined ? { settings } : {});
  if (!reader) throw new Error(`no reader for ${RUNTIME}`);
  return scanEstate({ root, reader, now: () => new Date('2026-10-11T00:00:00.000Z') });
}

function verdict(problems: string[]): ItemResult {
  return { pass: problems.length === 0, detail: problems.length === 0 ? 'holds' : problems.join('; ') };
}

export const ROOT_CASES: RootCase[] = [
  {
    key: 'empty-map',
    tier: 1,
    title: 'a map with no atom, which a scan of an empty folder gives',
    judge: () =>
      inFolder({}, async (root) => {
        const result = await scan(root);
        const lint = lintEstate(result.map, result.raw);
        return verdict([
          ...(result.map.atoms.length === 0
            ? []
            : [`the empty folder gave ${result.map.atoms.length} atoms`]),
          // A map with no atom gives every check nothing to read: the lint says none ran, which is never clean.
          ...(lint.summary === 'none-ran'
            ? []
            : [`the lint of a map with 0 atoms is ${lint.summary}, not none-ran`]),
        ]);
      }),
  },
  {
    key: 'empty-layout',
    tier: 1,
    title: 'a folder with no standing file, no layout folder and no settings as an empty layout',
    judge: () =>
      inFolder({ 'notes/readme.md': '# Notes\n' }, async (root) => {
        const layout = await inspectRoot(RUNTIME, root);
        return verdict(
          layout !== undefined && layoutIsEmpty(layout)
            ? []
            : [`the root of unrelated files read as ${JSON.stringify(layout)}`],
        );
      }),
  },
  {
    key: 'project-layout',
    tier: 1,
    title: 'a folder with a standing file and a layout folder as a layout, with its settings counted apart',
    judge: () =>
      inFolder({ [STANDING]: STANDING_TEXT, [`${ROOT}/notes.md`]: '# Notes\n' }, async (root) => {
        const layout = await inspectRoot(RUNTIME, root);
        return verdict([
          ...(layout !== undefined && !layoutIsEmpty(layout) && layout.standing.includes(STANDING)
            ? []
            : [`the project folder read as ${JSON.stringify(layout)}`]),
          ...(layout !== undefined && layout.settings.length === 0
            ? []
            : ['a folder without settings.json was said to hold settings']),
        ]);
      }),
  },
  {
    key: 'settings-found',
    tier: 1,
    title: 'a settings file at the root as found',
    judge: () =>
      inFolder({ [STANDING]: STANDING_TEXT, [SETTINGS]: '{}\n' }, async (root) => {
        const layout = await inspectRoot(RUNTIME, root);
        return verdict(
          layout?.settings.includes(SETTINGS)
            ? []
            : [`the settings file was not found: ${JSON.stringify(layout)}`],
        );
      }),
  },
  {
    key: 'registry-over-no-guards',
    tier: 2,
    title: 'a registry compared with no guard as not holding',
    judge: () =>
      inFolder(
        {
          [STANDING]: STANDING_TEXT,
          [REGISTRY_MD]: '# Check registry\n\n| Id | Guard | Enforces |\n|---|---|---|\n',
          [GUARD_SCRIPT]: '#!/bin/sh\nexit 0\n',
        },
        async (root) => {
          const result = await scan(root);
          const atom = result.map.atoms.find(
            (candidate) => candidate.kind === 'invariant' && candidate.fields?.check === 'registry_complete',
          );
          return verdict([
            ...(result.raw.guards.length === 0 ? [] : [`the estate gave ${result.raw.guards.length} guards`]),
            ...(atom === undefined ? ['the scan measured no registry invariant'] : []),
            ...(atom?.fields?.holds === true ? ['the registry invariant held over 0 guards'] : []),
            ...(atom !== undefined && atom.fields?.guardsRead !== 0
              ? ['the invariant did not say it read 0 guards']
              : []),
          ]);
        },
      ),
  },
  {
    key: 'rendered-settings',
    tier: 2,
    title: 'a rendered copy of the settings read for the guards the estate does not store',
    judge: () =>
      inFolder({ [STANDING]: STANDING_TEXT, [GUARD_SCRIPT]: '#!/bin/sh\nexit 0\n' }, async (root, top) => {
        const rendered = join(top, 'rendered-settings.json');
        await writeFile(rendered, RENDERED);
        const without = await scan(root);
        const given = await scan(root, rendered);
        const map: EstateMap = given.map;
        // Lint reads the estate again with the same copy; its quotes are at their spans.
        const again = await readerFor(RUNTIME, { settings: rendered })?.read(root);
        const lint = again ? lintEstate(map, again) : undefined;
        return verdict([
          ...(without.raw.guards.length === 0 ? [] : ['the estate alone gave guards']),
          ...(given.raw.guards.length === 1
            ? []
            : [`the rendered copy gave ${given.raw.guards.length} guards, not 1`]),
          ...(map.settings === true ? [] : ['the map did not record the rendered settings']),
          ...(lint?.findings.some((finding) => finding.code === 'QUOTE_DRIFT')
            ? ['the lint found QUOTE_DRIFT with the copy']
            : []),
        ]);
      }),
  },
];
