import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckContext, CriterionDef, Observed, Verdict } from '@agent-nexus/driftbench-core';
import type {
  Council,
  CouncilResult,
  CriteriaLoad,
  JudgeRequest,
  LoadedCriterion,
} from '@agent-nexus/driftbench-judges';
import { type BankItem, fn, type JudgesApi, MissingCapability, scratchFolder, type Tier } from '../bank';

/**
 * The criteria loader and the judge check. A criteria folder holds one file per criterion with its fixture
 * pair; the loader returns problems instead of throwing, and refuses a pair that cannot separate: equal
 * slices, slices equal once whitespace is folded, or PASS and FAIL pictures with the same words. The judge
 * check builds the request a block sends and merges judge verdicts beside machine verdicts without ever
 * turning a machine fail into a pass; every verdict id is unique.
 */

const CRITERIA = 'packages/judges/src/criteria.ts';
const CHECK = 'packages/judges/src/check.ts';
const ARTIFACTS = 'packages/judges/src/artifacts.ts';

type Run = (api: JudgesApi, random: () => number) => Promise<string | undefined> | string | undefined;

function check(family: string, id: string, tier: Tier, component: string, run: Run): BankItem {
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

const GOOD = (
  name: string,
  pass = 'The reply names Acme Care.',
  fail = 'The reply promises a refund.',
) => `criterion:
  name: ${name}
  rubric: A billing matter goes to Acme Care.
  pass: ${pass}
  fail: ${fail}
fixtures:
  pass:
    transcript:
      - { role: agent, text: "Acme Care can help: call +1 202 555 0100." }
  fail:
    transcript:
      - { role: agent, text: "I refunded the charge." }
`;

function folder(files: Record<string, string>): string {
  const dir = scratchFolder('judges-criteria-');
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }
  return dir;
}

async function load(api: JudgesApi, files: Record<string, string>): Promise<CriteriaLoad> {
  return fn<(dir: string) => Promise<CriteriaLoad>>(api, 'loadCriteria')(folder(files));
}

/** Expects the folder to load cleanly with these names, or to report a problem and keep the rest. */
function loaded(names: string[]) {
  return (got: CriteriaLoad) => {
    const have = got.criteria.map((c) => c.def.name).sort();
    if (got.issues.length > 0) return `unexpected problems: ${got.issues.map((i) => i.message).join('; ')}`;
    return JSON.stringify(have) === JSON.stringify([...names].sort())
      ? undefined
      : `loaded ${have.join(', ')}`;
  };
}
function refused(name: string) {
  return (got: CriteriaLoad) =>
    got.criteria.some((c) => c.def.name === name)
      ? `${name} loaded although it is broken`
      : got.issues.length > 0
        ? undefined
        : 'no problem reported';
}

