import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type EstateMap,
  inspectRoot,
  type LintFinding,
  layoutIsEmpty,
  lintEstate,
  type ProseInventory,
  proseInventoryLines,
  readerFor,
  resolveMapRoot,
  type ScanEstateResult,
  scanEstate,
  summariseLint,
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
          ...(lint.failed ? [] : ['the lint passed a map with 0 atoms']),
          ...(lint.findings.some((finding) => finding.code === 'EMPTY_MAP')
            ? []
            : ['the lint did not give EMPTY_MAP']),
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
  {
    key: 'moved-map-root',
    tier: 1,
    title: 'a map moved away from its estate as refused with the folder looked at and a fix',
    judge: () =>
      inFolder({ 'agent/CLAUDE.md': STANDING_TEXT }, async (root, top) => {
        const mapFile = join(top, 'maps', 'map.yaml');
        const there = await resolveMapRoot(mapFile, { root: '../estate/agent' });
        const gone = await resolveMapRoot(mapFile, { root: '../agent' });
        return verdict([
          ...(there.ok && there.root === join(root, 'agent') ? [] : ['the recorded root was not found']),
          ...(!gone.ok && gone.root === join(top, 'agent') && gone.recorded === '../agent' && gone.fix !== ''
            ? []
            : [`a root that is not there was not refused with its facts: ${JSON.stringify(gone)}`]),
        ]);
      }),
  },
  {
    key: 'finding-totals',
    tier: 2,
    title: 'a report of many findings of one code as its total and its first few',
    judge: async () => {
      const finding = (code: LintFinding['code'], index: number): LintFinding => ({
        code,
        subject: `${code}-${index}`,
        message: `${code} ${index}`,
      });
      const findings = [
        ...Array.from({ length: 25 }, (_, index) => finding('ORPHAN', index)),
        ...Array.from({ length: 3 }, (_, index) => finding('MISSING_REFERENCE', index)),
      ];
      const cut = summariseLint(findings, { limit: 10 });
      const all = summariseLint(findings);
      const orphan = cut.totals.find((entry) => entry.code === 'ORPHAN');
      const missing = cut.totals.find((entry) => entry.code === 'MISSING_REFERENCE');
      return verdict([
        ...(cut.shown.length === 13 ? [] : [`the cut report lists ${cut.shown.length} findings, not 13`]),
        ...(orphan?.total === 25 && orphan.hidden === 15 ? [] : ['the 25 orphans were not totalled and cut']),
        ...(missing?.total === 3 && missing.hidden === 0
          ? []
          : ['3 findings were cut though under the limit']),
        ...(all.shown.length === 28 && all.totals.every((entry) => entry.hidden === 0)
          ? []
          : ['the full report cut findings']),
      ]);
    },
  },
  {
    key: 'prose-list-limit',
    tier: 2,
    title: 'a list of unanswered prose chunks as cut after the first few',
    judge: async () => {
      const inventory: ProseInventory = {
        chunks: Array.from({ length: 30 }, (_, index) => ({
          id: `skill-${index}.md`,
          file: `skill-${index}.md`,
          source: 'skill' as const,
          startLine: 1,
          endLine: 3,
          characters: 100,
        })),
        characters: 3000,
        bySource: {
          standing: { chunks: 0, characters: 0 },
          memory: { chunks: 0, characters: 0 },
          skill: { chunks: 30, characters: 3000 },
          reference: { chunks: 0, characters: 0 },
          subagent: { chunks: 0, characters: 0 },
          other: { chunks: 0, characters: 0 },
        },
      };
      const cut = proseInventoryLines(inventory, false, { limit: 10 });
      const all = proseInventoryLines(inventory, false);
      return verdict([
        ...(cut.length <= 14 ? [] : [`the cut list has ${cut.length} lines for 30 chunks`]),
        ...(all.length >= 32 ? [] : [`the full list has ${all.length} lines, not every chunk`]),
      ]);
    },
  },
];
