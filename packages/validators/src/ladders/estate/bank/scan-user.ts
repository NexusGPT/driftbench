import { namesFor } from './common';
import type { Tier } from './frame';
import { type Case, standardSkill } from './hostile';
import { BASE, type Check, planting, type ScanOutcome } from './planted';

/**
 * bench.defects, user layer items: the user-level skill layer, read from a folder the owner names
 * (`--user-skills`). Its files keep the folder they were read in, and the checks that run on the project's
 * skills run on the layer's: an orphan, an unreachable skill, a reference to a file that is not there. The
 * oracle: the paths of the layer's atoms start with the folder, and each defect planted in a layer skill is a
 * lint finding on that file.
 */

const READER = 'packages/estate/src/scan/claude-code.ts';
const GRAPH = 'packages/estate/src/graph/analyze.ts';
const FOLDER = '.agents/skills';
const CAUSE = 'keep the folder of the user layer in its paths and run the project checks on its files';

const skillText = (name: string, body: string[]) =>
  [
    '---',
    `name: ${name}`,
    `description: Handle the ${name} chores. Use when the user asks for the ${name} chores.`,
    '---',
    '',
    `# ${name}`,
    '',
    ...body,
    '',
  ].join('\n');

/** A finding of a code on a file of the layer. */
function finding(code: string, subject: string): Check {
  return (scan: ScanOutcome) =>
    scan.lint.findings.some((entry) => entry.code === code && entry.subject === subject)
      ? undefined
      : `the lint gives no ${code} on ${subject}`;
}

function userCase(
  key: string,
  tier: Tier,
  title: string,
  component: string,
  plant: (skill: string) => { files: Array<[string, string]>; checks: Check[] },
): Case {
  return {
    key: `user-${key}`,
    tier,
    title,
    component,
    cause: CAUSE,
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      standardSkill(e, s, o);
      e.userSkills = FOLDER;
      const { files, checks } = plant(names.skill);
      for (const [path, text] of files) e.raw(path, text, BASE);
      for (const check of checks) e.check(o, check);
    },
  };
}

const CASES: Case[] = [
  userCase(
    'keeps-folder',
    2,
    'the paths of a user layer read from a folder of the estate start with that folder',
    READER,
    (skill) => ({
      files: [
        [
          `${FOLDER}/${skill}-user/SKILL.md`,
          skillText(`${skill}-user`, ['Always keep the totals in whole cents.']),
        ],
      ],
      checks: [
        (scan) => (scan.raw.userLayer?.read.length === 1 ? undefined : 'the scan read no skill of the layer'),
        (scan) => {
          const inLayer = scan.map.atoms.filter((atom) => atom.provenance.file.includes(`${skill}-user`));
          if (inLayer.length === 0) return 'the layer gave no atom';
          const stray = inLayer.find((atom) => !atom.provenance.file.startsWith(`${FOLDER}/`));
          return stray
            ? `an atom of the layer is at ${stray.provenance.file}, not under ${FOLDER}`
            : undefined;
        },
      ],
    }),
  ),
  userCase('orphan', 3, 'a file of a user layer skill that nothing names is an orphan', GRAPH, (skill) => {
    const loose = `${FOLDER}/${skill}-user/references/loose.md`;
    return {
      files: [
        [`${FOLDER}/${skill}-user/SKILL.md`, skillText(`${skill}-user`, ['Keep the totals in whole cents.'])],
        [loose, '# Loose\n\nNothing names this file.\n'],
      ],
      checks: [finding('ORPHAN', loose)],
    };
  }),
  userCase(
    'missing-reference',
    3,
    'a user layer skill that names a file that is not there is a missing reference',
    GRAPH,
    (skill) => {
      const body = `${FOLDER}/${skill}-user/SKILL.md`;
      return {
        files: [[body, skillText(`${skill}-user`, ['When unsure, open `references/gone.md`.'])]],
        checks: [
          planting(
            (scan) => {
              const missing = scan.map.atoms.find(
                (atom) =>
                  atom.kind === 'reference' &&
                  atom.fields?.exists === false &&
                  atom.provenance.file.startsWith(`${FOLDER}/`),
              );
              if (!missing) return 'the layer gave no reference atom to a missing file';
              return scan.lint.findings.some(
                (entry) => entry.code === 'MISSING_REFERENCE' && entry.subject === missing.id,
              )
                ? undefined
                : 'the lint gives no MISSING_REFERENCE for the missing file';
            },
            // The naming line is the eighth of the body: the labeller reads it as a reference.
            { kind: 'reference', file: body, line: 8 },
          ),
        ],
      };
    },
  ),
  userCase(
    'unreachable',
    3,
    'a user layer skill that only its description reaches is unreachable from the standing instructions',
    GRAPH,
    (skill) => {
      const body = `${FOLDER}/${skill}-user/SKILL.md`;
      return {
        files: [[body, skillText(`${skill}-user`, ['Keep the totals in whole cents.'])]],
        checks: [finding('UNREACHABLE', body)],
      };
    },
  ),
];

export function userCases(): Case[] {
  return CASES;
}
