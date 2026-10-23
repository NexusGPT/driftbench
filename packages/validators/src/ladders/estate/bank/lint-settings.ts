import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type Atom,
  type LintResult,
  lintEstate,
  type RawEstate,
  readerFor,
  type ScanEstateResult,
  scanEstate,
} from '@agent-nexus/driftbench-estate';
import { GUARDS_DIR, REGISTRY_MD, ROOT, RUNTIME, SETTINGS, STANDING } from '../layout';
import type { ItemResult, Tier } from './frame';
import { invent } from './lint-names';

/**
 * Items of lint.defect about where an estate's settings come from, and what a check does when the settings
 * were not read. Each item is a small matrix over the axes of its rule, on invented estates; the expected
 * values are worked out here from the rule, never copied from what the product prints:
 *
 *   the wiring of the policies (the guards) may be stored with the estate, stored in the local file, handed
 *   over as a rendered copy, or not available; the first three give the same estate
 *   a check that compares against the wiring needs the settings: without them it does not run, it reports
 *   nothing, and it says it did not run; a part that only the wiring can name is not called an orphan
 *   a rendered copy never stands beside a stored file of the same place
 */

export type SettingsCase = { key: string; tier: Tier; title: string; judge(): Promise<ItemResult> };

type Source = 'stored' | 'local' | 'rendered' | 'absent';
const SOURCES: readonly Source[] = ['stored', 'local', 'rendered', 'absent'];
const LOCAL_SETTINGS = `${ROOT}/settings.local.json`;
const INSTRUCTION = '# Quay desk assistant\n\nAlways answer in the language of the user.\n';

type Built = {
  top: string;
  root: string;
  /** The rendered copy handed over, for the `rendered` source. */
  settings?: string;
  scripts: string[];
  policies: number;
  strays: number;
};

function wiring(commands: readonly string[]): string {
  const hooks = commands.map((command) => ({ type: 'command', command }));
  return `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks }] } }, null, 2)}\n`;
}

async function write(base: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(base, path)), { recursive: true });
    await writeFile(join(base, path), text);
  }
}

/** An estate of `policies` guards, each with a script and a row in the registry, and `strays` unnamed notes. */
async function build(source: Source, policies: number, strays: number, seed: number): Promise<Built> {
  const top = await mkdtemp(join(tmpdir(), 'driftbench-settings-'));
  const root = join(top, 'home');
  const names = invent(seed, policies, 'guard');
  const files = names.map((name) => `${name}.sh`);
  const scripts = files.map((file) => `${GUARDS_DIR}/${file}`);
  const commands = scripts.map((script) => `"$CLAUDE_PROJECT_DIR"/${script}`);
  const content: Record<string, string> = { [STANDING]: INSTRUCTION };
  for (const script of scripts) content[script] = '#!/bin/sh\nexit 0\n';
  if (policies > 0) {
    const rows = files.map((file, index) => `| G${index + 1} | ${file} | none |`);
    content[REGISTRY_MD] =
      `# Check registry\n\n| Id | Guard | Enforces |\n|---|---|---|\n${rows.join('\n')}\n`;
  }
  for (const stray of invent(seed + 1, strays, 'stray'))
    content[`${ROOT}/notes/${stray}.md`] = `# ${stray}\n`;
  let settings: string | undefined;
  if (policies > 0 && source === 'stored') content[SETTINGS] = wiring(commands);
  if (policies > 0 && source === 'local') content[LOCAL_SETTINGS] = wiring(commands);
  if (policies > 0 && source === 'rendered') {
    settings = join(top, 'rendered', 'install-output.json');
    await write(top, { 'rendered/install-output.json': wiring(commands) });
  }
  await write(root, content);
  return { top, root, ...(settings ? { settings } : {}), scripts, policies, strays };
}

type Read = { scan: ScanEstateResult; raw: RawEstate; lint: LintResult; atoms: Atom[] };

async function read(built: Built, settings: string | null = built.settings ?? null): Promise<Read> {
  const reader = readerFor(RUNTIME, settings !== null ? { settings } : {});
  if (!reader) throw new Error(`no reader for ${RUNTIME}`);
  const scan = await scanEstate({
    root: built.root,
    reader,
    now: () => new Date('2026-10-11T00:00:00.000Z'),
  });
  return { scan, raw: scan.raw, lint: lintEstate(scan.map, scan.raw), atoms: scan.map.atoms };
}

function verdict(problems: string[]): ItemResult {
  return {
    pass: problems.length === 0,
    detail: problems.length === 0 ? 'holds' : problems.slice(0, 3).join('; '),
  };
}

async function cleanly<T>(built: Built, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } finally {
    await rm(built.top, { recursive: true, force: true });
  }
}

const outcomeOf = (lint: LintResult, check: string) => lint.outcomes.find((entry) => entry.check === check);
const countOf = (lint: LintResult, code: string) =>
  lint.findings.filter((entry) => entry.code === code).length;
const GUARD_CHECKS = ['REGISTRY_ROW', 'REGISTRY_GUARD'] as const;

