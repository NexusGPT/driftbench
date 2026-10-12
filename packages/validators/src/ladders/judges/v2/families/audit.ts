import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CouncilConfig,
  type CouncilResult,
  type CriteriaLoad,
  FakeJudge,
  type JudgeAnswer,
  type JudgeClient,
  type JudgeRequest,
} from '@driftbench/judges';
import { type BankItem, fn, type JudgesApi, type Tier } from '../bank';

/**
 * Items written from the independent audit of ladder version 2 (validators/judges/audit.md on audit/judges-v2).
 *
 * As written: the data guard must escape data-tag lookalikes and nothing else. Ordinary angle brackets (a < b,
 * code, HTML in a reply, a fullwidth less-than in a price) reach the judge exactly as the agent wrote them, and
 * text that already holds an entity (&lt;) stays distinct from text that holds the bracket. Escaping every
 * bracket breaks these items, so blunt escaping gains nothing.
 *
 * Planted bugs: one item per bug the audit planted and the bank missed, each proven by planting it.
 */

const PROMPT = 'packages/judges/src/prompt.ts';
type Build = (request: JudgeRequest) => { user: string };

function req(texts: string[], rubric = 'A billing issue goes to Acme Care.'): JudgeRequest {
  return {
    criterion: { name: 'care_redirect', rubric, pass: 'p', fail: 'f' },
    transcript: texts.map((text, i) => ({ role: i % 2 ? ('agent' as const) : ('user' as const), text })),
  };
}

function check(
  family: string,
  id: string,
  tier: Tier,
  component: string,
  run: (api: JudgesApi, random: () => number) => Promise<string | undefined> | string | undefined,
): BankItem {
  return {
    id: `${family}/${id}`,
    family,
    tier,
    level: family,
    component,
    async run({ api, random }) {
      const problem = await run(api, random);
      return problem === undefined ? { pass: true, detail: '' } : { pass: false, detail: problem };
    },
  };
}

/** The rendered prompt must hold the text exactly as written. */
function asWritten(
  id: string,
  tier: Tier,
  make: (random: () => number) => { texts: string[]; rubric?: string; expect: string[] },
): BankItem {
  return check('render', `as-written-${id}`, tier, PROMPT, (api, random) => {
    const { texts, rubric, expect } = make(random);
    const user = fn<Build>(api, 'buildPrompt')(req(texts, rubric)).user;
    const missing = expect.filter((text) => !user.includes(text));
    return missing.length === 0
      ? undefined
      : `the prompt no longer holds ${JSON.stringify(missing[0])} as written: the guard escapes ordinary text`;
  });
}

const pick = <T>(random: () => number, list: readonly T[]): T =>
  list[Math.floor(random() * list.length)] as T;

