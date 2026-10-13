import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { dimensionOfKind, type IntakeMap, intentDimension } from './map';

/**
 * Path (ii) of the reference set: when no past conversation exists, the owner answers a structured
 * interview built from the approved map. The questions are the owner's decision 2 of 2026-10-11:
 * personas, example interactions per stage, what users never do, tone, languages, channels, and how often
 * each persona and each intent occurs. `driftbench intake interview` writes the questionnaire; the owner
 * fills it in; `driftbench intake from-interview` reads the answers.
 */

const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
  error: 'expected an id: a letter or digit, then letters, digits, dots, underscores or hyphens',
});
const Share = z.number().min(0).nullable();

const Persona = z.strictObject({
  id: Id.describe('A short name for the persona, such as busy-parent.'),
  description: z.string().describe('Who they are and what they want, in a sentence or two.'),
  share: Share.describe('How often this persona writes, relative to the other personas.'),
  map: z
    .record(z.string(), z.string())
    .default({})
    .describe('The value of each persona dimension of the map that describes them.'),
  tone: z.string().default('').describe('How this persona writes: length, politeness, typos, emoji.'),
  languages: z.array(z.string()).describe('The language codes this persona writes in, from languages.'),
  channels: z.array(z.string()).describe('The channels this persona uses, from channels.'),
});

const Intent = z.strictObject({
  value: z.string().min(1).describe('A value of the intent dimension of the map.'),
  share: Share.describe('How often users come with this intent, relative to the other intents.'),
  personas: z.array(Id).optional().describe('The personas that come with it. Default: every persona.'),
});

const Example = z.strictObject({
  stage: z.string().min(1).describe('A value of the stage dimension: where the agent is.'),
  intent: z.string().min(1).describe('The intent of the user.'),
  persona: Id.describe('The persona who writes.'),
  lang: z.string().optional().describe("The language. Default: the persona's first language."),
  channel: z.string().optional().describe("The channel. Default: the persona's first channel."),
  turns: z.array(z.string()).describe('What this user writes next at this stage, one message per item.'),
});

const Never = z.strictObject({
  text: z.string().min(1).describe('Something users never do or say.'),
  match: z
    .array(z.string().min(1))
    .default([])
    .describe('Words or phrases that must never appear in a generated turn (case-insensitive).'),
});

const Language = z.strictObject({
  lang: z.string().min(1).describe('A language code, such as en or nl.'),
  share: Share.describe('How often users write in it, relative to the other languages.'),
  map: z
    .record(z.string(), z.string())
    .default({})
    .describe('The value of each persona dimension of the map this language falls under.'),
});

const Channel = z.strictObject({
  value: z.string().min(1).describe('A channel of the map.'),
  share: Share.describe('How often users come through it, relative to the other channels.'),
});

export const Interview = z
  .strictObject({
    version: z.literal(1).describe('The version of the interview format, 1.'),
    agent: z
      .string()
      .min(1)
      .describe('The agent the interview is about; the reference set built from it names the same agent.'),
    map: z.string().min(1).describe('The approved map, as a path relative to this file.'),
    personas: z.array(Persona).min(1).describe('The kinds of user who write to the agent, one entry each.'),
    intents: z
      .array(Intent)
      .min(1)
      .describe('How often each intent of the map occurs, and which personas come with it.'),
    examples: z
      .array(Example)
      .min(1)
      .describe('Example messages a user writes next at a stage, for one persona and one intent.'),
    never: z.array(Never).default([]).describe('What users never do or say, one entry each.'),
    tone: z
      .string()
      .default('')
      .describe('How users write in general: length, politeness, typos, emoji, slang.'),
    languages: z.array(Language).min(1).describe('The languages users write in, and how often each.'),
    channels: z.array(Channel).min(1).describe('How often users come through each channel of the map.'),
  })
  .describe('The owner interview: the answers path (ii) of the reference set is built from.');
export type Interview = z.infer<typeof Interview>;

export type InterviewIssue = { path: string; message: string };
export type InterviewResult = { ok: true; interview: Interview } | { ok: false; issues: InterviewIssue[] };

/**
 * Parses an interview and checks every answer against the map: each stage, intent, channel and persona
 * value must be an approved value of the map; each reference to a persona or a language must exist; every
 * share must be answered. Returns every issue, not only the first.
 */