export const SETTINGS_CASES: SettingsCase[] = [
  {
    key: 'settings-source-matrix',
    tier: 2,
    title:
      'a check that compares against the wiring as run when the wiring is read, whatever its source, and as not run, with no finding, when it is not',
    judge: async () => {
      const problems: string[] = [];
      for (const policies of [1, 3]) {
        for (const source of SOURCES) {
          const built = await build(source, policies, 2, 40 + policies);
          const label = `${source}/${policies}`;
          await cleanly(built, async () => {
            const { atoms, lint, raw } = await read(built);
            const wired = source !== 'absent';
            if (raw.guards.length !== (wired ? policies : 0))
              problems.push(`${label}: ${raw.guards.length} guards read, not ${wired ? policies : 0}`);
            // The unnamed notes are the only parts nothing names: the guard scripts are named by the wiring,
            // or the wiring is not there to say.
            if (countOf(lint, 'ORPHAN') !== built.strays)
              problems.push(`${label}: ${countOf(lint, 'ORPHAN')} orphans, not ${built.strays}`);
            for (const check of GUARD_CHECKS) {
              const outcome = outcomeOf(lint, check);
              if (wired) {
                if (outcome?.status !== 'pass')
                  problems.push(`${label}: ${check} is ${outcome?.status}, not pass`);
              } else {
                if (outcome?.status !== 'not-run' || outcome.notRun !== 'missing-capability')
                  problems.push(`${label}: ${check} did not report that it could not run`);
                if (!outcome?.coverage.missing.includes('settings'))
                  problems.push(`${label}: ${check} does not name the settings it lacked`);
              }
              if (countOf(lint, check) !== 0) problems.push(`${label}: ${check} gave findings`);
            }
            for (const code of ['MISSING_SCRIPT', 'UNANCHORED_GUARD'])
              if (countOf(lint, code) !== 0) problems.push(`${label}: ${code} gave findings`);
            if (lint.failed !== built.strays > 0) problems.push(`${label}: failed is ${lint.failed}`);
            // The parts the wiring would name are listed as left out, one per policy, when it is not read.
            const skipped = outcomeOf(lint, 'ORPHAN')?.coverage.skipped ?? [];
            if (skipped.length !== (wired ? 0 : policies))
              problems.push(`${label}: ${skipped.length} orphan checks skipped, not ${wired ? 0 : policies}`);
            const registry = atoms.find(
              (atom) => atom.kind === 'invariant' && atom.fields?.check === 'registry_complete',
            );
            if (registry?.fields?.holds !== wired)
              problems.push(`${label}: the registry invariant holds ${registry?.fields?.holds}`);
            if (!wired && registry?.fields?.guardsRead !== 0)
              problems.push(`${label}: the registry invariant does not say it read 0 guards`);
          });
        }
      }
      return verdict(problems);
    },
  },
  {
    key: 'settings-source-equivalence',
    tier: 3,
    title: 'the same wiring kept in the stored file, the local file or a rendered copy as the same estate',
    judge: async () => {
      const problems: string[] = [];
      for (const policies of [1, 3]) {
        const seen: Array<{ guards: number; kinds: string; findings: string; statuses: string }> = [];
        for (const source of ['stored', 'local', 'rendered'] as const) {
          const built = await build(source, policies, 3, 70 + policies);
          await cleanly(built, async () => {
            const { atoms, lint, raw } = await read(built);
            const kinds: Record<string, number> = {};
            for (const atom of atoms) kinds[atom.kind] = (kinds[atom.kind] ?? 0) + 1;
            seen.push({
              guards: raw.guards.length,
              kinds: JSON.stringify(kinds),
              findings: JSON.stringify(lint.counts),
              statuses: JSON.stringify(lint.outcomes.map((outcome) => [outcome.check, outcome.status])),
            });
          });
        }
        if (JSON.stringify(seen[1]) !== JSON.stringify(seen[0]))
          problems.push(`${policies} policies: the local file reads differently from the stored one`);
        if (JSON.stringify(seen[2]) !== JSON.stringify(seen[0]))
          problems.push(`${policies} policies: the rendered copy reads differently from the stored one`);
      }
      return verdict(problems);
    },
  },
  {
    key: 'rendered-settings-place',
    tier: 2,
    title:
      'a rendered copy as read in the place of the settings file the estate does not store, recorded in the map, and refused beside a stored file of that place',
    judge: async () => {
      const problems: string[] = [];
      const rendered = await build('rendered', 2, 0, 90);
      await cleanly(rendered, async () => {
        const { scan } = await read(rendered);
        if (scan.map.settings !== true) problems.push('the map does not record the rendered copy');
        if (scan.raw.files.filter((file) => file.kind === 'settings').length !== 1)
          problems.push('the rendered copy is not read as the one settings file');
        const without = await read(rendered, null);
        if (without.raw.guards.length !== 0 || without.scan.map.settings === true)
          problems.push('a scan without the copy read guards or recorded one');
      });
      // The local file is another place: a rendered copy beside it is accepted.
      const local = await build('local', 2, 0, 91);
      await cleanly(local, async () => {
        const copy = join(local.top, 'copy.json');
        await write(local.top, { 'copy.json': wiring(['"$CLAUDE_PROJECT_DIR"/hooks/other.sh']) });
        const both = await read(local, copy);
        if (both.raw.files.filter((file) => file.kind === 'settings').length !== 2)
          problems.push('a rendered copy beside the local file was not read');
      });
      // The stored file of the same place: two sources for one place, refused.
      const stored = await build('stored', 2, 0, 92);
      await cleanly(stored, async () => {
        const copy = join(stored.top, 'copy.json');
        await write(stored.top, { 'copy.json': wiring([]) });
        const refused = await read(stored, copy).then(
          () => undefined,
          (error: unknown) => error,
        );
        if (refused === undefined)
          problems.push('a rendered copy beside a stored file of its place was accepted');
      });
      return verdict(problems);
    },
  },
];
