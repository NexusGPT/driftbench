import { stringify } from 'yaml';
import { follow } from './follower';
import { drawEstate, type Profile } from './hidden';
import { renderEstate } from './render';
import { situationsOf } from './situations';

/**
 * The committed fixture of a seed: the rendered estate (every file), the truth the validator scores against
 * (atoms, edges, lint findings), the recorded answers of the prose splitter, and the rule follower's session
 * for the first ask of every trigger situation. Same seed, same text: a test compares the committed file
 * with a fresh render, so a change to the generator, the renderer or the follower shows as a diff.
 */

export const FIXTURE_FOLDER = 'packages/validators/fixtures/estate';

export function fixtureName(seed: number, profile: Profile): string {
  return `${profile === 'visible' ? 'seed' : profile}-${seed}.yaml`;
}

export function fixtureText(seed: number, profile: Profile = 'visible'): string {
  const estate = drawEstate(seed, profile);
  const rendered = renderEstate(estate);
  const situations = situationsOf(estate);
  const sessions = situations
    .filter((situation) => situation.use === 'trigger')
    .map((situation) => {
      const ask = situation.phrases[0] as string;
      return { situation: situation.id, ask, ...follow(estate, situations, [ask]) };
    });
  const header = [
    `# The estate validator's generated estate for seed ${seed}, profile ${profile}. Written by code from a hidden`,
    '# specification (packages/validators/src/ladders/estate); every name and value is invented. Regenerate with',
    `# fixtureText(${seed}, '${profile}') and commit the diff only when the generator was meant to change.`,
  ].join('\n');
  const body = stringify(
    {
      seed,
      profile,
      company: estate.company,
      defects: estate.defects,
      files: rendered.files,
      truth: { atoms: rendered.atoms, edges: rendered.edges, findings: rendered.findings },
      recording: rendered.recording,
      sessions,
    },
    { lineWidth: 0, aliasDuplicateObjects: false },
  );
  return `${header}\n${body}`;
}