export function parseInterview(text: string, map: IntakeMap): InterviewResult {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return { ok: false, issues: [{ path: '(file)', message: firstLine(cause) }] };
  }
  const parsed = Interview.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(file)',
        message: issue.message,
      })),
    };
  }
  const interview = parsed.data;
  const issues: InterviewIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  const stage = dimensionOfKind(map, 'stage');
  const intent = intentDimension(map);
  const channel = dimensionOfKind(map, 'channel');
  const personaDimensions = map.dimensions.filter((dimension) => dimension.kind === 'persona');
  if (!stage) add('map', 'the map has no approved stage dimension');
  if (!intent) add('map', 'the map has no approved intent dimension (flow, intent or a behaviour dimension)');
  const has = (dimension: { values: Array<{ id: string }> } | undefined, value: string) =>
    dimension === undefined || dimension.values.some((entry) => entry.id === value);
  const checkMapValues = (path: string, values: Record<string, string>) => {
    for (const [id, value] of Object.entries(values)) {
      const dimension = personaDimensions.find((entry) => entry.id === id);
      if (!dimension) add(`${path}.${id}`, `"${id}" is not an approved persona dimension of the map`);
      else if (!has(dimension, value)) add(`${path}.${id}`, `"${value}" is not an approved value of ${id}`);
    }
  };
  const unique = (path: string, ids: string[]) => {
    ids.forEach((id, index) => {
      if (ids.indexOf(id) !== index) add(`${path}.${index}`, `"${id}" appears twice`);
    });
  };

  const personaIds = interview.personas.map((persona) => persona.id);
  const langs = interview.languages.map((language) => language.lang);
  const channels = interview.channels.map((entry) => entry.value);
  const intents = interview.intents.map((entry) => entry.value);
  unique('personas', personaIds);
  unique('languages', langs);
  unique('channels', channels);
  unique('intents', intents);

  interview.personas.forEach((persona, index) => {
    const path = `personas.${index}`;
    if (persona.description.trim() === '') add(`${path}.description`, 'not answered');
    if (persona.share === null) add(`${path}.share`, 'not answered');
    if (persona.languages.length === 0) add(`${path}.languages`, 'not answered');
    if (persona.channels.length === 0) add(`${path}.channels`, 'not answered');
    checkMapValues(`${path}.map`, persona.map);
    persona.languages.forEach((lang, l) => {
      if (!langs.includes(lang)) add(`${path}.languages.${l}`, `"${lang}" is not one of languages`);
    });
    persona.channels.forEach((value, c) => {
      if (!channels.includes(value)) add(`${path}.channels.${c}`, `"${value}" is not one of channels`);
    });
  });
  if (interview.personas.every((persona) => (persona.share ?? 0) === 0)) {
    add('personas', 'at least one persona needs a share above 0');
  }
  interview.intents.forEach((entry, index) => {
    const path = `intents.${index}`;
    if (!has(intent, entry.value))
      add(`${path}.value`, `"${entry.value}" is not an approved value of ${intent?.id}`);
    if (entry.share === null) add(`${path}.share`, 'not answered');
    (entry.personas ?? []).forEach((id, p) => {
      if (!personaIds.includes(id)) add(`${path}.personas.${p}`, `"${id}" is not one of personas`);
    });
  });
  interview.languages.forEach((entry, index) => {
    if (entry.share === null) add(`languages.${index}.share`, 'not answered');
    checkMapValues(`languages.${index}.map`, entry.map);
  });
  interview.channels.forEach((entry, index) => {
    const path = `channels.${index}`;
    if (!has(channel, entry.value))
      add(`${path}.value`, `"${entry.value}" is not an approved channel of the map`);
    if (entry.share === null) add(`${path}.share`, 'not answered');
  });
  interview.examples.forEach((example, index) => {
    const path = `examples.${index}`;
    if (!has(stage, example.stage))
      add(`${path}.stage`, `"${example.stage}" is not an approved stage of the map`);
    if (!intents.includes(example.intent)) add(`${path}.intent`, `"${example.intent}" is not one of intents`);
    const persona = interview.personas.find((entry) => entry.id === example.persona);
    if (!persona) add(`${path}.persona`, `"${example.persona}" is not one of personas`);
    if (example.lang !== undefined && persona && !persona.languages.includes(example.lang)) {
      add(`${path}.lang`, `"${example.lang}" is not a language of ${example.persona}`);
    }
    if (example.channel !== undefined && persona && !persona.channels.includes(example.channel)) {
      add(`${path}.channel`, `"${example.channel}" is not a channel of ${example.persona}`);
    }
    example.turns.forEach((turn, t) => {
      if (turn.trim() === '') add(`${path}.turns.${t}`, 'an empty message');
    });
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, interview };
}

