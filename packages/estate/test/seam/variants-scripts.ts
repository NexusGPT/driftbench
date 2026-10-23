import type { Files, PartRef } from './observe';
import { type Built, type Eol, join, junk, PLAIN_BODY, rng, skillFile, text, word } from './variants';

// ---------------------------------------------------------------------------------------------------------------------
// Fix 9: imports between script files

export type Lang = 'python' | 'javascript' | 'typescript';
export type Placement = 'sibling' | 'subfolder' | 'parent' | 'folder-index';
export type Where = 'hook' | 'skill';

export type ScriptForm = {
  key: string;
  lang: Lang;
  placement: Placement;
  lines: (m: ModuleNames) => string[];
};

/** What a form needs to write: the module's file stem and, for a package, its folder. */
export type ModuleNames = { stem: string; pkg: string };

export const SCRIPT_FORMS: readonly ScriptForm[] = [
  // Python: sibling
  {
    key: 'py-import',
    lang: 'python',
    placement: 'sibling',
    lines: (m) => [`import ${m.stem}`, `${m.stem}.fn()`],
  },
  {
    key: 'py-import-as',
    lang: 'python',
    placement: 'sibling',
    lines: (m) => [`import ${m.stem} as lib`, 'lib.fn()'],
  },
  {
    key: 'py-from-import',
    lang: 'python',
    placement: 'sibling',
    lines: (m) => [`from ${m.stem} import fn`, 'fn()'],
  },
  {
    key: 'py-from-dot-import',
    lang: 'python',
    placement: 'sibling',
    lines: (m) => [`from . import ${m.stem}`, `${m.stem}.fn()`],
  },
  {
    key: 'py-from-dot-module',
    lang: 'python',
    placement: 'sibling',
    lines: (m) => [`from .${m.stem} import fn`, 'fn()'],
  },
  {
    key: 'py-comma-list',
    lang: 'python',
    placement: 'sibling',
    lines: (m) => [`import os, ${m.stem}`, `${m.stem}.fn()`],
  },
  {
    key: 'py-multiline',
    lang: 'python',
    placement: 'sibling',
    lines: (m) => [`from ${m.stem} import (`, '    fn,', '    fn as other,', ')', 'fn()'],
  },
  {
    key: 'py-indented',
    lang: 'python',
    placement: 'sibling',
    lines: (m) => ['def main():', `    import ${m.stem}`, `    return ${m.stem}.fn()`],
  },
  {
    key: 'py-try',
    lang: 'python',
    placement: 'sibling',
    lines: (m) => ['try:', `    import ${m.stem}`, 'except ImportError:', `    ${m.stem} = None`],
  },
  // Python: package below
  {
    key: 'py-pkg-import',
    lang: 'python',
    placement: 'subfolder',
    lines: (m) => [`import ${m.pkg}.${m.stem}`, `${m.pkg}.${m.stem}.fn()`],
  },
  {
    key: 'py-pkg-from',
    lang: 'python',
    placement: 'subfolder',
    lines: (m) => [`from ${m.pkg} import ${m.stem}`, `${m.stem}.fn()`],
  },
  {
    key: 'py-pkg-from-module',
    lang: 'python',
    placement: 'subfolder',
    lines: (m) => [`from ${m.pkg}.${m.stem} import fn`, 'fn()'],
  },
  {
    key: 'py-pkg-relative',
    lang: 'python',
    placement: 'subfolder',
    lines: (m) => [`from .${m.pkg} import ${m.stem}`, `${m.stem}.fn()`],
  },
  {
    key: 'py-pkg-relative-module',
    lang: 'python',
    placement: 'subfolder',
    lines: (m) => [`from .${m.pkg}.${m.stem} import fn`, 'fn()'],
  },
  // Python: module above
  {
    key: 'py-parent-from',
    lang: 'python',
    placement: 'parent',
    lines: (m) => [`from .. import ${m.stem}`, `${m.stem}.fn()`],
  },
  {
    key: 'py-parent-module',
    lang: 'python',
    placement: 'parent',
    lines: (m) => [`from ..${m.stem} import fn`, 'fn()'],
  },
  // JavaScript and TypeScript
  {
    key: 'js-import-named',
    lang: 'javascript',
    placement: 'sibling',
    lines: (m) => [`import { fn } from './${m.stem}.js';`, 'fn();'],
  },
  {
    key: 'js-import-default',
    lang: 'javascript',
    placement: 'sibling',
    lines: (m) => [`import lib from './${m.stem}.js';`, 'lib();'],
  },
  {
    key: 'js-import-star',
    lang: 'javascript',
    placement: 'sibling',
    lines: (m) => [`import * as lib from "./${m.stem}.js";`, 'lib.fn();'],
  },
  {
    key: 'js-import-bare',
    lang: 'javascript',
    placement: 'sibling',
    lines: (m) => [`import './${m.stem}.js';`],
  },
  {
    key: 'js-export-star',
    lang: 'javascript',
    placement: 'sibling',
    lines: (m) => [`export * from './${m.stem}.js';`],
  },
  {
    key: 'js-export-named',
    lang: 'javascript',
    placement: 'sibling',
    lines: (m) => [`export { fn } from './${m.stem}.js';`],
  },
  {
    key: 'js-require',
    lang: 'javascript',
    placement: 'sibling',
    lines: (m) => [`const lib = require('./${m.stem}.js');`, 'lib.fn();'],
  },
  {
    key: 'js-require-extensionless',
    lang: 'javascript',
    placement: 'sibling',
    lines: (m) => [`const lib = require("./${m.stem}");`, 'lib.fn();'],
  },
  {
    key: 'js-dynamic',
    lang: 'javascript',
    placement: 'sibling',
    lines: (m) => [`const lib = await import('./${m.stem}.js');`, 'lib.fn();'],
  },
  {
    key: 'js-multiline',
    lang: 'javascript',
    placement: 'sibling',
    lines: (m) => ['import {', '  fn,', '  other,', `} from './${m.stem}.js';`],
  },
  {
    key: 'js-subfolder',
    lang: 'javascript',
    placement: 'subfolder',
    lines: (m) => [`import { fn } from './${m.pkg}/${m.stem}.js';`, 'fn();'],
  },
  {
    key: 'js-parent',
    lang: 'javascript',
    placement: 'parent',
    lines: (m) => [`import { fn } from '../${m.stem}.js';`, 'fn();'],
  },
  {
    key: 'js-folder-index',
    lang: 'javascript',
    placement: 'folder-index',
    lines: (m) => [`import { fn } from './${m.pkg}';`, 'fn();'],
  },
  {
    key: 'ts-import',
    lang: 'typescript',
    placement: 'sibling',
    lines: (m) => [`import { fn } from './${m.stem}';`, 'fn();'],
  },
  {
    key: 'ts-import-js-name',
    lang: 'typescript',
    placement: 'sibling',
    lines: (m) => [`import { fn } from './${m.stem}.js';`, 'fn();'],
  },
  {
    key: 'ts-import-type',
    lang: 'typescript',
    placement: 'sibling',
    lines: (m) => [`import type { Fn } from './${m.stem}';`],
  },
  {
    key: 'ts-import-equals',
    lang: 'typescript',
    placement: 'sibling',
    lines: (m) => [`import lib = require('./${m.stem}');`, 'lib.fn();'],
  },
  {
    key: 'ts-subfolder',
    lang: 'typescript',
    placement: 'subfolder',
    lines: (m) => [`import { fn } from './${m.pkg}/${m.stem}';`, 'fn();'],
  },
  {
    key: 'ts-folder-index',
    lang: 'typescript',
    placement: 'folder-index',
    lines: (m) => [`import { fn } from './${m.pkg}';`, 'fn();'],
  },
];

