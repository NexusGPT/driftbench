import { describe, expect, it } from 'vitest';
import {
  createHttpLabeler,
  createJevLabeler,
  createOpenAiDecisionsLabeler,
  LabelerConfigError,
  type LabelSet,
} from '../../src/pointer';
import { BAKERY, fakeFetch, load, windowOf } from './support';

const [BAKE] = load(BAKERY) as [LabelSet];

type Make = (status: number) => ReturnType<typeof createJevLabeler>;

const LABELERS: Array<[string, Make, string]> = [
  [
    'jev on the gateway route',
    (status) =>
      createJevLabeler({
        env: { JEV_API_KEY: 'k', JEV_ROUTE: 'gateway' },
        fetch: fakeFetch({ detail: 'no' }, [], status),
        maxRetries: 0,
      }),
    'jev-gateway.nexus-orga.gpt.nexus',
  ],
  [
    'jev on a URL from JEV_URL',
    (status) =>
      createJevLabeler({
        env: { JEV_API_KEY: 'k', JEV_URL: 'https://jev.example.test/v1/secret-path?token=abc' },
        fetch: fakeFetch({ detail: 'no' }, [], status),
        maxRetries: 0,
      }),
    'jev.example.test',
  ],
  [
    'openai decisions',
    (status) =>
      createOpenAiDecisionsLabeler({
        model: 'decide-1',
        env: { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'https://decisions.example.test/' },
        fetch: fakeFetch({ error: 'no' }, [], status),
        maxRetries: 0,
      }),
    'decisions.example.test',
  ],
  [
    'an http labeler with a key variable',
    (status) =>
      createHttpLabeler({
        url: 'https://labels.example.test/path?token=abc',
        cls: 'system1',
        keyVariable: 'MY_KEY',
        env: { MY_KEY: 'k' },
        fetch: fakeFetch({ error: 'no' }, [], status),
        maxRetries: 0,
      }),
    'labels.example.test',
  ],
];

async function failure(make: Make, status: number): Promise<unknown> {
  const labeler = make(status);
  return labeler
    .call?.(labeler.render(BAKE, windowOf(1)), BAKE, windowOf(1))
    .catch((cause: unknown) => cause);
}

describe.each(LABELERS)('a system 1 labeler: %s', (_name, make, host) => {
  it.each([401, 403])(
    'stops the run when the key is refused (%i) and names where it went',
    async (status) => {
      const error = await failure(make, status);
      expect(error).toBeInstanceOf(LabelerConfigError);
      const message = (error as Error).message;
      expect(message).toContain(host);
      expect(message).toContain(String(status));
      expect(message).not.toContain('secret-path');
      expect(message).not.toContain('token=abc');
    },
  );

  it.each([429, 500])('leaves a %i as an ordinary error', async (status) => {
    const error = await failure(make, status);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LabelerConfigError);
  });
});
