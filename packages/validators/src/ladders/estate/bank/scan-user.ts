import { namesFor } from './common';
import type { Tier } from './frame';
import { type Case, standardSkill } from './hostile';
import { BASE, type Check, planting } from './planted';

/**
 * bench.defects, second-source items: capabilities read from a folder the owner names beside the setup
 * (`--user-skills`), inside the estate or outside it. A part of such a source is named by the folder it was read
 * in, and the checks that run on the setup's capabilities run on the source's: an orphan, an unreachable
 * capability, a link to a part that is not there. The oracle: the paths of the source's atoms contain its folder,
 * and each defect planted in a source capability is a lint finding on it.
 */

const READER = 'packages/estate/src/scan/claude-code.ts';
const GRAPH = 'packages/estate/src/graph/analyze.ts';
const CAUSE = 'name a second source by its real folder and run the checks of the setup on its parts';

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

/** The two places a source lies: a folder of the estate, and a folder beside it. */
const PLACES = [
  { key: 'inside', title: 'inside the estate', folder: 'shared-kit/skills', outside: false },
  { key: 'outside', title: 'beside the estate', folder: 'outside/loose-kit/skills', outside: true },
] as const;
type Place = (typeof PLACES)[number];

const FOLDER_NAME = (place: Place) => (place.outside ? 'loose-kit' : 'shared-kit');

/** A finding of a code on a file of the source. */
function finding(code: string, file: string): Check {
  return (scan) =>
    scan.lint.findings.some((entry) => entry.code === code && entry.subject.endsWith(file))
      ? undefined
      : `the lint gives no ${code} on a file ending ${file}`;
}

function sourceCase(
  place: Place,
  key: string,
  tier: Tier,
  title: string,
  component: string,
  plant: (skill: string, put: (path: string, text: string) => void) => Check[],
): Case {
  return {
    key: `source-${place.key}-${key}`,
    tier,
    title: `${title} (${place.title})`,
    component,
    cause: CAUSE,
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      standardSkill(e, s, o);
      e.userSkills = place.folder;
      const put = (path: string, text: string) => {
        if (place.outside) e.outsideFile(`${place.folder.replace(/^outside\//, '')}/${path}`, text);
        else e.raw(`${place.folder}/${path}`, text, BASE);
      };
      for (const check of plant(`${names.skill}-src`, put)) e.check(o, check);
    },
  };
}

const CASES: Case[] = PLACES.flatMap((place): Case[] => [
  sourceCase(
    place,
    'keeps-folder',
    2,
    'the paths of a source start with the folder it was read in',
    READER,
    (skill, put) => {
      put(`${skill}/SKILL.md`, skillText(skill, ['Always keep the totals in whole cents.']));
      return [
        (scan) =>
          scan.raw.userLayer?.read.length === 1 ? undefined : 'the scan read no capability of the source',
        (scan) => {
          const inSource = scan.map.atoms.filter((atom) => atom.provenance.file.includes(skill));
          if (inSource.length === 0) return 'the source gave no atom';
          const stray = inSource.find((atom) => !atom.provenance.file.includes(FOLDER_NAME(place)));
          return stray
            ? `an atom of the source is at ${stray.provenance.file}, which holds no ${FOLDER_NAME(place)}`
            : undefined;
        },
      ];
    },
  ),
  sourceCase(
    place,
    'orphan',
    3,
    'a file of a source capability that nothing names is an orphan',
    GRAPH,
    (skill, put) => {
      put(`${skill}/SKILL.md`, skillText(skill, ['Keep the totals in whole cents.']));
      put(`${skill}/references/loose.md`, '# Loose\n\nNothing names this file.\n');
      return [finding('ORPHAN', `${skill}/references/loose.md`)];
    },
  ),
  // The planted-truth labeller reads the estate's own files by logical path; a line of a source beside the estate
  // cannot be named to it, so this item is the inside one (the generated matrix covers a source beside the estate).
  ...(place.outside
    ? []
    : [
        sourceCase(
          place,
          'missing-reference',
          3,
          'a source capability that names a part that is not there has an unresolved link',
          GRAPH,
          (skill, put) => {
            const body = `${skill}/SKILL.md`;
            put(body, skillText(skill, ['When unsure, open `references/gone.md`.']));
            return [
              planting(
                (scan) => {
                  const missing = scan.map.atoms.find(
                    (atom) =>
                      atom.kind === 'reference' &&
                      atom.fields?.exists === false &&
                      atom.provenance.file.includes(skill),
                  );
                  if (!missing) return 'the source gave no reference atom to a missing part';
                  return scan.lint.findings.some(
                    (entry) => entry.code === 'MISSING_REFERENCE' && entry.subject === missing.id,
                  )
                    ? undefined
                    : 'the lint gives no MISSING_REFERENCE for the missing part';
                },
                // The naming line is the eighth of the body: the labeller reads it as a reference.
                { kind: 'reference', file: `${place.folder}/${body}`, line: 8 },
              ),
            ];
          },
        ),
      ]),
  sourceCase(
    place,
    'unreachable',
    3,
    'a source capability only its description reaches is unreachable',
    GRAPH,
    (skill, put) => {
      put(`${skill}/SKILL.md`, skillText(skill, ['Keep the totals in whole cents.']));
      return [finding('UNREACHABLE', `${skill}/SKILL.md`)];
    },
  ),
]);

export function userCases(): Case[] {
  return CASES;
}