const EXT: Record<Lang, string> = { python: 'py', javascript: 'js', typescript: 'ts' };
const RUNNER: Record<Lang, string> = { python: 'python3', javascript: 'node', typescript: 'node' };

export type ScriptAxes = { form: ScriptForm; where: Where; eol: Eol; size: number; packageInit: boolean };

export type ScriptMods = Partial<{
  /** Drop the import lines from the entry script. */
  omitImport: boolean;
  eol: Eol;
  size: number;
  nest: readonly string[];
  /** Another folder name for the whole hooks or scripts tree, with the one place that names the entry updated. */
  renameTree: string;
  /** The key of a decoy (see `scriptDecoys`) that looks like an import and is none, placed in the entry script. */
  decoy: string;
  /** Delete the module file. */
  deleteModule: boolean;
  /** An unrelated script file that names nothing. */
  extraScript: boolean;
}>;

export type ScriptBuilt = Built & { moduleOrphanObservable: boolean };

export function scriptEstate(axes: ScriptAxes, mods: ScriptMods = {}, seed = 13): ScriptBuilt {
  const next = rng(seed);
  const lang = axes.form.lang;
  const ext = EXT[lang];
  const eol = mods.eol ?? axes.eol;
  const tree = mods.renameTree ?? (axes.where === 'hook' ? 'hooks' : 'scripts');
  const skill = word(next);
  const base = axes.where === 'hook' ? `.claude/${tree}` : `.claude/skills/${skill}/${tree}`;
  const names: ModuleNames = { stem: word(next), pkg: word(next, 2) };
  const entry = `${word(next)}.${ext}`;
  // Entry stands in `<base>/run/`, one folder below the tree, so a `parent` module stands in the tree itself.
  const entryFolder = join(base, 'run');
  const entryPath = join(entryFolder, entry);
  let modulePath: string;
  switch (axes.form.placement) {
    case 'sibling':
      modulePath = join(entryFolder, `${names.stem}.${ext}`);
      break;
    case 'subfolder':
      modulePath = join(entryFolder, names.pkg, `${names.stem}.${ext}`);
      break;
    case 'parent':
      modulePath = join(base, `${names.stem}.${ext}`);
      break;
    case 'folder-index':
      modulePath = join(entryFolder, names.pkg, `index.${ext}`);
      break;
  }
  const files: Files = {};
  const decoy = mods.decoy
    ? (scriptDecoys(lang, names).find((entry) => entry.key === mods.decoy)?.lines ?? [])
    : [];
  const importLines = mods.omitImport ? [] : axes.form.lines(names);
  const header = lang === 'python' ? ['#!/usr/bin/env python3'] : [];
  files[entryPath] = text([...header, ...decoy, ...importLines, ''], eol);
  if (!mods.deleteModule)
    files[modulePath] =
      lang === 'python'
        ? text(['def fn():', '    return 1'], 'lf')
        : text(['export function fn() { return 1; }', 'export function other() { return 2; }'], 'lf');
  if (lang === 'python' && axes.packageInit && axes.form.placement === 'subfolder')
    files[join(entryFolder, names.pkg, '__init__.py')] = text(['# package'], 'lf');
  if (mods.extraScript) files[join(entryFolder, `${word(next)}.${ext}`)] = text(['print("hi")'], 'lf');

  const command = `${RUNNER[lang]} "$CLAUDE_PROJECT_DIR"/${entryPath}`;
  if (axes.where === 'hook') {
    files['.claude/settings.json'] = `${JSON.stringify(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } },
      null,
      2,
    )}\n`;
    files['CLAUDE.md'] = text(['# Rules', '', ...PLAIN_BODY], 'lf');
  } else {
    files[`.claude/skills/${skill}/SKILL.md`] = text(
      skillFile(skill, [...PLAIN_BODY, '', `Run \`${RUNNER[lang]} ${tree}/run/${entry}\` to count.`]),
      'lf',
    );
    files['CLAUDE.md'] = text(['# Rules', '', ...PLAIN_BODY], 'lf');
  }
  junk(files, mods.size ?? axes.size, next);
  return {
    label: `${axes.form.key}/${axes.where}/${eol}/${axes.size}${axes.packageInit ? '/init' : ''}`,
    files,
    parts: [
      { id: 'entry', path: entryPath },
      { id: 'module', path: modulePath },
    ],
    orphanObservable: true,
    moduleOrphanObservable: true,
    ...(mods.nest ? { nest: mods.nest } : {}),
  };
}