/**
 * The questionnaire for an agent, built from its approved map: every question as a comment above its
 * answer slot, and the slots pre-filled with what the map already lists (stages, intents, channels,
 * persona dimensions). Empty slots and null shares are the questions still open.
 */
export function renderQuestionnaire(map: IntakeMap, mapPath: string): string {
  const stage = dimensionOfKind(map, 'stage');
  const intent = intentDimension(map);
  const channel = dimensionOfKind(map, 'channel');
  const personaDimensions = map.dimensions.filter((dimension) => dimension.kind === 'persona');
  const list = (values: Array<{ id: string; title: string }>) =>
    values.map((value) => `#     ${value.id}: ${value.title}`);
  const block = (value: unknown) =>
    stringifyYaml(value, { lineWidth: 0, aliasDuplicateObjects: false }).trimEnd();

  const sections = [
    [
      `# driftbench intake interview for ${map.agent}.`,
      '# Answer every question below in place, then run:',
      '#   driftbench intake from-interview <this file> --map <the map> --out <folder>',
      '# Code turns the answers into a reference set of user turns per cell of the map, and a person approves',
      '# each turn before it counts. Fictional data only in examples: emails at example.com, phones from',
      '# +1 202 555 0100 to 0199. Shares are relative weights: any numbers, normalised by code.',
      block({ version: 1, agent: map.agent, map: mapPath }),
    ],
    [
      '# Q1. Personas. Who writes to the agent? One entry per kind of user. For each: who they are and what',
      '# they want, their share of all users, the map values that describe them, how they write (tone), the',
      '# languages (codes from Q5) and the channels (from Q6) they use.',
      ...(personaDimensions.length > 0
        ? [
            '#   Persona dimensions of the map, for map:',
            ...personaDimensions.flatMap((dimension) => [`#   ${dimension.id}:`, ...list(dimension.values)]),
          ]
        : []),
      block({
        personas: [
          {
            id: 'persona-1',
            description: '',
            share: null,
            map: Object.fromEntries(
              personaDimensions.filter((d) => !isLanguage(d.id)).map((d) => [d.id, d.values[0]?.id ?? '']),
            ),
            tone: '',
            languages: [],
            channels: [],
          },
        ],
      }),
    ],
    [
      `# Q2. Intents. How often does each intent of the map (${intent?.id ?? 'none'}) occur? Give each a share, 0 when`,
      '# users never come with it, and the personas who come with it (leave personas out for all of them).',
      block({ intents: (intent?.values ?? []).map((value) => ({ value: value.id, share: null })) }),
    ],
    [
      '# Q3. Example interactions per stage. When the agent is at a stage, what does a user write next?',
      '# Give two to five real-sounding messages per entry, for one persona and one intent. Add entries for',
      '# other personas, intents, languages or channels. Remove a stage where users never write.',
      ...(stage ? ['#   Stages of the map:', ...list(stage.values)] : []),
      block({
        examples: (stage?.values ?? []).map((value) => ({
          stage: value.id,
          intent: intent?.values[0]?.id ?? '',
          persona: 'persona-1',
          turns: [],
        })),
      }),
    ],
    [
      '# Q4. What do users never do or say? One entry each. Under match, list words a generated turn must',
      '# never contain because of it (optional).',
      block({ never: [{ text: 'example: users never send attachments', match: [] }] }),
    ],
    [
      '# Q4b. Tone. How do your users write in general: length, politeness, typos, emoji, slang?',
      block({ tone: '' }),
    ],
    [
      '# Q5. Languages. Which languages do users write in, and how often each? Under map, the map value',
      '# each language falls under, when the map has a language dimension.',
      block({
        languages: [
          {
            lang: 'en',
            share: null,
            map: Object.fromEntries(
              personaDimensions.filter((d) => isLanguage(d.id)).map((d) => [d.id, d.values[0]?.id ?? '']),
            ),
          },
        ],
      }),
    ],
    [
      '# Q6. Channels. How often do users come through each channel of the map?',
      block({ channels: (channel?.values ?? []).map((value) => ({ value: value.id, share: null })) }),
    ],
  ];
  return `${sections.map((lines) => lines.join('\n')).join('\n\n')}\n`;
}

/** A persona dimension that holds the language, such as `language` or `lang`. */
function isLanguage(id: string): boolean {
  return /^lang/i.test(id);
}

function firstLine(cause: unknown): string {
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
}
