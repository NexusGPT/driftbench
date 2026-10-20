import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { SimulatedUserError, type UserModelPort } from '../simulated';

/**
 * Recorded model responses for an engine-driven user (the realiser and the agent-act labeller), keyed by
 * the hash of the request, its seed and how many times the same request came before in that seed's run: a
 * model may answer the same request differently in two trials, and each trial replays its own answer. A run
 * that replays a cassette makes no model call and gives the same messages; a request the cassette does not
 * hold fails, naming its key, so a changed prompt is never answered by a stale response.
 */

export const UserCassette = z
  .strictObject({
    family: z.string().min(1).describe('The model family the responses were recorded from.'),
    model: z.string().min(1).describe('The model recorded.'),
    entries: z
      .record(z.string().regex(/^[0-9a-f]{64}$/), z.string())
      .describe(
        'Each response, by the SHA-256 of its request (seed, occurrence, system, user and token cap).',
      ),
  })
  .describe('Recorded responses of the simulated user, replayed instead of calling a model.');
export type UserCassette = z.infer<typeof UserCassette>;

type Request = { system: string; user: string; maxTokens?: number; seed?: string };

/** The key of a request: its seed, its occurrence (0 for the first time in that seed), its text and token cap. */
export function requestKey(request: Request, occurrence = 0): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        request.seed ?? null,
        occurrence,
        request.system,
        request.user,
        request.maxTokens ?? null,
      ]),
    )
    .digest('hex');
}

/** Counts each request as it comes, so the nth time the same request is made it gets the nth key. */
function occurrences(): (request: Request) => string {
  const seen = new Map<string, number>();
  return (request) => {
    const base = requestKey(request);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return requestKey(request, n);
  };
}

/** A port that answers from a cassette. */
export function cassettePort(cassette: UserCassette): UserModelPort {
  const keyOf = occurrences();
  return {
    family: cassette.family,
    model: cassette.model,
    async complete(request) {
      const key = keyOf(request);
      const answer = cassette.entries[key];
      if (answer === undefined) {
        throw new SimulatedUserError(
          `the cassette of ${cassette.family} ${cassette.model} holds no response for request ${key.slice(0, 12)}: record it again`,
        );
      }
      return answer;
    },
  };
}

/** A port that calls `port` and keeps every response, to write as a cassette. */
export function recordingCassettePort(port: UserModelPort): UserModelPort & { cassette(): UserCassette } {
  const entries: Record<string, string> = {};
  const keyOf = occurrences();
  return {
    family: port.family,
    ...(port.model === undefined ? {} : { model: port.model }),
    async complete(request) {
      const key = keyOf(request);
      const answer = await port.complete(request);
      entries[key] = answer;
      return answer;
    },
    cassette: () => ({ family: port.family, model: port.model ?? 'unknown', entries: { ...entries } }),
  };
}

export async function loadUserCassette(path: string): Promise<UserCassette> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    throw new SimulatedUserError(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const parsed = UserCassette.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SimulatedUserError(
      `${path}: ${issue?.path.map(String).join('.') || '(file)'} ${issue?.message}`,
    );
  }
  return parsed.data;
}

export async function writeUserCassette(path: string, cassette: UserCassette): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(cassette.entries).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path, `${JSON.stringify({ ...cassette, entries: sorted }, null, 2)}\n`);
}