export function scriptMatrix(): ScriptAxes[] {
  const out: ScriptAxes[] = [];
  let i = 0;
  for (const form of SCRIPT_FORMS) {
    for (const where of ['hook', 'skill'] as const) {
      out.push({
        form,
        where,
        eol: (i >> 1) % 2 === 0 ? 'lf' : 'crlf',
        size: i % 11 === 0 ? 30 : i % 4 === 0 ? 5 : 0,
        packageInit: i % 3 === 0,
      });
      i += 1;
    }
  }
  return out;
}

/** Text that looks like an import and is none. The module it names stands in the estate and is named by nothing else. */
export function scriptDecoys(lang: Lang, names: ModuleNames): Array<{ key: string; lines: string[] }> {
  if (lang === 'python')
    return [
      { key: 'comment', lines: [`# import ${names.stem}`] },
      { key: 'comment-from', lines: [`# from ${names.stem} import fn`] },
      { key: 'docstring', lines: ['"""', `import ${names.stem}`, '"""'] },
      { key: 'string', lines: [`text = "import ${names.stem}"`] },
    ];
  return [
    { key: 'line-comment', lines: [`// import { fn } from './${names.stem}.js';`] },
    { key: 'block-comment', lines: ['/*', ` * const lib = require('./${names.stem}.js');`, ' */'] },
    { key: 'string', lines: [`const text = "import { fn } from './${names.stem}.js'";`] },
    { key: 'template', lines: [`const text = \`require('./${names.stem}.js')\`;`] },
  ];
}

/** Imports that name no file of the estate: the standard library and installed packages. They give no link and no finding. */
export function packageImports(lang: Lang): string[] {
  return lang === 'python'
    ? ['import json', 'from os import path', 'import xml.etree.ElementTree as ET']
    : ["import fs from 'node:fs';", "import pad from 'left-pad';", "const path = require('path');"];
}