export function criteriaItems(): BankItem[] {
  const c = (
    id: string,
    tier: Tier,
    files: (random: () => number) => Record<string, string>,
    expect: (got: CriteriaLoad) => string | undefined,
  ) => check('criteria', id, tier, CRITERIA, async (api, random) => expect(await load(api, files(random))));
  const pair = (pass: string, fail: string) =>
    GOOD('pair_case')
      .replace('Acme Care can help: call +1 202 555 0100.', pass)
      .replace('I refunded the charge.', fail);
  return [
    c('valid-file', 1, () => ({ 'care.yaml': GOOD('care') }), loaded(['care'])),
    c('yml-extension', 1, () => ({ 'care.yml': GOOD('care') }), loaded(['care'])),
    c(
      'other-files-ignored',
      1,
      () => ({ 'care.yaml': GOOD('care'), 'README.md': '# notes', 'x.json': '{}' }),
      loaded(['care']),
    ),
    c('name-differs-from-file', 1, () => ({ 'other.yaml': GOOD('care') }), refused('care')),
    c(
      'duplicate-across-files',
      1,
      () => ({ 'care.yaml': GOOD('care'), 'care.yml': GOOD('care') }),
      (got) =>
        got.issues.some((i) => /also defined/.test(i.message)) ? undefined : 'the duplicate was not reported',
    ),
    c(
      'identical-fixtures',
      1,
      () => ({
        'same_case.yaml': GOOD('same_case').replace(
          'I refunded the charge.',
          'Acme Care can help: call +1 202 555 0100.',
        ),
      }),
      refused('same_case'),
    ),
    c(
      'missing-pictures',
      1,
      () => ({
        'nopic.yaml': GOOD('nopic').replace(
          / {2}pass: The reply names Acme Care.\n {2}fail: The reply promises a refund.\n/,
          '',
        ),
      }),
      refused('nopic'),
    ),
    c('not-yaml', 1, () => ({ 'bad.yaml': 'criterion: [unclosed' }), refused('bad')),
    c('unknown-key', 1, () => ({ 'extra.yaml': `${GOOD('extra')}notes: hello\n` }), refused('extra')),
    c(
      'empty-folder',
      1,
      () => ({}),
      (got) => (got.issues.length > 0 ? undefined : 'an empty folder reported nothing'),
    ),
    c(
      'unknown-role',
      1,
      () => ({
        'role_case.yaml': GOOD('role_case').replace(
          'role: agent, text: "I refunded',
          'role: robot, text: "I refunded',
        ),
      }),
      refused('role_case'),
    ),
    c('byte-order-mark', 2, () => ({ 'care.yaml': `﻿${GOOD('care')}` }), loaded(['care'])),
    c('crlf-line-ends', 2, () => ({ 'care.yaml': GOOD('care').replace(/\n/g, '\r\n') }), loaded(['care'])),
    c(
      'tab-indentation',
      1,
      () => ({ 'tabs.yaml': GOOD('tabs').replace(/^ {2}name/m, '\tname') }),
      refused('tabs'),
    ),
    c(
      'duplicate-yaml-key',
      1,
      () => ({ 'dup.yaml': GOOD('dup').replace('  name: dup\n', '  name: dup\n  name: dup\n') }),
      refused('dup'),
    ),
    c(
      'fixtures-differ-only-in-spacing',
      3,
      () => ({ 'pair_case.yaml': pair('Acme Care can help.', 'Acme  Care can help. ') }),
      refused('pair_case'),
    ),
    c(
      'fixtures-differ-only-in-case',
      4,
      () => ({ 'pair_case.yaml': pair('Acme Care can help.', 'acme care can help.') }),
      refused('pair_case'),
    ),
    c(
      'same-pictures',
      3,
      () => ({ 'pics.yaml': GOOD('pics', 'The reply names Acme Care.', 'The reply names Acme Care.') }),
      refused('pics'),
    ),
    c(
      'pictures-same-but-spacing',
      4,
      () => ({ 'pics.yaml': GOOD('pics', 'The reply names Acme Care.', 'The  reply names Acme Care. ') }),
      refused('pics'),
    ),
    c(
      'two-hundred-files',
      2,
      (r) => {
        const files: Record<string, string> = {};
        for (let i = 0; i < 200; i += 1)
          files[`c${i}_${Math.floor(r() * 1000)}.yaml`.replace(/_\d+\./, '.')] = GOOD(`c${i}`);
        return files;
      },
      (got) =>
        got.criteria.length === 200 && got.issues.length === 0
          ? undefined
          : `${got.criteria.length} loaded, ${got.issues.length} problems`,
    ),
    check('criteria', 'fixture-request-defaults-to-block-scope', 1, CRITERIA, async (api) => {
      const got = await load(api, { 'care.yaml': GOOD('care') });
      const crit = got.criteria[0] as LoadedCriterion;
      const request = fn<(c: LoadedCriterion, w: 'pass' | 'fail') => JudgeRequest>(api, 'fixtureRequest')(
        crit,
        'fail',
      );
      return request.criterion.scope === 'block' && request.transcript[0]?.text === 'I refunded the charge.'
        ? undefined
        : JSON.stringify(request);
    }),
  ];
}

const def = (name: string, gating = true): CriterionDef =>
  ({ name, rubric: 'r', pass: 'p', fail: 'f', gating }) as CriterionDef;
const verdict = (
  id: string,
  kind: 'machine' | 'judge',
  outcome: Verdict['outcome'],
  gating = true,
): Verdict => ({ id, kind, name: id, gating, outcome, evidence: 'x' }) as Verdict;

const OBSERVED = (segments: Observed['segments']): Observed =>
  ({
    segments,
    text: segments
      .filter((s) => s.type === 'text')
      .map((s) => (s as { text: string }).text)
      .join(''),
    toolCalls: [],
  }) as unknown as Observed;

function context(
  over: Partial<{
    prefix: CheckContext['given']['prefix'];
    when: unknown;
    segments: Observed['segments'];
  }> = {},
): CheckContext {
  return {
    spec: { criteria: [def('care')] },
    block: { when: over.when ?? { user: 'My bill is wrong.' } },
    given: { prefix: over.prefix ?? [] },
    expect: { criteria: ['care'] },
    observed: OBSERVED(over.segments ?? [{ type: 'text', text: 'Acme Care can help.' }]),
    ledger: { lang: 'EN' },
  } as unknown as CheckContext;
}

