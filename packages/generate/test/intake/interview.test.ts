import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { loadIntakeMap, parseInterview, renderQuestionnaire } from '../../src/intake';
import { ZED_ANSWERS, ZED_MAP } from './fixtures';
import { ACME } from './support';

describe('renderQuestionnaire', () => {
  it('asks the decision-2 questions and pre-fills the slots from the map', () => {
    const text = renderQuestionnaire(ZED_MAP, 'map.yaml');
    for (const question of [
      'Q1. Personas',
      'Q2. Intents',
      'Q3. Example interactions per stage',
      'Q4. What do users never',
      'Q4b. Tone',
      'Q5. Languages',
      'Q6. Channels',
    ]) {
      expect(text).toContain(question);
    }
    const raw = parseYaml(text) as Record<string, unknown>;
    expect(raw.map).toBe('map.yaml');
    expect((raw.intents as Array<{ value: string; share: null }>).map((entry) => entry.value)).toEqual([
      'balance',
      'card-lost',
    ]);
    expect((raw.examples as Array<{ stage: string }>).map((entry) => entry.stage)).toEqual([
      'greet',
      'verify',
      'help',
    ]);
    expect((raw.channels as Array<{ value: string }>).map((entry) => entry.value)).toEqual(['chat', 'email']);
    expect((raw.personas as Array<{ map: object }>)[0]?.map).toEqual({ user_type: 'customer' });
    expect((raw.languages as Array<{ map: object }>)[0]?.map).toEqual({ language: 'english' });
  });

  it('reads back as an interview whose open questions are each reported as not answered', () => {
    const result = parseInterview(renderQuestionnaire(ZED_MAP, 'map.yaml'), ZED_MAP);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.issues.map((issue) => `${issue.path} ${issue.message}`);
    expect(paths).toContain('personas.0.description not answered');
    expect(paths).toContain('personas.0.share not answered');
    expect(paths).toContain('intents.1.share not answered');
    expect(paths).toContain('languages.0.share not answered');
    expect(paths).toContain('channels.0.share not answered');
  });

  it('builds the Acme questionnaire from the approved Acme map', async () => {
    const loaded = await loadIntakeMap(`${ACME}map/approved.yaml`);
    if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
    const raw = parseYaml(renderQuestionnaire(loaded.map, '../map/approved.yaml')) as Record<string, unknown>;
    expect((raw.examples as unknown[]).length).toBe(13);
    expect((raw.intents as Array<{ value: string }>).map((entry) => entry.value)).toContain('price-sheet');
  });
});

describe('parseInterview', () => {
  it('accepts complete answers that match the map', () => {
    const result = parseInterview(ZED_ANSWERS, ZED_MAP);
    expect(result.ok).toBe(true);
  });

  it('refuses values the map does not approve and references that do not exist, every one of them', () => {
    const broken = ZED_ANSWERS.replace('stage: greet', 'stage: farewell')
      .replace('map: { user_type: customer }', 'map: { user_type: robot, mood: happy }')
      .replace('{ value: chat, share: 4 }', '{ value: fax, share: 4 }')
      .replace('persona: teller\n    turns: ["my', 'persona: ghost\n    turns: ["my')
      .replace('channels: [chat, email]', 'channels: [chat, email, pigeon]');
    const result = parseInterview(broken, ZED_MAP);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual([
      'personas.0.map.user_type',
      'personas.0.map.mood',
      'personas.0.channels.0',
      'personas.0.channels.2',
      'personas.1.channels.0',
      'channels.0.value',
      'examples.0.stage',
      'examples.2.persona',
    ]);
  });

  it('refuses an unknown key, a duplicate persona and a share left empty', () => {
    expect(parseInterview(`${ZED_ANSWERS}extra: 1\n`, ZED_MAP)).toMatchObject({ ok: false });
    const twice = ZED_ANSWERS.replace('- id: teller', '- id: saver');
    const result = parseInterview(twice, ZED_MAP);
    expect(result.ok === false && result.issues.map((issue) => issue.path)).toContain('personas.1');
    const empty = ZED_ANSWERS.replace('share: 3', 'share: null');
    expect(parseInterview(empty, ZED_MAP)).toMatchObject({
      ok: false,
      issues: [{ path: 'personas.0.share', message: 'not answered' }],
    });
  });
});
