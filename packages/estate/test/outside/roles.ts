import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ClaudeCodeReader,
  type ClaudeCodeReaderOptions,
  type LintFinding,
  type LintResult,
  lintEstate,
  scanEstate,
} from '../../src/index';
import { NOW } from '../support';
import { type EstateModel, type GuardFact, type Kind, modelOf } from './model';

/**
 * The tests of the outside-estate fixes state an estate as ROLES (a capability, a guard that runs a script from a
 * base). model.ts reads the roles as parts, aspects and links and says what the checks must find;
 * this file renders the roles in one runtime's layout and reads the product's findings back as KINDS. It is the
 * only file that knows a Claude Code folder layout or a lint code: a new runtime profile gets its own renderer,
 * and a rebuilt check that changes a code changes the one table below. Every name here is invented by the
 * generator.
 */

/** The base a guard's script path is written from. */
export type Base = 'project' | 'home' | 'plugin';

/** Where the folder that stands for the home folder lies, compared with the estate. */
export type HomePlace = 'none' | 'in-layout' | 'beside-layout' | 'outside-root';

/** The spellings of one base, as a shell reads them. A quoted `~` is text: the shell does not expand it. */
export const SPELLINGS: Record<
  Base,
  Array<{ id: string; expands: boolean; write: (rest: string) => string }>
> = {
  project: [
    { id: 'plain', expands: true, write: (rest) => `$CLAUDE_PROJECT_DIR/${rest}` },
    { id: 'braced', expands: true, write: (rest) => `\${CLAUDE_PROJECT_DIR}/${rest}` },
    { id: 'quoted', expands: true, write: (rest) => `"$CLAUDE_PROJECT_DIR/${rest}"` },
  ],
  plugin: [
    { id: 'plain', expands: true, write: (rest) => `$CLAUDE_PLUGIN_ROOT/${rest}` },
    { id: 'braced', expands: true, write: (rest) => `\${CLAUDE_PLUGIN_ROOT}/${rest}` },
  ],
  home: [
    { id: 'plain', expands: true, write: (rest) => `$HOME/${rest}` },
    { id: 'braced', expands: true, write: (rest) => `\${HOME}/${rest}` },
    { id: 'quoted', expands: true, write: (rest) => `"$HOME/${rest}"` },
    { id: 'quoted-braced', expands: true, write: (rest) => `"\${HOME}/${rest}"` },
    { id: 'tilde', expands: true, write: (rest) => `~/${rest}` },
    { id: 'quoted-tilde', expands: false, write: (rest) => `"~/${rest}"` },
    { id: 'single-quoted-tilde', expands: false, write: (rest) => `'~/${rest}'` },
    { id: 'single-quoted-variable', expands: false, write: (rest) => `'$HOME/${rest}'` },
  ],
};

/** The shapes of a guard command around its script path. */
export const SHAPES: Array<{ id: string; write: (path: string) => string }> = [
  { id: 'direct', write: (path) => path },
  { id: 'interpreter', write: (path) => `python3 ${path}` },
  { id: 'env-prefix', write: (path) => `MODE=strict python3 ${path}` },
  { id: 'guarded', write: (path) => `[ -n "$GUARDS_ON" ] || python3 ${path}` },
];

/** A guard that runs `script` from a base. `present` says whether the script is where the base points. */
export type GuardRole = {
  event?: string;
  base: Base;
  spelling: number;
  shape: number;
  script: string;
  present: boolean;
};

export type Role = {
  /** Capabilities: a skill or a helper the estate holds. */
  skills?: string[];
  guards?: GuardRole[];
  /** A guard command the oracle does not read (a form outside the matrix). */
  rawGuards?: Array<{ event?: string; command: string }>;
  /** Where the folder that stands for the home folder lies. */
  homeAt?: HomePlace;
  /** More files, by path: scripts, junk. */
  files?: Record<string, string>;
  /** Where the hooks are written: the shared settings file or the local one. */
  settingsFile?: 'settings.json' | 'settings.local.json';
};

export type Rendered = { root: string; home: string | undefined };

const skillText = (name: string) =>
  `---\nname: ${name}\ndescription: Keeps the ${name} notes.\n---\n\nKeep the notes short.\n`;
const BASE_NAME = 'user-base';

/** The folder that stands for home, and the path of the file a guard script has under it. */
function homeFolder(root: string, at: HomePlace): string | undefined {
  return {
    none: undefined,
    'in-layout': join(root, '.claude', BASE_NAME),
    'beside-layout': join(root, BASE_NAME),
    'outside-root': join(dirname(root), BASE_NAME),
  }[at];
}

