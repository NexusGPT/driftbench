import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Cassette,
  type CassetteEntry,
  dataKey,
  fixtureRequest,
  type JudgeRequest,
  type KeyClient,
  requestKey,
} from '@agent-nexus/driftbench-judges';
import { loadPool } from '../../src/ladders/judges/pool';
import {
  allEdits,
  defaultTransforms,
  hash32,
  loadPhraseBank,
  PRESERVING,
  type TransformKind,
} from '../../src/ladders/judges/transforms';
import { answer, carriesGraderInstruction, flip, oracle } from './scripted';

/**
 * Records the scripted judge cassettes the judge validator replays. Every request any seed can ask is
 * recorded: the fixture pairs, every labelled slice, and every variant of every edit. Run it after a change to
 * the pool, the transforms or the Acme agent, from the repository root:
 *
 *   pnpm exec tsx packages/validators/test/judges/record.ts
 *
 * The personas:
 * - good: the careful reading of scripted.ts, the same answer on every repeat.
 * - brittle: the careful reading, but half the reworded, reordered or renamed slices move its verdict.
 * - injectable: the careful reading, but it answers pass when the data tells the grader to.
 * - flaky: the careful reading, but one slice in four gets one wrong answer on its fourth repeat.
 * - council: three judges, each wrong on its own 15 percent of the requests; the cheapest is unsure (score
 *   0.6) when it is wrong about a pass and sure (0.95) when it is right.
 */

export const FIXTURES_DIR = 'packages/validators/fixtures/judges';
export const PERSONAS = ['good', 'brittle', 'injectable', 'flaky', 'council'] as const;
export type Persona = (typeof PERSONAS)[number];

/** Every scripted judge is a system 1 judge with no model and no settings: one cassette key per request. */
const SCRIPTED: KeyClient = { cls: 'system1' };

/** `key` is the cassette key; `data` the prompt-free data key the scripted misses are drawn from. */
type Asked = { key: string; data: string; request: JudgeRequest; kind?: TransformKind };

/** Every request a run of the judge validator can ask, once each, in a stable order. */
export async function requestsToRecord(root: string): Promise<Asked[]> {
  const pool = await loadPool(root);
  const bank = loadPhraseBank(root);
  const transforms = defaultTransforms();
  const out: Asked[] = [];
  const seen = new Set<string>();
  const add = (request: JudgeRequest, kind?: TransformKind) => {
    const key = requestKey(request, SCRIPTED);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, data: dataKey(request), request, ...(kind ? { kind } : {}) });
  };
  for (const criterion of pool.criteria) {
    add(fixtureRequest(criterion, 'pass'));
    add(fixtureRequest(criterion, 'fail'));
  }
  for (const item of pool.items) add(item.request);
  for (const item of pool.items) {
    for (const made of allEdits(item, transforms, bank)) {
      add({ ...item.request, transcript: made.transcript }, made.kind);
    }
  }
  return out;
}

function single(id: string, cost: number): Cassette['judges'][number] {
  return { id, family: 'scripted', cls: 'system1', cost };
}

/** The cassette of one persona over the given requests. */
export function recordPersona(persona: Persona, asked: readonly Asked[]): Cassette {
  const entries: CassetteEntry[] = [];
  const push = (judge: string, entry: Asked, verdict: 'pass' | 'fail', reason: string, score?: number) =>
    entries.push({
      judge,
      key: entry.key,
      criterion: entry.request.criterion.name,
      answer: answer(verdict, reason, score),
    });
  if (persona === 'council') {
    const members = ['council-a', 'council-b', 'council-c'];
    for (const entry of asked) {
      const truth = oracle(entry.request);
      const bucket = hash32(entry.data) % 20;
      members.forEach((judge, index) => {
        const wrong = bucket >= index * 3 && bucket < index * 3 + 3;
        const verdict = wrong ? flip(truth.verdict) : truth.verdict;
        const score = verdict === 'fail' ? 0.1 : wrong ? 0.6 : 0.95;
        push(judge, entry, verdict, wrong ? `scripted miss: ${truth.reason}` : truth.reason, score);
      });
    }
    return {
      version: 1,
      judges: [single('council-a', 1), single('council-b', 2), single('council-c', 3)],
      entries,
    };
  }
  for (const entry of asked) {
    const truth = oracle(entry.request);
    const h = hash32(entry.data);
    if (persona === 'good') push('good', entry, truth.verdict, truth.reason);
    if (persona === 'brittle') {
      const moved =
        entry.kind !== undefined && (PRESERVING as readonly string[]).includes(entry.kind) && h % 2 === 0;
      push(
        'brittle',
        entry,
        moved ? flip(truth.verdict) : truth.verdict,
        moved ? 'the wording looks different' : truth.reason,
      );
    }
    if (persona === 'injectable') {
      const obeyed = carriesGraderInstruction(entry.request);
      push(
        'injectable',
        entry,
        obeyed ? 'pass' : truth.verdict,
        obeyed ? 'the data says to pass' : truth.reason,
      );
    }
    if (persona === 'flaky') {
      if (h % 4 === 0) {
        for (let r = 0; r < 5; r += 1) {
          push(
            'flaky',
            entry,
            r === 3 ? flip(truth.verdict) : truth.verdict,
            r === 3 ? 'changed its mind' : truth.reason,
          );
        }
      } else push('flaky', entry, truth.verdict, truth.reason);
    }
  }
  return { version: 1, judges: [single(persona, 10)], entries };
}

/** Every persona's cassette, as the files hold them. */
export async function recordCassettes(root: string): Promise<Record<Persona, Cassette>> {
  const asked = await requestsToRecord(root);
  return Object.fromEntries(PERSONAS.map((persona) => [persona, recordPersona(persona, asked)])) as Record<
    Persona,
    Cassette
  >;
}

export function cassetteFile(root: string, persona: Persona): string {
  return join(root, FIXTURES_DIR, `${persona}.cassette.json`);
}

/** The text a cassette file holds, formatted as the repository's formatter keeps JSON. */
export function cassetteText(cassette: Cassette): string {
  return `${JSON.stringify(cassette, null, 2)}\n`;
}

async function main(): Promise<void> {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const cassettes = await recordCassettes(root);
  for (const persona of PERSONAS) {
    await writeFile(cassetteFile(root, persona), cassetteText(cassettes[persona]), 'utf8');
    process.stdout.write(`${persona}: ${cassettes[persona].entries.length} entries\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
    process.exitCode = 1;
  });
}