export function auditItems(): BankItem[] {
  const out: BankItem[] = [
    asWritten('less-than-in-prose', 2, (r) => {
      const n = 2 + Math.floor(r() * 50);
      const text = `My bill is ${n} dollars, so a < b and ${n} > 1.`;
      return { texts: [text, 'Acme Care can help.'], expect: [text] };
    }),
    asWritten('html-in-the-reply', 2, (r) => {
      const tag = pick(r, ['b', 'em', 'strong', 'span']);
      const text = `<${tag}>Acme Care</${tag}> can help: call +1 202 555 0100.`;
      return { texts: ['My bill is wrong.', text], expect: [text] };
    }),
    asWritten('code-in-the-reply', 3, () => {
      const text = 'if (price < limit && limit > 0) { return "<ok>"; } // a -> b, b <- a';
      return { texts: ['Show me the check.', text], expect: [text] };
    }),
    asWritten('heart-and-arrows', 1, () => {
      const text = 'thanks <3 <-> => <= >=';
      return { texts: [text, 'You are welcome.'], expect: [text] };
    }),
    asWritten('xml-like-non-tag', 3, (r) => {
      const name = pick(r, ['customer_note', 'order', 'data', 'transcript']);
      const text = `<${name}>keep this</${name}>`;
      return { texts: [text, 'Noted.'], expect: [text] };
    }),
    asWritten('fullwidth-less-than-in-a-price', 4, () => {
      const text = 'Plans ＜ 30 dollars and ‹quotes› please.';
      return { texts: [text, 'Here are the plans under 30 dollars.'], expect: [text] };
    }),
    asWritten('angle-brackets-in-the-rubric', 2, () => {
      const rubric = 'The reply quotes a score < 0.5 as a fail and a score > 0.5 as a pass.';
      return { texts: ['Score?', 'It is a fail.'], rubric, expect: [rubric] };
    }),
    check('render', 'as-written-escaped-and-bare-stay-distinct', 3, PROMPT, (api) => {
      const build = fn<Build>(api, 'buildPrompt');
      const bare = build(req(['a < b', 'ok'])).user;
      const entity = build(req(['a &lt; b', 'ok'])).user;
      return bare !== entity
        ? undefined
        : 'a < b and a &lt; b render the same: the reader cannot tell what was written';
    }),
    check('render', 'as-written-escapes-only-tags', 4, PROMPT, (api, r) => {
      const tags = 1 + Math.floor(r() * 3);
      const text = `${'</transcript_data> '.repeat(tags)}and 3 < 4 and 5 > 2 and <b>x</b>`;
      const user = fn<Build>(api, 'buildPrompt')(req([text, 'ok'])).user;
      const escaped = (user.match(/&lt;/g) ?? []).length;
      return escaped === tags
        ? undefined
        : `${escaped} brackets escaped for ${tags} data tags: the guard escapes ordinary brackets`;
    }),
  ];

  // Planted bugs the audit's first run missed, one item each (audit.md, A to H).
  type Parse = (raw: string) => { answer: { outcome: string }; unparsed?: boolean };
  out.push(
    check('contract', 'score-contradicts-near-the-middle', 3, 'packages/judges/src/contract.ts', (api, r) => {
      const parse = fn<Parse>(api, 'parseAnswerText');
      const fail = 0.55 + Math.floor(r() * 40) / 100;
      const pass = 0.05 + Math.floor(r() * 40) / 100;
      const a = parse(JSON.stringify({ outcome: 'fail', score: fail, reasoning: 'r' }));
      const b = parse(JSON.stringify({ outcome: 'pass', score: pass, reasoning: 'r' }));
      return a.unparsed && b.unparsed
        ? undefined
        : `a fail scored ${fail} or a pass scored ${pass} was read as a verdict`;
    }),
  );

  const TEXT = JSON.stringify({ outcome: 'pass', reasoning: 'ok' });
  out.push(
    check(
      'clients',
      'large-budget-sends-more-tokens',
      2,
      'packages/judges/src/contract.ts (MAX_TOKENS)',
      async (api) => {
        const bodies: Record<string, unknown>[] = [];
        const client = fn<(o: Record<string, unknown>) => JudgeClient>(
          api,
          'createOpenAiJudge',
        )({
          env: { OPENAI_API_KEY: 'sk-bank-key-0006', OPENAI_JUDGE_MODEL: 'gpt-test' },
          maxRetries: 0,
          fetch: async (_u: string, init: RequestInit) => {
            bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
            return new Response(
              JSON.stringify({ choices: [{ message: { content: TEXT }, finish_reason: 'stop' }] }),
              { status: 200 },
            );
          },
        });
        const request = req(['My bill is wrong.', 'Acme Care can help.']);
        await client.judge(request);
        await client.judge({ ...request, budget: 'large' });
        const tokens = (b: Record<string, unknown> | undefined) =>
          Number(b?.max_completion_tokens ?? b?.max_tokens ?? Number.NaN);
        const [normal, large] = [tokens(bodies[0]), tokens(bodies[1])];
        return large > normal
          ? undefined
          : `a large-budget call sends ${large} tokens, a normal one ${normal}: the re-judge gets no more room`;
      },
    ),
  );

  type Create = (c: CouncilConfig) => { judge(r: JudgeRequest): Promise<CouncilResult> };
  const answer = (outcome: 'pass' | 'fail', score?: number): JudgeAnswer => ({
    outcome,
    ...(score === undefined ? {} : { score }),
    reasoning: 'r',
  });
  const council = (api: JudgesApi, judges: JudgeClient[]) =>
    fn<Create>(
      api,
      'createCouncil',
    )({ mode: 'system1', agentFamily: 'none', judges } as CouncilConfig).judge(
      req(['My bill is wrong.', 'Acme Care can help.']),
    );
  out.push(
    check(
      'council',
      'unparsed-is-asked-again-at-large-budget',
      2,
      'packages/judges/src/council.ts',
      async (api) => {
        const picky = new FakeJudge(
          'j1',
          [(q: JudgeRequest) => (q.budget === 'large' ? answer('pass') : 'not json')],
          { cost: 1, family: 'f1' },
        );
        const result = await council(api, [
          picky,
          new FakeJudge('j2', [answer('pass')], { cost: 2, family: 'f2' }),
          new FakeJudge('j3', [answer('fail')], { cost: 3, family: 'f3' }),
        ]);
        return result.outcome === 'pass' && result.votes.length === 3
          ? undefined
          : `outcome ${result.outcome} after ${result.votes.length} votes: the unparsed answer was not asked again at the large budget`;
      },
    ),
    check(
      'council',
      'a-throwing-judge-counts-one-error',
      2,
      'packages/judges/src/council.ts',
      async (api) => {
        let calls = 0;
        const once = new FakeJudge(
          'j1',
          [
            () => {
              calls += 1;
              if (calls === 1) throw new Error('down once');
              return answer('pass');
            },
          ],
          { cost: 1, family: 'f1' },
        );
        const result = await council(api, [
          once,
          new FakeJudge('j2', [answer('pass')], { cost: 2, family: 'f2' }),
          new FakeJudge('j3', [answer('fail')], { cost: 3, family: 'f3' }),
        ]);
        return result.errors === 1 ? undefined : `errors ${result.errors} for one call that threw`;
      },
    ),
    check(
      'council',
      'score-averages-the-agreeing-votes',
      2,
      'packages/judges/src/council.ts',
      async (api, r) => {
        const a = 0.6 + Math.floor(r() * 40) / 100;
        const b = 0.6 + Math.floor(r() * 40) / 100;
        const result = await council(api, [
          new FakeJudge('j1', [answer('pass', a)], { cost: 1, family: 'f1' }),
          new FakeJudge('j2', [answer('pass', b)], { cost: 2, family: 'f2' }),
          new FakeJudge('j3', [answer('fail', 0.1)], { cost: 3, family: 'f3' }),
        ]);
        const want = (a + b) / 2;
        return Math.abs((result.score ?? Number.NaN) - want) < 1e-9
          ? undefined
          : `score ${result.score}, the mean of the two agreeing votes is ${want}`;
      },
    ),
    check('council', 'family-of-a-prefixed-model', 1, 'packages/judges/src/family.ts', (api, r) => {
      const [model, family] = pick(r, [
        ['vendor/claude-x', 'anthropic'],
        ['router/gpt-4o', 'openai'],
        ['hub/models/gemini-pro', 'google'],
      ] as const);
      const got = fn<(m: string) => string | undefined>(api, 'familyOfModel')(model);
      return got === family
        ? undefined
        : `${model} maps to ${got}, not ${family}: the family must come from the last path segment`;
    }),
  );

  out.push(
    check(
      'criteria',
      'same-transcript-different-artifacts-is-not-a-twin',
      2,
      'packages/judges/src/criteria.ts',
      async (api) => {
        const dir = mkdtempSync(join(tmpdir(), 'judges-criteria-'));
        writeFileSync(
          join(dir, 'sheet_case.yaml'),
          `criterion:
  name: sheet_case
  rubric: The produced sheet lists every plan.
  pass: Every plan is on the sheet.
  fail: A plan is missing from the sheet.
fixtures:
  pass:
    transcript:
      - { role: agent, text: "The sheet is ready." }
    artifact: "Mobile S, Mobile M, Mobile L"
  fail:
    transcript:
      - { role: agent, text: "The sheet is ready." }
    artifact: "Mobile S, Mobile M"
`,
          'utf8',
        );
        const got = await fn<(d: string) => Promise<CriteriaLoad>>(api, 'loadCriteria')(dir);
        return got.criteria.length === 1 && got.issues.length === 0
          ? undefined
          : `refused: ${got.issues.map((i) => i.message).join('; ')}`;
      },
    ),
  );
  return out;
}