/** Writes the roles in the Claude Code layout under a new folder. */
export async function render(role: Role, into?: string): Promise<Rendered> {
  const root = into ?? join(await mkdtemp(join(tmpdir(), 'driftbench-roles-')), 'estate');
  const home = homeFolder(root, role.homeAt ?? 'none');
  const files: Record<string, string> = {
    'CLAUDE.md': `# Synthetic estate\n\n${(role.skills ?? []).map((name) => `For ${name} notes, load \`${name}\`.`).join('\n')}\n`,
    ...role.files,
  };
  for (const name of role.skills ?? []) files[`.claude/skills/${name}/SKILL.md`] = skillText(name);
  const commands: Array<{ event: string; command: string }> = [];
  for (const guard of role.guards ?? []) {
    // The project and plugin folders are the estate root; the layout folder is a folder inside it.
    const written = guard.base === 'home' ? guard.script : `.claude/${guard.script}`;
    const spelling = SPELLINGS[guard.base][guard.spelling] ?? SPELLINGS[guard.base][0];
    const shape = SHAPES[guard.shape % SHAPES.length] ?? SHAPES[0];
    commands.push({
      event: guard.event ?? 'PreToolUse',
      command: shape?.write(spelling?.write(written) ?? '') ?? '',
    });
    if (guard.present && spelling?.expands) {
      const at = guard.base === 'home' ? home : join(root, '.claude');
      if (at !== undefined) files[join(at, guard.script)] = '#!/usr/bin/env python3\n';
    }
  }
  for (const raw of role.rawGuards ?? [])
    commands.push({ event: raw.event ?? 'PreToolUse', command: raw.command });
  const settings: Record<string, unknown> = {};
  if (commands.length > 0) {
    const events = [...new Set(commands.map((entry) => entry.event))];
    settings.hooks = Object.fromEntries(
      events.map((event) => [
        event,
        [
          {
            matcher: 'Bash',
            hooks: commands
              .filter((entry) => entry.event === event)
              .map((entry) => ({ type: 'command', command: entry.command })),
          },
        ],
      ]),
    );
  }
  if (Object.keys(settings).length > 0)
    files[`.claude/${role.settingsFile ?? 'settings.json'}`] = JSON.stringify(settings, null, 2);
  for (const [path, text] of Object.entries(files)) {
    const full = path.startsWith('/') ? path : join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text);
  }
  return { root, home };
}

/** The model of a role: parts, aspects and links, with what the run can read. */
export function modelOfRole(role: Role): EstateModel {
  const guards: GuardFact[] = (role.guards ?? []).map((guard) => {
    const spelling = SPELLINGS[guard.base][guard.spelling] ?? SPELLINGS[guard.base][0];
    const mapped = guard.base !== 'home' || (role.homeAt ?? 'none') !== 'none';
    return {
      expands: spelling?.expands ?? true,
      readable: mapped,
      present: guard.present && (spelling?.expands ?? true),
      ...(mapped ? {} : { unreadable: 'home-not-mapped' }),
    };
  });
  return modelOf({
    skills: role.skills ?? [],
    guards,
  });
}

/**
 * Lint codes the product prints, read as kinds. A code outside the table stays as itself, so a finding nobody
 * planted shows up in a comparison.
 */
const KIND_OF: Record<string, Kind> = {
  MISSING_SCRIPT: 'missing-script',
  UNANCHORED_GUARD: 'unanchored-guard',
};
/** The check ids whose coverage the tests read. */
export const CHECK_MISSING_SCRIPT = 'MISSING_SCRIPT';

/** The reader options of a run; `home` is the folder the run is told stands for the home folder. */
export function readerOptions(home: string | undefined): ClaudeCodeReaderOptions {
  return home === undefined ? {} : { home };
}

/** Scans and lints a folder. */
export async function lintResult(root: string, home?: string): Promise<LintResult> {
  const reader = new ClaudeCodeReader(readerOptions(home));
  const { map, raw } = await scanEstate({ root, reader, now: NOW });
  return lintEstate(map, raw);
}

/** The findings of a run, as the kinds the oracle speaks (sorted). */
export async function kindsOf(root: string, home?: string): Promise<string[]> {
  const findings = (await lintResult(root, home)).findings.filter(
    (finding: LintFinding) => finding.code !== 'UNENFORCED',
  );
  return findings.map((finding) => KIND_OF[finding.code] ?? finding.code).sort();
}

/** Renders a role and lints it with the home folder the role places. */
export async function runRole(role: Role, into?: string): Promise<string[]> {
  const rendered = await render(role, into);
  return kindsOf(rendered.root, rendered.home);
}

/** The scripts the guards run, as the map names them. A mapped home shows as `~/...`, never as a real folder. */
export async function guardScripts(
  role: Role,
): Promise<{ scripts: Array<string | undefined>; home?: string }> {
  const { root, home } = await render(role);
  const raw = await new ClaudeCodeReader(readerOptions(home)).read(root);
  return { scripts: raw.guards.map((guard) => guard.script), ...(home === undefined ? {} : { home }) };
}