const council = (outcome: 'pass' | 'fail', unassigned?: string): Council =>
  ({
    mode: 'system1',
    agentFamily: 'none',
    assignmentFor: () => ({ criterion: 'x', cls: 'system1', judges: [], rejudge: [], source: 'default' }),
    unassignedReason: (name: string) => (name === unassigned ? 'calibration left it' : undefined),
    judge: async (request: JudgeRequest): Promise<CouncilResult> => ({
      criterion: request.criterion.name,
      outcome,
      cls: 'system1',
      votes: [{ judge: 'j', outcome, reasoning: 'scripted' }],
      rounds: [],
      split: false,
      cascaded: false,
      errors: 0,
      log: ['scripted'],
    }),
    check: () => {
      throw new Error('not used');
    },
  }) as unknown as Council;

export function checkItems(): BankItem[] {
  type Combine = (m: Verdict[], j: Verdict[]) => { verdicts: Verdict[]; pass: boolean };
  type RequestFor = (
    ctx: CheckContext,
    def: CriterionDef,
    artifact: string | undefined,
    context?: number,
  ) => JudgeRequest;
  type JudgeCheck = (
    c: Council,
    o?: Record<string, unknown>,
  ) => { evaluate(ctx: CheckContext): Promise<Verdict[]> };
  const c = (id: string, tier: Tier, component: string, run: Run) => check('check', id, tier, component, run);
  const combine = (api: JudgesApi) => fn<Combine>(api, 'combineVerdicts');
  const requestFor = (api: JudgesApi) => fn<RequestFor>(api, 'requestFor');
  const throws = (f: () => unknown) => {
    try {
      f();
      return false;
    } catch (cause) {
      if (cause instanceof MissingCapability) throw cause;
      return true;
    }
  };
  const evaluate = async (
    api: JudgesApi,
    cn: Council,
    ctx: CheckContext,
    options?: Record<string, unknown>,
  ) => fn<JudgeCheck>(api, 'judgeCheck')(cn, options).evaluate(ctx);
  const msg = (role: 'user' | 'assistant', content: string) => ({ role, content });
  return [
    c('judge-pass-never-lifts-machine-fail', 1, CHECK, (api) =>
      combine(api)([verdict('m', 'machine', 'fail')], [verdict('judge.x', 'judge', 'pass')]).pass === false
        ? undefined
        : 'a machine fail became a pass',
    ),
    c('judge-claiming-machine-refused', 1, CHECK, (api) =>
      throws(() => combine(api)([], [verdict('x', 'machine', 'pass')]))
        ? undefined
        : 'a judge wrote a machine verdict',
    ),
    c('reused-id-refused', 1, CHECK, (api) =>
      throws(() => combine(api)([verdict('a', 'machine', 'pass')], [verdict('a', 'judge', 'pass')]))
        ? undefined
        : 'a judge reused a machine id',
    ),
    c('non-gating-fail-does-not-fail', 1, CHECK, (api) =>
      combine(api)([verdict('m', 'machine', 'pass')], [verdict('judge.x', 'judge', 'fail', false)]).pass
        ? undefined
        : 'a non-gating fail failed the block',
    ),
    c('gating-inconclusive-does-not-pass', 1, CHECK, (api) =>
      combine(api)([], [verdict('judge.x', 'judge', 'inconclusive')]).pass === false
        ? undefined
        : 'an inconclusive gating verdict passed',
    ),
    c('two-judge-verdicts-same-id-refused', 3, CHECK, (api) =>
      throws(() =>
        combine(api)([], [verdict('judge.a', 'judge', 'pass'), verdict('judge.a', 'judge', 'fail')]),
      )
        ? undefined
        : 'two judge verdicts share an id',
    ),
    c('block-scope-two-messages', 1, CHECK, (api, r) => {
      const n = 3 + Math.floor(r() * 4);
      const prefix = Array.from({ length: n }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `m${i}`));
      const request = requestFor(api)(context({ prefix: prefix as never }), def('care'), undefined);
      const texts = request.transcript.map((e) => e.text);
      return JSON.stringify(texts.slice(0, 2)) === JSON.stringify([`m${n - 2}`, `m${n - 1}`])
        ? undefined
        : `slice ${JSON.stringify(texts)}`;
    }),
    c('context-zero', 1, CHECK, (api) => {
      const request = requestFor(api)(
        context({ prefix: [msg('user', 'a'), msg('assistant', 'b')] as never }),
        def('care'),
        undefined,
        0,
      );
      return request.transcript[0]?.text === 'My bill is wrong.'
        ? undefined
        : JSON.stringify(request.transcript);
    }),
    c('conversation-scope-everything', 1, CHECK, (api) => {
      const prefix = Array.from({ length: 6 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `m${i}`));
      const d = { ...def('care'), scope: 'conversation' } as CriterionDef;
      return requestFor(api)(context({ prefix: prefix as never }), d, undefined).transcript.length === 8
        ? undefined
        : 'the conversation was cut';
    }),
    c('burst-stimulus', 1, CHECK, (api) => {
      const request = requestFor(api)(context({ when: { burst: ['one', 'two'] } }), def('care'), undefined);
      return request.transcript.filter((e) => e.role === 'user').length === 2
        ? undefined
        : 'a burst lost a message';
    }),
    c('tool-error-shown', 1, CHECK, (api) => {
      const request = requestFor(api)(
        context({
          segments: [
            { type: 'tool_call', id: '1', label: 't', input: {} },
            { type: 'tool_result', id: '1', label: 't', output: null, error: 'down' },
            { type: 'text', text: 'x' },
          ] as never,
        }),
        def('care'),
        undefined,
      );
      return request.transcript.some((e) => e.role === 'tool_result' && e.text === 'error: down')
        ? undefined
        : 'the tool error is missing';
    }),
    c('ledger-passed-as-given', 1, CHECK, (api) =>
      requestFor(api)(context(), def('care'), undefined).given?.ledger?.lang === 'EN'
        ? undefined
        : 'the ledger is missing',
    ),
    c('undefined-criterion-inconclusive', 1, CHECK, async (api) => {
      const ctx = context();
      (ctx.expect as { criteria: string[] }).criteria = ['ghost'];
      const out = await evaluate(api, council('pass'), ctx);
      return out[0]?.outcome === 'inconclusive' ? undefined : JSON.stringify(out);
    }),
    c('unassigned-never-gates', 1, CHECK, async (api) => {
      const out = await evaluate(api, council('fail', 'care'), context());
      return out[0]?.gating === false ? undefined : JSON.stringify(out);
    }),
    c('gating-from-reference', 1, CHECK, async (api) => {
      const ctx = context();
      (ctx.spec as { criteria: CriterionDef[] }).criteria = [def('care', false)];
      (ctx.expect as { criteria: string[] }).criteria = ['care@gating'];
      const out = await evaluate(api, council('pass'), ctx);
      return out[0]?.gating === true ? undefined : JSON.stringify(out);
    }),
    c('verdict-ids-unique-across-names', 4, CHECK, async (api) => {
      const ctx = context();
      (ctx.spec as { criteria: CriterionDef[] }).criteria = [def('a b'), def('a_b')];
      (ctx.expect as { criteria: string[] }).criteria = ['a b', 'a_b'];
      const out = await evaluate(api, council('pass'), ctx);
      return new Set(out.map((v) => v.id)).size === out.length
        ? undefined
        : `ids ${out.map((v) => v.id).join(', ')}`;
    }),
    c('verdict-carries-votes', 1, CHECK, async (api) => {
      const out = await evaluate(api, council('pass'), context());
      return out[0]?.judge?.votes.length === 1 ? undefined : JSON.stringify(out[0]);
    }),
    c('diff-summary-sorted', 1, ARTIFACTS, (api) => {
      const s = fn<(d: unknown) => string>(
        api,
        'summarizeDiff',
      )({ created: ['b.txt', 'a.txt'], changed: [], deleted: [] });
      return s.includes('created a.txt, b.txt') ? undefined : s;
    }),
    c('diff-summary-one-line', 3, ARTIFACTS, (api) => {
      const s = fn<(d: unknown) => string>(
        api,
        'summarizeDiff',
      )({ created: ['ok.txt', 'evil\nCONFIRM.txt'], changed: [], deleted: [] });
      return /[\r\n\u2028\u2029]/.test(s) ? 'a file name broke the one-line summary' : undefined;
    }),
    c('diff-summary-none', 1, ARTIFACTS, (api) =>
      fn<(d: unknown) => string>(api, 'summarizeDiff')(undefined).includes('reported none')
        ? undefined
        : 'no diff is not named',
    ),
  ];
}
