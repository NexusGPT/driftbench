import { stringify } from 'yaml';
import { oracleRecording } from './oracle';
import { INVENTORY_PATH, PROMPT_PATH, render, TOOLS_PATH } from './render';
import { hiddenSpec } from './spec';
import { baseOptions } from './transforms';
import { truthOf } from './truth';

/** Where the rendered fixtures of a seed live, from the repository root. */
export const MAP_FIXTURES = 'packages/validators/fixtures/map';

/**
 * The files a seed renders to, as a person reads them: the three artefacts, the perfect model's recorded
 * answers, and the truth with each atom's span. The fixture test compares them with the files in
 * MAP_FIXTURES, so a change to the renderer or the specification shows up as a diff a person can read.
 */
export function fixtureFiles(seed: number): Record<string, string> {
  const spec = hiddenSpec(seed);
  const rendered = render(spec, baseOptions(spec));
  const truth = truthOf(spec);
  const spans = Object.fromEntries(
    [...rendered.spans].map(([id, span]) => [
      id,
      { ...span, text: rendered.prompt.slice(span.start, span.end) },
    ]),
  );
  const header = (what: string) =>
    `# ${what} of the map validator, seed ${seed}. Written by code from the hidden specification; every name is fictional.\n`;
  return {
    [PROMPT_PATH]: rendered.prompt,
    [INVENTORY_PATH]: rendered.inventory,
    [TOOLS_PATH]: rendered.tools,
    // With the declared roles: the replay sends them only when the contract asks for one (`contractStatesRole`),
    // so the file stays the same whichever contract the extractor has.
    'answers.yaml': `${header('The perfect model answers, each dimension with its declared role,')}${stringify(
      oracleRecording(spec, rendered, { roles: true }),
      { lineWidth: 0 },
    )}`,
    'truth.yaml': `${header('The truth')}${stringify(
      { ...truth, spans, decoys: rendered.decoys, order: rendered.order },
      { lineWidth: 0 },
    )}`,
  };
}
