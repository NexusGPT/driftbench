import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import {
  type AgentAdapter,
  findSpecFiles,
  globMatches,
  IssueCodes,
  type LoadResult,
  lintSpec,
  loadSpecFile,
  type Message,
  type Observed,
  parseSpecText,
  type ResolvedGiven,
  type RunMode,
  type RunResult,
  type Spec,
  type TargetRef,
  validateSpec,
} from '@agent-nexus/driftbench-core';
import type { RawSpec } from '../../plant';
import { type BankItem, expectAll, fail, type ItemResult, type ItemSource, PASS, type Tier } from '../types';
import { runScenario } from '../world';

/**
 * Claims of the spec pages, one item per documented statement:
 * docs/reference/spec.md (fields, defaults, "Shorthand"), docs/reference/cli.md ("Issue codes", "Paths"),
 * docs/concepts/given-when-then.md ("Given", "When", "Then"), docs/concepts/block.md, and
 * docs/running.md ("Given resolution and the hash", "The history"), docs/concepts/run-modes.md
 * ("Teacher-forced"). Loader and hash items sit at level 1; Given resolution seen in run records at level 5.
 * Every oracle is written by hand from the docs; no item uses the loader or the runner as its reference.
 */

const FAMILY = 'claim-spec';

const NORMALIZE = 'packages/core/src/spec/normalize.ts';
const SEMANTICS = 'packages/core/src/spec/semantics.ts';
const LINT = 'packages/core/src/spec/lint.ts';
const LOAD = 'packages/core/src/spec/load.ts';
const HASH = 'packages/core/src/spec/hash.ts';
const SCHEMA = 'packages/core/src/schema/spec.ts';
const ISSUES = 'packages/core/src/spec/issues.ts';
const GIVEN = 'packages/core/src/runner/given.ts';
const RUN = 'packages/core/src/runner/run.ts';

type Raw = Record<string, unknown>;

function add(
  out: BankItem[],
  slug: string,
  tier: Tier,
  level: number,
  component: string,
  title: string,
  cause: string,
  check: BankItem['check'],
  source: ItemSource = 'contract',
): void {
  out.push({ id: `claim/spec/${slug}`, family: FAMILY, tier, level, component, source, title, cause, check });
}

/** A minimal valid spec, varied by the seed. */
function base(seed: number, extra: Raw = {}): Raw {
  return {
    id: `claim-spec-${seed}`,
    blocks: [
      {
        id: 'b0',
        user: `Hello, I am customer${seed}@example.org.`,
        expect: { must: [`R-${1000 + seed}`] },
      },
    ],
    ...extra,
  };
}

function block(seed: number, index: number, extra: Raw = {}): Raw {
  return {
    id: `b${index}`,
    user: `Message ${index} from customer${seed}@example.org.`,
    expect: { must: [`R-${1000 + seed + index}`] },
    ...extra,
  };
}

function v(raw: unknown): LoadResult {
  return validateSpec(raw, 'claim-spec');
}

function listIssues(r: LoadResult): string {
  const all = r.ok ? r.warnings : [...r.errors, ...r.warnings];
  return all.length === 0
    ? 'no issue'
    : all
        .slice(0, 6)
        .map((issue) => `${issue.level} ${issue.code} at '${issue.path}'`)
        .join('; ');
}

function expectError(r: LoadResult, code: string, path?: string): ItemResult {
  const where = path === undefined ? '' : ` at path '${path}'`;
  if (r.ok)
    return fail(`expected the error ${code}${where}; the loader accepted the spec (${listIssues(r)})`);
  const hit = r.errors.some((issue) => issue.code === code && (path === undefined || issue.path === path));
  return hit ? PASS : fail(`expected the error ${code}${where}; got ${listIssues(r)}`);
}

function expectSchemaError(r: LoadResult, path: string, code?: string): ItemResult {
  if (r.ok) return fail(`expected a SCHEMA_* error at path '${path}'; the loader accepted the spec`);
  const hit = r.errors.some(
    (issue) =>
      (code ? issue.code === code : issue.code.startsWith('SCHEMA_')) &&
      (issue.path === path || issue.path.startsWith(`${path}.`)),
  );
  return hit ? PASS : fail(`expected ${code ?? 'a SCHEMA_* error'} at path '${path}'; got ${listIssues(r)}`);
}

function expectValid(r: LoadResult, then?: (spec: Spec) => ItemResult): ItemResult {
  if (!r.ok) return fail(`expected a valid spec; the loader refused it: ${listIssues(r)}`);
  return then ? then(r.spec) : PASS;
}

function expectNoError(r: LoadResult, code: string): ItemResult {
  if (r.ok) return PASS;
  return r.errors.some((issue) => issue.code === code)
    ? fail(`expected no ${code}; got ${listIssues(r)}`)
    : fail(`expected a valid spec; the loader refused it: ${listIssues(r)}`);
}

function expectWarning(r: LoadResult, code: string, path?: string): ItemResult {
  const where = path === undefined ? '' : ` at path '${path}'`;
  if (!r.ok)
    return fail(`expected a valid spec with the warning ${code}${where}; it is invalid: ${listIssues(r)}`);
  const hit = r.warnings.some((issue) => issue.code === code && (path === undefined || issue.path === path));
  return hit ? PASS : fail(`expected the warning ${code}${where}; got ${listIssues(r)}`);
}

function expectNoWarning(r: LoadResult, code: string): ItemResult {
  if (!r.ok) return fail(`expected a valid spec; it is invalid: ${listIssues(r)}`);
  return r.warnings.some((issue) => issue.code === code)
    ? fail(`expected no warning ${code}; got ${listIssues(r)}`)
    : PASS;
}

/** Canonical JSON written from the docs: object keys sorted at every depth, undefined dropped. */
function canon(value: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x !== null && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(x).sort()) {
        const child = (x as Record<string, unknown>)[key];
        if (child !== undefined) out[key] = sort(child);
      }
      return out;
    }
    return x;
  };
  return JSON.stringify(sort(value));
}

function sha12(value: unknown): string {
  return createHash('sha256').update(canon(value)).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------------------------------------
// The probe agent for Given resolution: it records every session it opens, every resolved Given it is sent
// and every history it reads, and answers with a fixed reply.

type Probe = {
  adapter: AgentAdapter;
  opens: ResolvedGiven[];
  turns: ResolvedGiven[];
  histories: Message[][];
  worlds: unknown[];
  vars: Record<string, unknown>[];
};

function replyText(index: number): string {
  return `Noted, reference R-${2000 + index}.`;
}

function probe(): Probe {
  const histories: Message[][] = [];
  const worlds: unknown[] = [];
  const vars: Record<string, unknown>[] = [];
  let calls = 0;
  const inner = functionAdapter({
    respond: (messages, world, runtimeVars): Observed => {
      histories.push(messages);
      worlds.push(world);
      vars.push(runtimeVars);
      const text = replyText(calls);
      calls += 1;
      return {
        segments: [{ type: 'text', text }],
        text,
        toolCalls: [],
        cost: { usd: 0 },
        latencyMs: 0,
      };
    },
    deterministic: true,
    version: 'claims-spec',
  });
  const opens: ResolvedGiven[] = [];
  const turns: ResolvedGiven[] = [];
  const adapter: AgentAdapter = {
    ...inner,
    open: async (given) => {
      opens.push(structuredClone(given));
      return inner.open(given);
    },
    send: async (session, turn) => {
      turns.push(structuredClone(turn.given));
      return inner.send(session, turn);
    },
  };
  return { adapter, opens, turns, histories, worlds, vars };
}

async function runProbe(
  raw: Raw,
  mode: RunMode = 'F',
  target?: TargetRef,
  options: { sandbox?: boolean; perturbationId?: string } = {},
): Promise<{ p: Probe; run: RunResult }> {
  const p = probe();
  const adapter: AgentAdapter = options.sandbox
    ? { ...p.adapter, capabilities: () => ({ ...p.adapter.capabilities(), sandbox: true }) }
    : p.adapter;
  const run = await runScenario(raw as RawSpec, new Map(), {
    adapter,
    mode,
    ...(target ? { target } : {}),
    ...(options.perturbationId ? { perturbationId: options.perturbationId } : {}),
  });
  return { p, run };
}

function show(value: unknown): string {
  const text = canon(value);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

function sameJson(label: string, got: unknown, want: unknown): ItemResult {
  return canon(got) === canon(want) ? PASS : fail(`${label}: expected ${show(want)}, got ${show(got)}`);
}

/** A three-block spec for Given resolution. */
function threeBlocks(seed: number, blocks: Raw[] = [], extra: Raw = {}): Raw {
  const filled = [0, 1, 2].map((index) => ({ ...block(seed, index), ...(blocks[index] ?? {}) }));
  return { id: `claim-given-${seed}`, blocks: filled, ...extra };
}

// ---------------------------------------------------------------------------------------------------------

function shorthand(out: BankItem[]): void {
  add(
    out,
    'shorthand/kind-default',
    1,
    1,
    NORMALIZE,
    'spec.md "Shorthand": kind may be left out, the loader sets conversation',
    'The loader sets kind to conversation when the spec leaves it out.',
    async ({ seed }) =>
      expectValid(v(base(seed)), (spec) =>
        spec.kind === 'conversation' ? PASS : fail(`kind: expected 'conversation', got '${spec.kind}'`),
      ),
  );
  add(
    out,
    'shorthand/kind-task-kept',
    1,
    1,
    NORMALIZE,
    'spec.md "Spec": kind task, when written, stays task',
    'The loader keeps a written kind and only fills it when absent.',
    async ({ seed }) =>
      expectValid(v(base(seed, { kind: 'task' })), (spec) =>
        spec.kind === 'task' ? PASS : fail(`kind: expected 'task', got '${spec.kind}'`),
      ),
  );
  add(
    out,
    'shorthand/user-to-when',
    1,
    1,
    NORMALIZE,
    'spec.md "Shorthand": a block may write user: <message> in place of when',
    'The loader moves a block-level user message under when.user.',
    async ({ seed }) => {
      const message = `Hi from customer${seed}@example.org`;
      return expectValid(
        v({ id: `s-${seed}`, blocks: [{ user: message, expect: { must: ['x'] } }] }),
        (spec) => sameJson('blocks.0.when', spec.blocks[0]?.when, { user: message }),
      );
    },
  );
  add(
    out,
    'shorthand/burst-to-when',
    1,
    1,
    NORMALIZE,
    'spec.md "Shorthand": a block may write burst: [a, b] in place of when',
    'The loader moves a block-level burst under when.burst.',
    async ({ seed }) => {
      const burst = [`first ${seed}`, `second ${seed}`, `third ${seed}`];
      return expectValid(v({ id: `s-${seed}`, blocks: [{ burst, expect: { must: ['x'] } }] }), (spec) =>
        sameJson('blocks.0.when', spec.blocks[0]?.when, { burst }),
      );
    },
  );
  add(
    out,
    'shorthand/ledger-seed',
    1,
    1,
    NORMALIZE,
    'spec.md "Shorthand": ledger_seed at the top level is the same as given.ledger',
    'The loader rewrites ledger_seed into given.ledger.',
    async ({ seed }) => {
      const ledger = { email: `customer${seed}@example.org`, code: `R-${3000 + seed}` };
      return expectValid(v(base(seed, { ledger_seed: ledger })), (spec) =>
        sameJson('given.ledger', spec.given?.ledger, ledger),
      );
    },
  );
  add(
    out,
    'shorthand/ledger-seed-keeps-given',
    2,
    1,
    NORMALIZE,
    'spec.md "Shorthand": ledger_seed beside given.vars and given.world keeps both',
    'The loader merges ledger_seed into an existing given without dropping its other parts.',
    async ({ seed }) => {
      const ledger = { email: `customer${seed}@example.org` };
      const given = { vars: { channel: 'chat', seed }, world: { store: { account: `A-${seed}` } } };
      return expectValid(v(base(seed, { ledger_seed: ledger, given })), (spec) =>
        sameJson('given', spec.given, { ...given, ledger }),
      );
    },
  );
  add(
    out,
    'shorthand/workspace-seed-string',
    1,
    1,
    NORMALIZE,
    'spec.md "Shorthand": workspace_seed as a string means { from: <string> }',
    'The loader rewrites a string workspace_seed into given.world.workspace.from.',
    async ({ seed }) => {
      const folder = `fixtures/seed-${seed}`;
      return expectValid(v(base(seed, { workspace_seed: folder })), (spec) =>
        sameJson('given.world.workspace', spec.given?.world?.workspace, { from: folder }),
      );
    },
  );
  add(
    out,
    'shorthand/workspace-seed-mapping',
    1,
    1,
    NORMALIZE,
    'spec.md "Shorthand": workspace_seed at the top level is the same as given.world.workspace',
    'The loader rewrites a mapping workspace_seed into given.world.workspace.',
    async ({ seed }) => {
      const workspace = { files: { [`data/n${seed}.csv`]: `month,revenue\nJanuary,${seed}\n` } };
      return expectValid(v(base(seed, { workspace_seed: workspace })), (spec) =>
        sameJson('given.world.workspace', spec.given?.world?.workspace, workspace),
      );
    },
  );
  add(
    out,
    'shorthand/workspace-seed-keeps-world',
    2,
    1,
    NORMALIZE,
    'spec.md "Shorthand": workspace_seed beside given.world.tools keeps the tools',
    'The loader merges workspace_seed into an existing given.world without dropping its other parts.',
    async ({ seed }) => {
      const tools = { lookup: { result: { code: `R-${4000 + seed}` } } };
      return expectValid(
        v(base(seed, { workspace_seed: `fixtures/w${seed}`, given: { world: { tools } } })),
        (spec) =>
          sameJson('given.world', spec.given?.world, { tools, workspace: { from: `fixtures/w${seed}` } }),
      );
    },
  );
}

function issueCodes(out: BankItem[]): void {
  add(
    out,
    'issue/spec-parse-yaml',
    1,
    1,
    LOAD,
    'cli.md "Issue codes": SPEC_PARSE when the text is not valid YAML',
    'parseSpecText reports SPEC_PARSE on YAML that does not parse.',
    async ({ seed }) =>
      expectError(parseSpecText(`id: s${seed}\nblocks: [ {user: "a"\n`, 'yaml'), 'SPEC_PARSE'),
  );
  add(
    out,
    'issue/spec-parse-json',
    1,
    1,
    LOAD,
    'cli.md "Issue codes": SPEC_PARSE when the text is not valid JSON',
    'parseSpecText reports SPEC_PARSE on JSON that does not parse.',
    async ({ seed }) => expectError(parseSpecText(`{"id": "s${seed}", "blocks": [}`, 'json'), 'SPEC_PARSE'),
  );
  add(
    out,
    'issue/spec-parse-duplicate-key',
    3,
    1,
    LOAD,
    'cli.md "Issue codes": a YAML mapping with a repeated key is not valid YAML, so SPEC_PARSE',
    'parseSpecText refuses repeated YAML keys with SPEC_PARSE.',
    async ({ seed }) =>
      expectError(
        parseSpecText(
          `id: s${seed}\nid: t${seed}\nblocks:\n  - user: hi\n    expect: { must: [x] }\n`,
          'yaml',
        ),
        'SPEC_PARSE',
      ),
    'adversarial',
  );
  add(
    out,
    'issue/spec-parse-missing-file',
    1,
    1,
    LOAD,
    'cli.md "Paths": a path that does not exist is an invalid spec with the code SPEC_PARSE',
    'loadSpecFile reports a missing file as SPEC_PARSE.',
    async ({ scratch, seed }) =>
      expectError(await loadSpecFile(join(scratch, `absent-${seed}.yaml`)), 'SPEC_PARSE'),
  );
  add(
    out,
    'issue/whole-file-path-empty',
    2,
    1,
    LOAD,
    'cli.md "--json": an issue path is empty when the issue concerns the whole file',
    'parseSpecText gives a whole-file issue an empty path.',
    async ({ seed }) => expectError(parseSpecText(`[not, a, spec, ${seed}`, 'yaml'), 'SPEC_PARSE', ''),
  );
  add(
    out,
    'issue/json-extension',
    2,
    1,
    LOAD,
    'cli.md "Paths": a file ending in .json is read as JSON',
    'loadSpecFile parses a .json file as JSON.',
    async ({ scratch, seed }) => {
      const { writeFileSync } = await import('node:fs');
      const path = join(scratch, `spec-${seed}.spec.json`);
      writeFileSync(path, JSON.stringify(base(seed)));
      return expectValid(await loadSpecFile(path), (spec) =>
        spec.id === `claim-spec-${seed}` ? PASS : fail(`id: expected claim-spec-${seed}, got ${spec.id}`),
      );
    },
  );
  add(
    out,
    'issue/not-object-list',
    1,
    1,
    NORMALIZE,
    'cli.md "Issue codes": SPEC_NOT_OBJECT when the file does not hold one mapping at the top level',
    'The loader reports SPEC_NOT_OBJECT for a top-level list.',
    async ({ seed }) => expectError(v([base(seed)]), 'SPEC_NOT_OBJECT'),
  );
  add(
    out,
    'issue/not-object-scalar',
    1,
    1,
    NORMALIZE,
    'cli.md "Issue codes": SPEC_NOT_OBJECT for a YAML file holding one scalar',
    'The loader reports SPEC_NOT_OBJECT for a top-level scalar.',
    async ({ seed }) => expectError(parseSpecText(`just a sentence ${seed}\n`, 'yaml'), 'SPEC_NOT_OBJECT'),
  );
  add(
    out,
    'issue/alias-conflict-ledger',
    1,
    1,
    NORMALIZE,
    'cli.md "Issue codes": SPEC_ALIAS_CONFLICT when ledger_seed and given.ledger are both set',
    'The loader reports SPEC_ALIAS_CONFLICT when ledger_seed meets given.ledger.',
    async ({ seed }) =>
      expectError(
        v(base(seed, { ledger_seed: { a: seed }, given: { ledger: { b: seed } } })),
        'SPEC_ALIAS_CONFLICT',
      ),
  );
  add(
    out,
    'issue/alias-conflict-workspace',
    1,
    1,
    NORMALIZE,
    'cli.md "Issue codes": SPEC_ALIAS_CONFLICT when workspace_seed and given.world.workspace are both set',
    'The loader reports SPEC_ALIAS_CONFLICT when workspace_seed meets given.world.workspace.',
    async ({ seed }) =>
      expectError(
        v(base(seed, { workspace_seed: 'a', given: { world: { workspace: { from: `b${seed}` } } } })),
        'SPEC_ALIAS_CONFLICT',
      ),
  );
  add(
    out,
    'issue/stimulus-missing',
    1,
    1,
    NORMALIZE,
    'cli.md "Issue codes": BLOCK_STIMULUS_MISSING when a block has none of user, burst and when',
    'The loader reports BLOCK_STIMULUS_MISSING at the block path.',
    async ({ seed }) =>
      expectError(
        v({ id: `s${seed}`, blocks: [block(seed, 0), { expect: { must: ['x'] } }] }),
        'BLOCK_STIMULUS_MISSING',
        'blocks.1',
      ),
  );
  add(
    out,
    'issue/stimulus-ambiguous-user-burst',
    1,
    1,
    NORMALIZE,
    'cli.md "Issue codes": BLOCK_STIMULUS_AMBIGUOUS when a block has both user and burst',
    'The loader reports BLOCK_STIMULUS_AMBIGUOUS when two shorthands meet.',
    async ({ seed }) =>
      expectError(
        v({ id: `s${seed}`, blocks: [{ user: 'a', burst: ['b', 'c'], expect: { must: ['x'] } }] }),
        'BLOCK_STIMULUS_AMBIGUOUS',
        'blocks.0',
      ),
  );
  add(
    out,
    'issue/stimulus-ambiguous-user-when',
    1,
    1,
    NORMALIZE,
    'given-when-then.md "When": a block takes exactly one of user, burst and when',
    'The loader reports BLOCK_STIMULUS_AMBIGUOUS when a shorthand meets when.',
    async ({ seed }) =>
      expectError(
        v({ id: `s${seed}`, blocks: [{ user: 'a', when: { user: 'b' }, expect: { must: ['x'] } }] }),
        'BLOCK_STIMULUS_AMBIGUOUS',
        'blocks.0',
      ),
  );
  add(
    out,
    'issue/regex-must',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": REGEX_INVALID when a must pattern does not compile',
    'The loader compiles every must pattern and reports REGEX_INVALID.',
    async ({ seed }) =>
      expectError(
        v(base(seed, { blocks: [block(seed, 0, { expect: { must: ['ok', `R-(${seed}`] } })] })),
        'REGEX_INVALID',
        'blocks.0.expect.must.1',
      ),
  );
  add(
    out,
    'issue/regex-must-not',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": REGEX_INVALID when a must_not pattern does not compile',
    'The loader compiles every must_not pattern and reports REGEX_INVALID.',
    async ({ seed }) =>
      expectError(
        v(base(seed, { blocks: [block(seed, 0, { expect: { must_not: [`[${seed}`] } })] })),
        'REGEX_INVALID',
        'blocks.0.expect.must_not.0',
      ),
  );
  add(
    out,
    'issue/regex-tool-input',
    2,
    1,
    SEMANTICS,
    'cli.md "Issue codes": REGEX_INVALID when a regex assertion on a tool input does not compile',
    'The loader compiles regex assertions in expect.tools input and reports REGEX_INVALID.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            blocks: [
              block(seed, 0, {
                expect: { tools: [{ label: 'lookup', count: 1, input: { email: { regex: `(${seed}` } } }] },
              }),
            ],
          }),
        ),
        'REGEX_INVALID',
        'blocks.0.expect.tools.0.input.email.regex',
      ),
  );
  add(
    out,
    'issue/regex-end-state',
    2,
    1,
    SEMANTICS,
    'cli.md "Issue codes": REGEX_INVALID when a regex assertion in end_state does not compile',
    'The loader compiles regex assertions in end_state and reports REGEX_INVALID.',
    async ({ seed }) =>
      expectError(
        v(base(seed, { end_state: { source: 'tool:submit', expect: { plan: { regex: `*${seed}` } } } })),
        'REGEX_INVALID',
      ),
  );
  add(
    out,
    'issue/regex-multiline-flag',
    3,
    1,
    SEMANTICS,
    'spec.md "Assertion": specs match text with the m flag, so ^ and $ anchors compile and are accepted',
    'The loader compiles patterns with the m flag as checks use them.',
    async ({ seed }) =>
      expectNoError(
        v(
          base(seed, {
            blocks: [block(seed, 0, { expect: { must: [`^R-${seed}$`, '(?<code>R-\\d{4})'] } })],
          }),
        ),
        'REGEX_INVALID',
      ),
  );
  add(
    out,
    'issue/criterion-ref-invalid',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": CRITERION_REF_INVALID when a reference is not a name optionally followed by @gating',
    'The loader parses criterion references and reports CRITERION_REF_INVALID.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            criteria: [{ name: 'polite', rubric: 'Is the reply polite?' }],
            blocks: [block(seed, 0, { expect: { criteria: [`polite@gate${seed}`] } })],
          }),
        ),
        'CRITERION_REF_INVALID',
        'blocks.0.expect.criteria.0',
      ),
  );
  add(
    out,
    'issue/criterion-gating-accepted',
    1,
    1,
    SEMANTICS,
    'spec.md "Expect": name@gating is a valid criterion reference',
    'The loader accepts a defined criterion name followed by @gating.',
    async ({ seed }) =>
      expectValid(
        v(
          base(seed, {
            criteria: [{ name: `polite.v${seed}`, rubric: 'Is the reply polite?' }],
            blocks: [block(seed, 0, { expect: { criteria: [`polite.v${seed}@gating`] } })],
          }),
        ),
      ),
  );
  add(
    out,
    'issue/criterion-undefined',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": CRITERION_UNDEFINED when the spec defines criteria and a block names another',
    'The loader reports CRITERION_UNDEFINED for a name missing from the spec criteria.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            criteria: [{ name: 'polite', rubric: 'Is the reply polite?' }],
            blocks: [block(seed, 0, { expect: { criteria: [`brief${seed}`] } })],
          }),
        ),
        'CRITERION_UNDEFINED',
        'blocks.0.expect.criteria.0',
      ),
  );
  add(
    out,
    'issue/criterion-undefined-in-perturbation',
    3,
    1,
    SEMANTICS,
    'cli.md "Issue codes": CRITERION_UNDEFINED also holds for a perturbation expect',
    'The loader checks criterion names in perturbation expectations too.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            criteria: [{ name: 'polite', rubric: 'Is the reply polite?' }],
            perturbations: [
              {
                id: 'p0',
                class: 'D1_off_topic',
                inject_at: 0,
                user: 'What are your opening hours?',
                expect: { criteria: [`brief${seed}`] },
                recovery: { within_blocks: 1 },
              },
            ],
          }),
        ),
        'CRITERION_UNDEFINED',
        'perturbations.0.expect.criteria.0',
      ),
  );
  add(
    out,
    'issue/criterion-duplicate',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": CRITERION_DUPLICATE when two criteria share a name',
    'The loader reports CRITERION_DUPLICATE on a repeated criterion name.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            criteria: [
              { name: `c${seed}`, rubric: 'one' },
              { name: `c${seed}`, rubric: 'two' },
            ],
          }),
        ),
        'CRITERION_DUPLICATE',
        'criteria.1.name',
      ),
  );
  add(
    out,
    'issue/perturbation-out-of-range',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": PERTURBATION_OUT_OF_RANGE when inject_at is past the last position',
    'The loader reports PERTURBATION_OUT_OF_RANGE when inject_at exceeds the block count.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            perturbations: [
              {
                id: 'p0',
                class: 'D7_silence_or_burst',
                inject_at: 5 + seed,
                user: '',
                recovery: { within_blocks: 1 },
              },
            ],
          }),
        ),
        'PERTURBATION_OUT_OF_RANGE',
        'perturbations.0.inject_at',
      ),
  );
  add(
    out,
    'issue/perturbation-empty',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": PERTURBATION_EMPTY when a perturbation has none of user, burst and world',
    'The loader reports PERTURBATION_EMPTY for a perturbation with no content.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            perturbations: [
              { id: `p${seed}`, class: 'D1_off_topic', inject_at: 0, recovery: { within_blocks: 1 } },
            ],
          }),
        ),
        'PERTURBATION_EMPTY',
        'perturbations.0',
      ),
  );
  add(
    out,
    'issue/perturbation-world-only',
    2,
    1,
    SEMANTICS,
    'spec.md "Perturbation": a perturbation with only world (a tool forced to fail) is not empty',
    'The loader accepts a perturbation that only changes the world.',
    async ({ seed }) =>
      expectNoError(
        v(
          base(seed, {
            perturbations: [
              {
                id: `p${seed}`,
                class: 'D8_tool_failure',
                inject_at: 0,
                world: { tools: { lookup: { error: 'timeout' } } },
                recovery: { within_blocks: 1 },
              },
            ],
          }),
        ),
        'PERTURBATION_EMPTY',
      ),
  );
  add(
    out,
    'issue/duplicate-block-id',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": DUPLICATE_BLOCK_ID when two blocks share an id',
    'The loader reports DUPLICATE_BLOCK_ID on a repeated block id.',
    async ({ seed }) =>
      expectError(
        v({ id: `s${seed}`, blocks: [block(seed, 0), block(seed, 1), block(seed, 0)] }),
        'DUPLICATE_BLOCK_ID',
        'blocks.2.id',
      ),
  );
  add(
    out,
    'issue/duplicate-perturbation-id',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": DUPLICATE_PERTURBATION_ID when two perturbations share an id',
    'The loader reports DUPLICATE_PERTURBATION_ID on a repeated perturbation id.',
    async ({ seed }) => {
      const p = {
        id: `p${seed}`,
        class: 'D1_off_topic',
        inject_at: 0,
        user: 'Hours?',
        recovery: { within_blocks: 1 },
      };
      return expectError(
        v(base(seed, { perturbations: [p, { ...p }] })),
        'DUPLICATE_PERTURBATION_ID',
        'perturbations.1.id',
      );
    },
  );
  add(
    out,
    'issue/tool-count-contradiction',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": TOOL_COUNT_CONTRADICTION when a tool is expected 0 times but has input assertions',
    'The loader reports TOOL_COUNT_CONTRADICTION for count 0 with input.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            blocks: [
              block(seed, 0, {
                expect: { tools: [{ label: 'refund', count: 0, input: { amount: seed } }] },
              }),
            ],
          }),
        ),
        'TOOL_COUNT_CONTRADICTION',
        'blocks.0.expect.tools.0',
      ),
  );
  add(
    out,
    'issue/tool-count-contradiction-range',
    2,
    1,
    SEMANTICS,
    'cli.md "Issue codes": a range { max: 0 } also expects a tool 0 times, so input assertions contradict it',
    'The loader treats a count range with max 0 as zero calls.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            blocks: [
              block(seed, 0, {
                expect: { tools: [{ label: 'refund', count: { min: 0, max: 0 }, input: { amount: seed } }] },
              }),
            ],
          }),
        ),
        'TOOL_COUNT_CONTRADICTION',
      ),
  );
  add(
    out,
    'issue/count-range-tools',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": COUNT_RANGE_INVALID when a tool count has min greater than max',
    'The loader reports COUNT_RANGE_INVALID on a tool count range.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            blocks: [
              block(seed, 0, { expect: { tools: [{ label: 'lookup', count: { min: 3 + seed, max: 2 } }] } }),
            ],
          }),
        ),
        'COUNT_RANGE_INVALID',
        'blocks.0.expect.tools.0.count',
      ),
  );
  add(
    out,
    'issue/count-range-references',
    2,
    1,
    SEMANTICS,
    'cli.md "Issue codes": COUNT_RANGE_INVALID for any count, here on expect.references',
    'The loader reports COUNT_RANGE_INVALID on a reference count range.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            blocks: [
              block(seed, 0, {
                expect: { references: [{ path: 'docs/**/*.md', count: { min: seed + 1, max: seed - 1 } }] },
              }),
            ],
          }),
        ),
        'COUNT_RANGE_INVALID',
        'blocks.0.expect.references.0.count',
      ),
  );
  add(
    out,
    'issue/count-range-subagents',
    2,
    1,
    SEMANTICS,
    'cli.md "Issue codes": COUNT_RANGE_INVALID for any count, here on expect.subagents',
    'The loader reports COUNT_RANGE_INVALID on a subagent count range.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            blocks: [
              block(seed, 0, {
                expect: { subagents: [{ name: 'reader', count: { min: 5, max: seed % 5 } }] },
              }),
            ],
          }),
        ),
        'COUNT_RANGE_INVALID',
        'blocks.0.expect.subagents.0.count',
      ),
  );
  add(
    out,
    'issue/must-conflict',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": MUST_CONFLICT when the same pattern is in must and in must_not',
    'The loader reports MUST_CONFLICT for a pattern in both lists.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            blocks: [block(seed, 0, { expect: { must: ['ok', `R-${seed}`], must_not: [`R-${seed}`] } })],
          }),
        ),
        'MUST_CONFLICT',
        'blocks.0.expect.must.1',
      ),
  );
  add(
    out,
    'issue/stage-unknown',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": STAGE_UNKNOWN when the spec lists stages and expect.stage names another',
    'The loader reports STAGE_UNKNOWN for an expect.stage outside the catalogue.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            stages: ['open', 'offer'],
            blocks: [block(seed, 0, { expect: { stage: `close${seed}` } })],
          }),
        ),
        'STAGE_UNKNOWN',
        'blocks.0.expect.stage',
      ),
  );
  add(
    out,
    'issue/stage-unknown-recovery',
    2,
    1,
    SEMANTICS,
    'cli.md "Issue codes": STAGE_UNKNOWN when recovery.stage_after names a stage not in stages',
    'The loader reports STAGE_UNKNOWN for a recovery.stage_after outside the catalogue.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            stages: ['open', 'offer'],
            perturbations: [
              {
                id: 'p0',
                class: 'D10_return',
                inject_at: 1,
                user: 'ok, let us continue',
                recovery: { within_blocks: 1, stage_after: `confirm${seed}` },
              },
            ],
          }),
        ),
        'STAGE_UNKNOWN',
        'perturbations.0.recovery.stage_after',
      ),
  );
  add(
    out,
    'issue/stage-free-without-catalogue',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": STAGE_UNKNOWN applies only when the spec lists stages',
    'The loader accepts any expect.stage when the spec has no stages.',
    async ({ seed }) =>
      expectNoError(
        v(base(seed, { blocks: [block(seed, 0, { expect: { stage: `anything${seed}` } })] })),
        'STAGE_UNKNOWN',
      ),
  );
  add(
    out,
    'issue/retention-unknown',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": RETENTION_FACT_UNKNOWN when knowledge_retention names a fact no earlier ledger holds',
    'The loader reports RETENTION_FACT_UNKNOWN for a fact absent from every earlier ledger.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            given: { ledger: { email: `customer${seed}@example.org` } },
            blocks: [block(seed, 0, { expect: { knowledge_retention: [{ fact: 'phone' }] } })],
          }),
        ),
        'RETENTION_FACT_UNKNOWN',
        'blocks.0.expect.knowledge_retention.0.fact',
      ),
  );
  add(
    out,
    'issue/retention-from-given',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": a retention fact held in given.ledger is known',
    'The loader counts spec given.ledger facts as known for knowledge_retention.',
    async ({ seed }) =>
      expectNoError(
        v(
          base(seed, {
            ledger_seed: { email: `customer${seed}@example.org` },
            blocks: [block(seed, 0, { expect: { knowledge_retention: [{ fact: 'email', use: true }] } })],
          }),
        ),
        'RETENTION_FACT_UNKNOWN',
      ),
  );
  add(
    out,
    'issue/retention-from-earlier-ledger-add',
    2,
    1,
    SEMANTICS,
    'cli.md "Issue codes": a retention fact from an earlier block\'s ledger_add is known',
    'The loader counts earlier ledger_add facts as known for knowledge_retention.',
    async ({ seed }) =>
      expectNoError(
        v({
          id: `s${seed}`,
          blocks: [
            block(seed, 0, { expect: { ledger_add: { plan: `fiber_${seed}` } } }),
            block(seed, 1, { expect: { knowledge_retention: [{ fact: 'plan' }] } }),
          ],
        }),
        'RETENTION_FACT_UNKNOWN',
      ),
  );
  add(
    out,
    'issue/retention-same-block-ledger-add',
    3,
    1,
    SEMANTICS,
    'cli.md "Issue codes": a fact the same block adds is not before the block, so RETENTION_FACT_UNKNOWN',
    'The loader counts only earlier blocks ledger_add, never the current one, for knowledge_retention.',
    async ({ seed }) =>
      expectError(
        v({
          id: `s${seed}`,
          blocks: [
            block(seed, 0, {
              expect: { ledger_add: { plan: `fiber_${seed}` }, knowledge_retention: [{ fact: 'plan' }] },
            }),
          ],
        }),
        'RETENTION_FACT_UNKNOWN',
      ),
    'adversarial',
  );
  add(
    out,
    'issue/retention-ask-regex',
    2,
    1,
    SEMANTICS,
    'spec.md "RetentionExpect": ask is a pattern, so one that does not compile is REGEX_INVALID',
    'The loader compiles knowledge_retention ask patterns and reports REGEX_INVALID.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            ledger_seed: { email: 'x@example.org' },
            blocks: [
              block(seed, 0, { expect: { knowledge_retention: [{ fact: 'email', ask: `(email${seed}` }] } }),
            ],
          }),
        ),
        'REGEX_INVALID',
        'blocks.0.expect.knowledge_retention.0.ask',
      ),
  );
  add(
    out,
    'issue/forbidden-tool-expected',
    1,
    1,
    SEMANTICS,
    'cli.md "Issue codes": TOOL_FORBIDDEN_EXPECTED when a block expects a tool listed in forbidden_tools',
    'The loader reports TOOL_FORBIDDEN_EXPECTED for an expected tool in forbidden_tools.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            rules: { forbidden_tools: [`refund${seed}`] },
            blocks: [block(seed, 0, { expect: { tools: [{ label: `refund${seed}`, count: 1 }] } })],
          }),
        ),
        'TOOL_FORBIDDEN_EXPECTED',
        'blocks.0.expect.tools.0',
      ),
  );
  add(
    out,
    'issue/forbidden-by-max-calls-zero',
    2,
    1,
    SEMANTICS,
    'cli.md "Issue codes": TOOL_FORBIDDEN_EXPECTED when the tool has max_calls at 0',
    'The loader treats rules.max_calls 0 as forbidding the tool.',
    async ({ seed }) =>
      expectError(
        v(
          base(seed, {
            rules: { max_calls: { [`send${seed}`]: 0 } },
            blocks: [block(seed, 0, { expect: { tools: [{ label: `send${seed}` }] } })],
          }),
        ),
        'TOOL_FORBIDDEN_EXPECTED',
      ),
  );
  add(
    out,
    'issue/forbidden-tool-count-zero-ok',
    2,
    1,
    SEMANTICS,
    'cli.md "Issue codes": a forbidden tool with count 0 is not expected, so no TOOL_FORBIDDEN_EXPECTED',
    'The loader allows a forbidden tool listed with count 0.',
    async ({ seed }) =>
      expectNoError(
        v(
          base(seed, {
            rules: { forbidden_tools: [`refund${seed}`] },
            blocks: [block(seed, 0, { expect: { tools: [{ label: `refund${seed}`, count: 0 }] } })],
          }),
        ),
        'TOOL_FORBIDDEN_EXPECTED',
      ),
  );
  add(
    out,
    'issue/errors-collected',
    2,
    1,
    LOAD,
    'block.md "A spec is checked before it runs": an invalid spec lists every error, not the first only',
    'validateSpec reports every semantic error of a spec in one pass.',
    async ({ seed }) => {
      const r = v({
        id: `s${seed}`,
        stages: ['open'],
        blocks: [
          block(seed, 0, { expect: { stage: 'nowhere', must: ['(a'] } }),
          block(seed, 0, { expect: { must: ['x'], must_not: ['x'] } }),
        ],
      });
      const want = ['STAGE_UNKNOWN', 'REGEX_INVALID', 'MUST_CONFLICT', 'DUPLICATE_BLOCK_ID'];
      if (r.ok) return fail(`expected ${want.join(', ')}; the spec was accepted`);
      const got = new Set<string>(r.errors.map((issue) => issue.code));
      const missing = want.filter((code) => !got.has(code));
      return missing.length === 0
        ? PASS
        : fail(`expected all of ${want.join(', ')}; missing ${missing.join(', ')} (${listIssues(r)})`);
    },
  );
}

function schemaRules(out: BankItem[]): void {
  add(
    out,
    'schema/unknown-top-key',
    1,
    1,
    SCHEMA,
    'spec.md: an unknown key is an error, SCHEMA_UNRECOGNIZED_KEYS',
    'The spec schema is strict and reports SCHEMA_UNRECOGNIZED_KEYS for an unknown top-level key.',
    async ({ seed }) =>
      expectSchemaError(v(base(seed, { ledgerSeed: { a: 1 } })), '', 'SCHEMA_UNRECOGNIZED_KEYS'),
  );
  add(
    out,
    'schema/unknown-expect-key',
    1,
    1,
    SCHEMA,
    'spec.md: an unknown key inside expect is an error',
    'The Expect schema is strict and reports SCHEMA_UNRECOGNIZED_KEYS for an unknown key.',
    async ({ seed }) =>
      expectSchemaError(
        v(base(seed, { blocks: [block(seed, 0, { expect: { mustNot: [`R-${seed}`] } })] })),
        'blocks.0.expect',
        'SCHEMA_UNRECOGNIZED_KEYS',
      ),
  );
  add(
    out,
    'schema/unknown-given-key',
    2,
    1,
    SCHEMA,
    'spec.md "GivenDefaults": prefix is a block Given field only, so a top-level given.prefix is an unknown key',
    'The GivenDefaults schema refuses prefix at the spec level.',
    async ({ seed }) =>
      expectSchemaError(
        v(base(seed, { given: { prefix: [{ role: 'user', content: `hi ${seed}` }] } })),
        'given',
        'SCHEMA_UNRECOGNIZED_KEYS',
      ),
    'adversarial',
  );
  add(
    out,
    'schema/kind-invalid',
    1,
    1,
    SCHEMA,
    'spec.md "Spec": kind is conversation or task, anything else is SCHEMA_INVALID_VALUE',
    'The spec schema refuses a kind outside conversation and task.',
    async ({ seed }) =>
      expectSchemaError(v(base(seed, { kind: `chat${seed}` })), 'kind', 'SCHEMA_INVALID_VALUE'),
  );
  add(
    out,
    'schema/blocks-empty',
    1,
    1,
    SCHEMA,
    'spec.md "Spec": blocks needs at least 1 item, SCHEMA_TOO_SMALL',
    'The spec schema refuses an empty blocks list with SCHEMA_TOO_SMALL.',
    async ({ seed }) => expectSchemaError(v({ id: `s${seed}`, blocks: [] }), 'blocks', 'SCHEMA_TOO_SMALL'),
  );
  add(
    out,
    'schema/id-required',
    1,
    1,
    SCHEMA,
    'spec.md "Spec": id is required',
    'The spec schema reports a missing id at path id.',
    async ({ seed }) => {
      const raw = base(seed);
      delete raw.id;
      return expectSchemaError(v(raw), 'id');
    },
  );
  add(
    out,
    'schema/id-pattern',
    1,
    1,
    SCHEMA,
    'spec.md "Spec": id matches ^[A-Za-z0-9][A-Za-z0-9._-]*$, so a leading hyphen or a space is refused',
    'The spec schema enforces the id pattern.',
    async ({ seed }) =>
      expectAll([
        [
          !v(base(seed, { id: `-s${seed}` })).ok,
          `id '-s${seed}' was accepted; the pattern forbids a leading hyphen`,
        ],
        [!v(base(seed, { id: `s ${seed}` })).ok, `id 's ${seed}' was accepted; the pattern forbids a space`],
        [
          v(base(seed, { id: `S${seed}.v_1-a` })).ok,
          `id 'S${seed}.v_1-a' was refused; the pattern allows it`,
        ],
      ]),
  );
  add(
    out,
    'schema/burst-min-two',
    1,
    1,
    SCHEMA,
    'spec.md "Stimulus": burst is a list of strings with at least 2 items',
    'The Stimulus schema refuses a burst of one message.',
    async ({ seed }) =>
      expectSchemaError(
        v({ id: `s${seed}`, blocks: [{ burst: [`only ${seed}`], expect: { must: ['x'] } }] }),
        'blocks.0.when',
      ),
  );
  add(
    out,
    'schema/when-two-keys',
    2,
    1,
    SCHEMA,
    'spec.md "Stimulus": when holds exactly one of user, burst or injection',
    'The Stimulus schema refuses a when with two stimulus keys.',
    async ({ seed }) =>
      expectSchemaError(
        v({ id: `s${seed}`, blocks: [{ when: { user: 'a', burst: ['b', 'c'] }, expect: { must: ['x'] } }] }),
        'blocks.0.when',
      ),
  );
  add(
    out,
    'schema/injection-class-required',
    1,
    1,
    SCHEMA,
    'spec.md "Stimulus injection": class and user are required',
    'The injection schema requires class.',
    async ({ seed }) =>
      expectSchemaError(
        v({
          id: `s${seed}`,
          blocks: [{ when: { injection: { user: `Hours? ${seed}` } }, expect: { must: ['x'] } }],
        }),
        'blocks.0.when',
      ),
  );
  add(
    out,
    'schema/deviation-class-closed',
    1,
    1,
    SCHEMA,
    'spec.md "DeviationClass": the ten classes D1 to D10 are the only values',
    'The DeviationClass enum refuses a class outside the ten.',
    async ({ seed }) =>
      expectAll([
        [
          !v(base(seed, { perturbations: [{ id: 'p', class: 'D11_other', inject_at: 0, user: 'x' }] })).ok,
          'class D11_other was accepted',
        ],
        [
          v(
            base(seed, {
              perturbations: [
                { id: 'p', class: 'D10_return', inject_at: 0, user: 'ok', recovery: { within_blocks: 1 } },
              ],
            }),
          ).ok,
          'class D10_return was refused',
        ],
      ]),
  );
  add(
    out,
    'schema/lang-length',
    1,
    1,
    SCHEMA,
    'spec.md "Spec": lang is a string of 2 to 8 characters',
    'The spec schema bounds lang to 2 to 8 characters.',
    async ({ seed }) =>
      expectAll([
        [!v(base(seed, { lang: 'E' })).ok, "lang 'E' (1 character) was accepted"],
        [!v(base(seed, { lang: 'en-GB-oxf' })).ok, "lang 'en-GB-oxf' (9 characters) was accepted"],
        [v(base(seed, { lang: 'EN' })).ok, "lang 'EN' was refused"],
        [v(base(seed, { lang: 'en-GB-ox' })).ok, "lang 'en-GB-ox' (8 characters) was refused"],
      ]),
  );
  add(
    out,
    'schema/similarity-min-range',
    2,
    1,
    SCHEMA,
    'spec.md "SimilarityExpect": min is a number from 0 to 1',
    'The SimilarityExpect schema bounds min to 0..1.',
    async ({ seed }) =>
      expectAll([
        [
          !v(
            base(seed, {
              blocks: [
                block(seed, 0, { expect: { similarity: [{ reference: 'Hello', min: 1 + seed / 10 }] } }),
              ],
            }),
          ).ok,
          `similarity min ${1 + seed / 10} was accepted`,
        ],
        [
          v(
            base(seed, {
              blocks: [block(seed, 0, { expect: { similarity: [{ reference: 'Hello', min: 1 }] } })],
            }),
          ).ok,
          'similarity min 1 was refused',
        ],
      ]),
  );
  add(
    out,
    'schema/count-forms',
    1,
    1,
    SCHEMA,
    'spec.md "Count": an integer at least 0, or a mapping with min and max',
    'The Count schema accepts integers and ranges and refuses negatives and fractions.',
    async ({ seed }) => {
      const at = (count: unknown) =>
        v(base(seed, { blocks: [block(seed, 0, { expect: { tools: [{ label: 'lookup', count }] } })] })).ok;
      return expectAll([
        [at(seed), `count ${seed} was refused`],
        [at({ min: 1 }), 'count { min: 1 } was refused'],
        [at({ max: seed }), `count { max: ${seed} } was refused`],
        [!at(-1), 'count -1 was accepted'],
        [!at(1.5), 'count 1.5 was accepted'],
        [!at({ min: -1 }), 'count { min: -1 } was accepted'],
      ]);
    },
  );
  add(
    out,
    'schema/assertion-one-key',
    2,
    1,
    SCHEMA,
    'spec.md "Assertion": a mapping with exactly one of exact, regex, contains, one_of, nonempty, absent, subset',
    'The Assertion schema refuses a mapping with two assertion keys.',
    async ({ seed }) =>
      expectSchemaError(
        v(
          base(seed, {
            blocks: [
              block(seed, 0, {
                expect: {
                  tools: [{ label: 'lookup', input: { email: { contains: 'example', regex: 'org$' } } }],
                },
              }),
            ],
          }),
        ),
        'blocks.0.expect.tools.0.input.email',
      ),
  );
  add(
    out,
    'schema/assertion-scalars',
    1,
    1,
    SCHEMA,
    'spec.md "Assertion": a bare string, number, boolean or null is an assertion',
    'The Assertion schema accepts bare scalars and null.',
    async ({ seed }) =>
      expectValid(
        v(
          base(seed, {
            blocks: [
              block(seed, 0, {
                expect: {
                  tools: [
                    {
                      label: 'lookup',
                      input: { email: `c${seed}@example.org`, step: seed, live: true, note: null },
                    },
                  ],
                },
              }),
            ],
          }),
        ),
      ),
  );
  add(
    out,
    'schema/end-state-forms',
    1,
    1,
    SCHEMA,
    'spec.md "EndState": none, a mapping or a list of mappings',
    'The EndState schema accepts its three forms and refuses another string.',
    async ({ seed }) => {
      const es = { source: 'tool:submit_order', expect: { plan: `fiber_${seed}` } };
      return expectAll([
        [v(base(seed, { end_state: 'none' })).ok, "end_state 'none' was refused"],
        [v(base(seed, { end_state: es })).ok, 'end_state as one mapping was refused'],
        [
          v(base(seed, { end_state: [es, { ...es, source: 'tool:send', mode: 'exact' }] })).ok,
          'end_state as a list was refused',
        ],
        [!v(base(seed, { end_state: 'nothing' })).ok, "end_state 'nothing' was accepted"],
        [
          !v(base(seed, { end_state: [] })).ok,
          'end_state as an empty list was accepted (needs at least 1 item)',
        ],
      ]);
    },
  );
  add(
    out,
    'schema/budget-steps-min',
    1,
    1,
    SCHEMA,
    'spec.md "Budget": steps is an integer of at least 1',
    'The Budget schema refuses steps 0.',
    async ({ seed }) =>
      expectSchemaError(
        v(base(seed, { blocks: [block(seed, 0, { budget: { steps: 0 } })] })),
        'blocks.0.budget.steps',
      ),
  );
  add(
    out,
    'schema/message-role',
    1,
    1,
    SCHEMA,
    'spec.md "Message": role is one of user, assistant, system, tool',
    'The Message schema refuses an unknown role in a prefix.',
    async ({ seed }) =>
      expectSchemaError(
        v(
          base(seed, {
            blocks: [block(seed, 0, { given: { prefix: [{ role: 'bot', content: `hi ${seed}` }] } })],
          }),
        ),
        'blocks.0.given.prefix.0.role',
      ),
  );
  add(
    out,
    'schema/criterion-name-pattern',
    2,
    1,
    SCHEMA,
    'spec.md "CriterionDef": name matches ^[A-Za-z0-9][A-Za-z0-9_.-]*$',
    'The CriterionDef schema enforces the name pattern.',
    async ({ seed }) =>
      expectSchemaError(v(base(seed, { criteria: [{ name: `@c${seed}`, rubric: 'r' }] })), 'criteria.0.name'),
  );
  add(
    out,
    'schema/issue-path-dotted',
    1,
    1,
    LOAD,
    'cli.md "--json": path is the dotted path in the spec, such as blocks.2.expect.tools.0.label',
    'validateSpec writes schema issue paths as dotted paths.',
    async ({ seed }) =>
      expectSchemaError(
        v({
          id: `s${seed}`,
          blocks: [block(seed, 0), block(seed, 1), block(seed, 2, { expect: { tools: [{ label: '' }] } })],
        }),
        'blocks.2.expect.tools.0.label',
      ),
  );
  add(
    out,
    'schema/stages-nonempty',
    2,
    1,
    SCHEMA,
    'spec.md "Spec": stages is a list of strings, each not empty',
    'The spec schema refuses an empty stage name.',
    async ({ seed }) => expectSchemaError(v(base(seed, { stages: ['open', ''] })), 'stages.1'),
  );
  add(
    out,
    'codes/documented-are-exported',
    1,
    1,
    ISSUES,
    'cli.md "Issue codes": every documented code is one the loader can report (IssueCodes)',
    'IssueCodes lists every code the cli.md Issue codes table documents.',
    async ({ root }) => {
      const page = readFileSync(join(root, 'docs/reference/cli.md'), 'utf8');
      const section = page.split('## Issue codes')[1]?.split('\n## ')[0] ?? '';
      const documented = [...section.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1] as string);
      const exported = new Set<string>(IssueCodes);
      const missing = documented.filter((code) => !exported.has(code));
      return documented.length === 0
        ? fail('found no code in the cli.md Issue codes table')
        : missing.length === 0
          ? PASS
          : fail(`documented but not in IssueCodes: ${missing.join(', ')}`);
    },
    'differential',
  );
  add(
    out,
    'codes/exported-are-documented',
    1,
    1,
    'docs/reference/cli.md',
    'cli.md "Issue codes": every code the loader exports is in the documented table',
    'cli.md Issue codes documents every code IssueCodes exports.',
    async ({ root }) => {
      const page = readFileSync(join(root, 'docs/reference/cli.md'), 'utf8');
      const section = page.split('## Issue codes')[1]?.split('\n## ')[0] ?? '';
      const documented = new Set<string>(
        [...section.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1] as string),
      );
      const missing = IssueCodes.filter((code) => !documented.has(code as string));
      return missing.length === 0 ? PASS : fail(`in IssueCodes but not in cli.md: ${missing.join(', ')}`);
    },
    'differential',
  );
}

function lintRules(out: BankItem[]): void {
  add(
    out,
    'lint/no-expect',
    1,
    1,
    LINT,
    'given-when-then.md "Then": a block with no expect checks nothing, and spec lint warns',
    'lintSpec warns BLOCK_NO_EXPECTATION on a block without expect.',
    async ({ seed }) =>
      expectWarning(
        v({ id: `s${seed}`, blocks: [block(seed, 0), { user: `bare ${seed}` }] }),
        'BLOCK_NO_EXPECTATION',
        'blocks.1',
      ),
  );
  add(
    out,
    'lint/empty-expect',
    2,
    1,
    LINT,
    'given-when-then.md "Then": an empty expect mapping also checks nothing',
    'lintSpec warns BLOCK_NO_EXPECTATION on an empty expect.',
    async ({ seed }) =>
      expectWarning(
        v({ id: `s${seed}`, blocks: [{ user: `bare ${seed}`, expect: {} }] }),
        'BLOCK_NO_EXPECTATION',
        'blocks.0',
      ),
  );
  add(
    out,
    'lint/empty-lists-expect',
    3,
    1,
    LINT,
    'given-when-then.md "Then": an expect whose fields are only empty lists checks nothing',
    'lintSpec treats empty lists as no expectation.',
    async ({ seed }) =>
      expectWarning(
        v({ id: `s${seed}`, blocks: [{ user: `bare ${seed}`, expect: { must: [], tools: [] } }] }),
        'BLOCK_NO_EXPECTATION',
      ),
    'adversarial',
  );
  add(
    out,
    'lint/expect-present-no-warning',
    1,
    1,
    LINT,
    'given-when-then.md "Then": a block with one expectation draws no BLOCK_NO_EXPECTATION',
    'lintSpec warns only on blocks that check nothing.',
    async ({ seed }) => expectNoWarning(v(base(seed)), 'BLOCK_NO_EXPECTATION'),
  );
  add(
    out,
    'lint/criterion-unresolved',
    1,
    1,
    LINT,
    'cli.md "Issue codes": CRITERION_UNRESOLVED when blocks name criteria and the spec defines none',
    'lintSpec warns CRITERION_UNRESOLVED when criteria are named but none defined.',
    async ({ seed }) =>
      expectWarning(
        v({ id: `s${seed}`, blocks: [block(seed, 0, { expect: { criteria: [`shared${seed}@gating`] } })] }),
        'CRITERION_UNRESOLVED',
      ),
  );
  add(
    out,
    'lint/task-without-outcome',
    1,
    1,
    LINT,
    'cli.md "Issue codes": TASK_WITHOUT_OUTCOME when a task checks none of artifacts, workspace, execution, end_state',
    'lintSpec warns TASK_WITHOUT_OUTCOME on a task spec with no outcome check.',
    async ({ seed }) => expectWarning(v(base(seed, { kind: 'task' })), 'TASK_WITHOUT_OUTCOME'),
  );
  add(
    out,
    'lint/task-end-state-is-outcome',
    2,
    1,
    LINT,
    'cli.md "Issue codes": a task with end_state checks an outcome, so no TASK_WITHOUT_OUTCOME',
    'lintSpec counts end_state as an outcome check for a task.',
    async ({ seed }) =>
      expectNoWarning(
        v(
          base(seed, {
            kind: 'task',
            end_state: { source: 'tool:write', expect: { path: `out${seed}.csv` } },
          }),
        ),
        'TASK_WITHOUT_OUTCOME',
      ),
  );
  add(
    out,
    'lint/task-execution-is-outcome',
    2,
    1,
    LINT,
    'cli.md "Issue codes": a task step with execution checks an outcome',
    'lintSpec counts execution as an outcome check for a task.',
    async ({ seed }) =>
      expectNoWarning(
        v({
          id: `s${seed}`,
          kind: 'task',
          blocks: [block(seed, 0, { expect: { execution: { exit_code: 0 } } })],
        }),
        'TASK_WITHOUT_OUTCOME',
      ),
  );
  add(
    out,
    'lint/conversation-no-outcome-ok',
    2,
    1,
    LINT,
    'cli.md "Issue codes": TASK_WITHOUT_OUTCOME applies to task specs only',
    'lintSpec never warns TASK_WITHOUT_OUTCOME on a conversation.',
    async ({ seed }) => expectNoWarning(v(base(seed)), 'TASK_WITHOUT_OUTCOME'),
  );
  add(
    out,
    'lint/perturbation-no-recovery',
    1,
    1,
    LINT,
    'cli.md "Issue codes": PERTURBATION_NO_RECOVERY when a perturbation has no recovery',
    'lintSpec warns PERTURBATION_NO_RECOVERY on a perturbation without recovery.',
    async ({ seed }) =>
      expectWarning(
        v(
          base(seed, {
            perturbations: [{ id: `p${seed}`, class: 'D1_off_topic', inject_at: 0, user: 'Hours?' }],
          }),
        ),
        'PERTURBATION_NO_RECOVERY',
        'perturbations.0',
      ),
  );
  add(
    out,
    'lint/warnings-keep-valid',
    1,
    1,
    LOAD,
    'cli.md "Issue codes": a warning is advice on a valid spec, never an error',
    'validateSpec returns ok with lint warnings attached.',
    async ({ seed }) => {
      const r = v({ id: `s${seed}`, kind: 'task', blocks: [{ user: 'x' }] });
      return r.ok && r.warnings.length >= 2 && r.warnings.every((issue) => issue.level === 'warning')
        ? PASS
        : fail(`expected ok with at least 2 warnings; got ok=${r.ok}, ${listIssues(r)}`);
    },
  );
  add(
    out,
    'lint/standalone-matches-loader',
    2,
    1,
    LINT,
    'cli.md "spec lint": lint prints the warnings of the valid specs, the same as the loader attaches',
    'lintSpec on a loaded spec gives the warnings the loader reports.',
    async ({ seed }) => {
      const r = v({ id: `s${seed}`, kind: 'task', blocks: [{ user: 'x' }, block(seed, 1)] });
      if (!r.ok) return fail(`expected a valid spec: ${listIssues(r)}`);
      const a = r.warnings.map((issue) => `${issue.code}@${issue.path}`).sort();
      const b = lintSpec(r.spec)
        .map((issue) => `${issue.code}@${issue.path}`)
        .sort();
      return sameJson('lintSpec warnings', b, a);
    },
    'differential',
  );
}

function hashRules(out: BankItem[]): void {
  add(
    out,
    'hash/format',
    1,
    1,
    HASH,
    'running.md "Given resolution and the hash": a hash is the first 12 hex characters of a SHA-256',
    'contentHash returns 12 lowercase hex characters.',
    async ({ seed }) =>
      expectValid(v(base(seed)), () => {
        const r = v(base(seed));
        return r.ok && /^[0-9a-f]{12}$/.test(r.hash)
          ? PASS
          : fail(`hash ${r.ok ? r.hash : '?'} is not 12 hex characters`);
      }),
  );
  add(
    out,
    'hash/key-order',
    1,
    1,
    HASH,
    'spec.md "Spec": the content hash is the cache key, so key order does not change it',
    'contentHash sorts object keys at every depth before hashing.',
    async ({ seed }) => {
      const a = v({
        id: `s${seed}`,
        title: 'T',
        blocks: [{ user: 'hi', expect: { must: ['a'], lang: 'EN' } }],
      });
      const b = v({
        blocks: [{ expect: { lang: 'EN', must: ['a'] }, user: 'hi' }],
        title: 'T',
        id: `s${seed}`,
      });
      return a.ok && b.ok && a.hash === b.hash
        ? PASS
        : fail(`hashes differ by key order: ${a.ok ? a.hash : '?'} vs ${b.ok ? b.hash : '?'}`);
    },
  );
  add(
    out,
    'hash/content-change',
    1,
    1,
    HASH,
    'spec.md "Spec": a content change under the same version label changes the content hash',
    'contentHash covers every field of the loaded spec.',
    async ({ seed }) => {
      const a = v(base(seed, { version: 'v1' }));
      const b = v(
        base(seed, { version: 'v1', blocks: [block(seed, 0, { expect: { must: [`R-${9000 + seed}`] } })] }),
      );
      return a.ok && b.ok && a.hash !== b.hash
        ? PASS
        : fail(`two specs that differ in a must pattern share the hash ${a.ok ? a.hash : '?'}`);
    },
  );
  add(
    out,
    'hash/yaml-json-equal',
    2,
    1,
    HASH,
    'spec.md: a spec is one YAML or JSON file; the same content gives the same content hash',
    'The content hash depends on the parsed content, not the file format.',
    async ({ seed }) => {
      const raw = base(seed, { tags: ['flow:plan', `t${seed}`] });
      const yaml = [
        `id: claim-spec-${seed}`,
        `tags: [ "flow:plan", "t${seed}" ]`,
        'blocks:',
        '  - id: b0',
        `    user: "Hello, I am customer${seed}@example.org."`,
        '    expect:',
        `      must: [ "R-${1000 + seed}" ]`,
        '',
      ].join('\n');
      const a = parseSpecText(yaml, 'yaml');
      const b = parseSpecText(JSON.stringify(raw), 'json');
      return a.ok && b.ok && a.hash === b.hash
        ? PASS
        : fail(`YAML ${a.ok ? a.hash : listIssues(a)} vs JSON ${b.ok ? b.hash : listIssues(b)}`);
    },
  );
  add(
    out,
    'hash/shorthand-equal',
    2,
    1,
    HASH,
    'spec.md "Shorthand": user: and when: { user } are the same spec, so they hash the same',
    'The loader hashes the normalised spec, after shorthand.',
    async ({ seed }) => {
      const a = v({ id: `s${seed}`, blocks: [{ user: `hi ${seed}`, expect: { must: ['x'] } }] });
      const b = v({
        id: `s${seed}`,
        kind: 'conversation',
        blocks: [{ when: { user: `hi ${seed}` }, expect: { must: ['x'] } }],
      });
      return a.ok && b.ok && a.hash === b.hash
        ? PASS
        : fail(`shorthand ${a.ok ? a.hash : '?'} vs long form ${b.ok ? b.hash : '?'}`);
    },
  );
  add(
    out,
    'hash/ledger-seed-equal',
    2,
    1,
    HASH,
    'spec.md "Shorthand": ledger_seed is the same as given.ledger, so both hash the same',
    'The loader hashes the spec after rewriting ledger_seed.',
    async ({ seed }) => {
      const ledger = { email: `customer${seed}@example.org` };
      const a = v(base(seed, { ledger_seed: ledger }));
      const b = v(base(seed, { given: { ledger } }));
      return a.ok && b.ok && a.hash === b.hash
        ? PASS
        : fail(`ledger_seed ${a.ok ? a.hash : '?'} vs given.ledger ${b.ok ? b.hash : '?'}`);
    },
  );
  add(
    out,
    'hash/array-order-matters',
    2,
    1,
    HASH,
    'running.md: the hash is over canonical JSON, where only object keys are sorted; block order is content',
    'contentHash keeps list order.',
    async ({ seed }) => {
      const a = v({ id: `s${seed}`, blocks: [block(seed, 0), block(seed, 1)] });
      const b = v({ id: `s${seed}`, blocks: [block(seed, 1), block(seed, 0)] });
      return a.ok && b.ok && a.hash !== b.hash
        ? PASS
        : fail('two specs with their blocks swapped share a hash');
    },
  );
}

function givenRules(out: BankItem[]): void {
  add(
    out,
    'given/hash-formula',
    2,
    5,
    GIVEN,
    'running.md "Given resolution and the hash": hash is the first 12 hex of SHA-256 of the canonical JSON of prefix, ledger, world, vars and target',
    'resolveGiven hashes exactly the five parts as canonical JSON.',
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(seed, [{ given: { ledger: { plan: `p${seed}` }, vars: { clock: '2026-01-01' } } }], {
          given: { ledger: { email: `c${seed}@example.org` }, world: { store: { a: seed } } },
        }),
      );
      for (const [index, given] of p.turns.entries()) {
        const want = sha12({
          prefix: given.prefix,
          ledger: given.ledger,
          world: given.world,
          vars: given.vars,
          target: given.target,
        });
        if (given.hash !== want)
          return fail(`block ${index}: hash ${given.hash}, the docs formula gives ${want}`);
      }
      return p.turns.length === 3 ? PASS : fail(`expected 3 sends, got ${p.turns.length}`);
    },
  );
  add(
    out,
    'given/record-keeps-hash',
    1,
    5,
    RUN,
    'running.md "Given resolution and the hash": the block record keeps the hash as givenHash',
    'The runner writes the resolved Given hash into each block record.',
    async ({ seed }) => {
      const { p, run } = await runProbe(threeBlocks(seed));
      const got = run.blocks.map((b) => b.givenHash);
      const want = p.turns.map((g) => g.hash);
      return sameJson('givenHash per block', got, want);
    },
  );
  add(
    out,
    'given/spec-ledger-at-start',
    1,
    5,
    GIVEN,
    'given-when-then.md "Given": the spec given is the default for every block',
    "The runner starts every block's ledger from the spec given.ledger.",
    async ({ seed }) => {
      const ledger = { email: `c${seed}@example.org`, tier: 'gold' };
      const { p } = await runProbe(threeBlocks(seed, [], { given: { ledger } }));
      for (const [index, given] of p.turns.entries()) {
        const r = sameJson(`block ${index} ledger`, given.ledger, ledger);
        if (!r.pass) return r;
      }
      return PASS;
    },
  );
  add(
    out,
    'given/block-ledger-onwards',
    1,
    5,
    GIVEN,
    'spec.md "Given": block ledger facts merge into the ledger from here on, not before',
    'The runner merges a block given.ledger from that block onwards only.',
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(seed, [{}, { given: { ledger: { phone: `+3200${seed}` } } }], {
          given: { ledger: { email: `c${seed}@example.org` } },
        }),
      );
      return expectAll([
        [
          canon(p.turns[0]?.ledger) === canon({ email: `c${seed}@example.org` }),
          `block 0 ledger ${show(p.turns[0]?.ledger)} should not hold phone`,
        ],
        [
          (p.turns[1]?.ledger as Raw | undefined)?.phone === `+3200${seed}`,
          `block 1 ledger ${show(p.turns[1]?.ledger)} lacks phone`,
        ],
        [
          (p.turns[2]?.ledger as Raw | undefined)?.phone === `+3200${seed}`,
          `block 2 ledger ${show(p.turns[2]?.ledger)} lost phone`,
        ],
      ]);
    },
  );
  add(
    out,
    'given/ledger-later-wins',
    1,
    5,
    GIVEN,
    'running.md "Given resolution and the hash": facts merge by name, the later value winning',
    'The runner lets a later block given.ledger value replace the earlier one.',
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(seed, [{}, {}, { given: { ledger: { email: `new${seed}@example.org` } } }], {
          given: { ledger: { email: `old${seed}@example.org`, name: 'Ada' } },
        }),
      );
      return sameJson('block 2 ledger', p.turns[2]?.ledger, { email: `new${seed}@example.org`, name: 'Ada' });
    },
  );
  add(
    out,
    'given/ledger-add-joins',
    1,
    5,
    GIVEN,
    'given-when-then.md "Given": ledger_add adds the facts a block establishes, and every later block sees them',
    "The runner adds a block's ledger_add to the ledger of the blocks after it.",
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(seed, [{ expect: { ledger_add: { plan: `fiber_${seed}` }, must: ['R-'] } }]),
      );
      return expectAll([
        [
          !('plan' in (p.turns[0]?.ledger ?? {})),
          `block 0 ledger ${show(p.turns[0]?.ledger)} already holds its own ledger_add`,
        ],
        [
          (p.turns[1]?.ledger as Raw | undefined)?.plan === `fiber_${seed}`,
          `block 1 ledger ${show(p.turns[1]?.ledger)} lacks plan`,
        ],
        [
          (p.turns[2]?.ledger as Raw | undefined)?.plan === `fiber_${seed}`,
          `block 2 ledger ${show(p.turns[2]?.ledger)} lacks plan`,
        ],
      ]);
    },
  );
  add(
    out,
    'given/tools-merge-by-name',
    1,
    5,
    GIVEN,
    'running.md "Given resolution and the hash": tools merge by name',
    'mergeWorld keeps earlier tool overrides and adds new ones by name.',
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(seed, [{}, { given: { world: { tools: { send: { error: 'timeout' } } } } }], {
          given: { world: { tools: { lookup: { result: { code: `R-${5000 + seed}` } } } } },
        }),
      );
      return sameJson('block 2 world.tools', p.turns[2]?.world.tools, {
        lookup: { result: { code: `R-${5000 + seed}` } },
        send: { error: 'timeout' },
      });
    },
  );
  add(
    out,
    'given/tools-later-wins',
    1,
    5,
    GIVEN,
    'spec.md "ToolOverride": a forced result or error from the block where it is set onwards; the later value wins',
    'mergeWorld lets a later override of the same tool replace the earlier one.',
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(seed, [{}, { given: { world: { tools: { lookup: { error: `down ${seed}` } } } } }], {
          given: { world: { tools: { lookup: { result: { ok: true } } } } },
        }),
      );
      return expectAll([
        [
          canon(p.turns[0]?.world.tools) === canon({ lookup: { result: { ok: true } } }),
          `block 0 tools ${show(p.turns[0]?.world.tools)}`,
        ],
        [
          canon(p.turns[1]?.world.tools) === canon({ lookup: { error: `down ${seed}` } }),
          `block 1 tools ${show(p.turns[1]?.world.tools)}, expected only the error`,
        ],
      ]);
    },
  );
  add(
    out,
    'given/store-merge',
    1,
    5,
    GIVEN,
    'running.md "Given resolution and the hash": store keys merge by name, the later value winning',
    'mergeWorld merges store keys by name.',
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(seed, [{}, { given: { world: { store: { balance: seed, plan: 'new' } } } }], {
          given: { world: { store: { account: `A-${seed}`, plan: 'old' } } },
        }),
      );
      return sameJson('block 1 world.store', p.turns[1]?.world.store, {
        account: `A-${seed}`,
        balance: seed,
        plan: 'new',
      });
    },
  );
  add(
    out,
    'given/fixtures-merge',
    1,
    5,
    GIVEN,
    'running.md "Given resolution and the hash": fixtures merge by name',
    'mergeWorld merges fixtures by name.',
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(seed, [{}, {}, { given: { world: { fixtures: { prices: [seed, 2] } } } }], {
          given: { world: { fixtures: { hours: '9-17' } } },
        }),
      );
      return sameJson('block 2 world.fixtures', p.turns[2]?.world.fixtures, {
        hours: '9-17',
        prices: [seed, 2],
      });
    },
  );
  add(
    out,
    'given/workspace-replaced-whole',
    2,
    5,
    GIVEN,
    'running.md "Given resolution and the hash": a later workspace replaces the earlier one whole',
    'mergeWorld replaces the workspace whole instead of merging its files.',
    async ({ seed }) => {
      const later = { files: { [`b${seed}.csv`]: 'b' } };
      const { p } = await runProbe(
        threeBlocks(seed, [{}, { given: { world: { workspace: later } } }], {
          workspace_seed: { files: { [`a${seed}.csv`]: 'a' } },
        }),
      );
      return sameJson('block 1 world.workspace', p.turns[1]?.world.workspace, later);
    },
  );
  add(
    out,
    'given/vars-merge',
    1,
    5,
    GIVEN,
    'running.md "Given resolution and the hash": variables merge by name, the later value winning',
    'The runner merges block given.vars by name onto the spec vars.',
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(seed, [{}, { given: { vars: { clock: `2026-0${seed}-02`, sender: 'ada' } } }], {
          given: { vars: { clock: `2026-0${seed}-01`, channel: 'chat' } },
        }),
      );
      return expectAll([
        [
          canon(p.turns[0]?.vars) === canon({ channel: 'chat', clock: `2026-0${seed}-01` }),
          `block 0 vars ${show(p.turns[0]?.vars)}`,
        ],
        [
          canon(p.turns[2]?.vars) === canon({ channel: 'chat', clock: `2026-0${seed}-02`, sender: 'ada' }),
          `block 2 vars ${show(p.turns[2]?.vars)}`,
        ],
      ]);
    },
  );
  add(
    out,
    'given/adapter-receives-world-vars',
    2,
    5,
    'packages/adapters/src/function/index.ts',
    'given-when-then.md "Given": an adapter with toolStubs receives the resolved world and vars of the block',
    'The function adapter passes the resolved world and vars of each block to the agent.',
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(seed, [
          {},
          { given: { world: { tools: { lookup: { error: 'timeout' } } }, vars: { n: seed } } },
        ]),
      );
      return expectAll([
        [
          canon(p.worlds[1]) === canon(p.turns[1]?.world),
          `agent world ${show(p.worlds[1])} vs resolved ${show(p.turns[1]?.world)}`,
        ],
        [canon(p.vars[2]) === canon({ n: seed }), `agent vars at block 2 ${show(p.vars[2])}`],
      ]);
    },
  );
  add(
    out,
    'given/f-history-is-prefix',
    1,
    5,
    RUN,
    'running.md "The history": the history before a block is the prefix of that block\'s Given, with the agent\'s own replies',
    'The runner resolves a free-running block prefix as the user messages and replies before it.',
    async ({ seed }) => {
      const raw = threeBlocks(seed);
      const { p } = await runProbe(raw);
      const blocks = raw.blocks as Raw[];
      return sameJson('block 2 prefix', p.turns[2]?.prefix, [
        { role: 'user', content: blocks[0]?.user },
        { role: 'assistant', content: replyText(0) },
        { role: 'user', content: blocks[1]?.user },
        { role: 'assistant', content: replyText(1) },
      ]);
    },
  );
  add(
    out,
    'given/burst-one-message-each',
    2,
    5,
    RUN,
    'running.md "The history": before a send the runner appends one user message per message of a burst',
    'The runner appends each burst message as its own user message.',
    async ({ seed }) => {
      const burst = [`first ${seed}`, `second ${seed}`];
      const raw = threeBlocks(seed, [{ user: undefined, burst }]);
      delete (raw.blocks as Raw[])[0]?.user;
      const { p } = await runProbe(raw);
      return sameJson('block 1 prefix', p.turns[1]?.prefix, [
        { role: 'user', content: burst[0] },
        { role: 'user', content: burst[1] },
        { role: 'assistant', content: replyText(0) },
      ]);
    },
  );
  add(
    out,
    'given/prefix-opens-session',
    1,
    5,
    RUN,
    'given-when-then.md "Given": in a free-running run, a block with prefix opens a new session from that prefix',
    'The runner closes the open session and opens a new one at a block with given.prefix.',
    async ({ seed }) => {
      const prefix = [
        { role: 'user', content: `Earlier question ${seed}` },
        { role: 'assistant', content: 'Earlier answer' },
      ];
      const { p } = await runProbe(threeBlocks(seed, [{}, { given: { prefix } }]));
      return expectAll([
        [p.opens.length === 2, `expected 2 sessions (start, then the prefix block), got ${p.opens.length}`],
        [
          canon(p.opens[1]?.prefix) === canon(prefix),
          `the second session opened with prefix ${show(p.opens[1]?.prefix)}`,
        ],
      ]);
    },
  );
  add(
    out,
    'given/prefix-is-resolved-prefix',
    1,
    5,
    RUN,
    'given-when-then.md "Given": a block\'s prefix starts the block mid-conversation without replaying the blocks before',
    'The runner sets the resolved prefix of a prefix block to that prefix exactly, dropping the earlier history.',
    async ({ seed }) => {
      const prefix = [
        { role: 'user', content: `I want plan ${seed}` },
        {
          role: 'assistant',
          content: 'Which one?',
          tool_calls: [{ label: 'lookup', input: { q: seed }, output: { n: 2 } }],
        },
      ];
      const { p } = await runProbe(threeBlocks(seed, [{}, { given: { prefix } }]));
      return sameJson('block 1 resolved prefix', p.turns[1]?.prefix, prefix);
    },
  );
  add(
    out,
    'given/after-prefix-continues',
    2,
    5,
    RUN,
    'given-when-then.md "Given": the blocks after a prefix block continue from there',
    'The runner keeps the session a prefix opened for the blocks after it.',
    async ({ seed }) => {
      const prefix = [{ role: 'user', content: `Earlier ${seed}` }];
      const raw = threeBlocks(seed, [{}, { given: { prefix } }]);
      const { p } = await runProbe(raw);
      const blocks = raw.blocks as Raw[];
      return expectAll([
        [p.opens.length === 2, `expected 2 sessions, got ${p.opens.length}`],
        [
          canon(p.turns[2]?.prefix) ===
            canon([
              ...prefix,
              { role: 'user', content: blocks[1]?.user },
              { role: 'assistant', content: replyText(1) },
            ]),
          `block 2 prefix ${show(p.turns[2]?.prefix)}`,
        ],
      ]);
    },
  );
  add(
    out,
    'given/prefix-seen-by-agent',
    2,
    5,
    'packages/adapters/src/function/index.ts',
    'adapters/index.md: with seedPrefix the agent itself sees the prefix, then the block user message',
    'The function adapter hands the agent the prefix followed by the block message.',
    async ({ seed }) => {
      const prefix = [{ role: 'system', content: `Be brief ${seed}` }];
      const raw = threeBlocks(seed, [{ given: { prefix } }]);
      const { p } = await runProbe(raw);
      return sameJson('agent messages on block 0', p.histories[0], [
        ...prefix,
        { role: 'user', content: (raw.blocks as Raw[])[0]?.user },
      ]);
    },
  );
  add(
    out,
    'given/target-default',
    1,
    5,
    RUN,
    'running.md "Given resolution and the hash": the resolved Given holds the target; without one it is the adapter',
    'The runner puts { adapter: <adapter id> } in the resolved Given when no target is set.',
    async ({ seed }) => {
      const { p } = await runProbe(threeBlocks(seed));
      return sameJson('resolved target', p.turns[0]?.target, { adapter: 'function' });
    },
  );
  add(
    out,
    'given/target-spec',
    1,
    5,
    RUN,
    'spec.md "Spec": target is the default agent, and the resolved Given carries it',
    'The runner puts the spec target in the resolved Given.',
    async ({ seed }) => {
      const target = { adapter: 'function', agent: `agent-${seed}`, variant: 'v2' };
      const { p } = await runProbe(threeBlocks(seed, [], { target }));
      return sameJson('resolved target', p.turns[1]?.target, target);
    },
  );
  add(
    out,
    'given/target-run-override',
    2,
    5,
    RUN,
    'spec.md "Spec": a run can override the spec target, and the hash follows the target',
    'The runner resolves the run target over the spec target and hashes it.',
    async ({ seed }) => {
      const spec = { adapter: 'function', agent: `agent-${seed}` };
      const override = { adapter: 'function', agent: `other-${seed}` };
      const a = await runProbe(threeBlocks(seed, [], { target: spec }));
      const b = await runProbe(threeBlocks(seed, [], { target: spec }), 'F', override);
      return expectAll([
        [
          canon(b.p.turns[0]?.target) === canon(override),
          `resolved target ${show(b.p.turns[0]?.target)}, expected the override`,
        ],
        [
          a.run.blocks[0]?.givenHash !== b.run.blocks[0]?.givenHash,
          'the givenHash did not change with the target',
        ],
      ]);
    },
  );
  add(
    out,
    'given/hash-stable-and-sensitive',
    1,
    5,
    GIVEN,
    'running.md "Given resolution and the hash": equal Givens hash equal, a changed variable changes the hash',
    'resolveGiven hashes content only, so equal content gives an equal hash.',
    async ({ seed }) => {
      const a = await runProbe(threeBlocks(seed, [], { given: { vars: { clock: 't1' } } }));
      const b = await runProbe(threeBlocks(seed, [], { given: { vars: { clock: 't1' } } }));
      const c = await runProbe(threeBlocks(seed, [], { given: { vars: { clock: 't2' } } }));
      return expectAll([
        [a.run.blocks[0]?.givenHash === b.run.blocks[0]?.givenHash, 'two runs of one Given hash apart'],
        [a.run.blocks[0]?.givenHash !== c.run.blocks[0]?.givenHash, 'a changed var keeps the hash'],
      ]);
    },
  );
  add(
    out,
    't/one-session-per-block',
    1,
    5,
    RUN,
    'run-modes.md "Teacher-forced": each block opens its own session from its canonical Given',
    'The runner opens a new session for every block in mode T on an adapter without a sandbox.',
    async ({ seed }) => {
      const { p } = await runProbe(threeBlocks(seed), 'T');
      return p.opens.length === 3
        ? PASS
        : fail(`mode T on 3 blocks opened ${p.opens.length} sessions, expected 3`);
    },
  );
  add(
    out,
    't/canonical-reply-tools',
    2,
    5,
    GIVEN,
    'run-modes.md "Teacher-forced": the canonical assistant message has empty text and the expected calls with exact inputs only',
    'canonicalGiven writes an empty assistant message carrying expected calls with exact input fields.',
    async ({ seed }) => {
      const email = `c${seed}@example.org`;
      const raw = threeBlocks(seed, [
        {
          expect: {
            must: ['R-'],
            tools: [
              { label: 'lookup', count: 1, input: { email, step: { exact: seed }, note: { contains: 'x' } } },
            ],
          },
        },
      ]);
      const { p } = await runProbe(raw, 'T');
      return sameJson('block 1 canonical prefix', p.turns[1]?.prefix, [
        { role: 'user', content: (raw.blocks as Raw[])[0]?.user },
        { role: 'assistant', content: '', tool_calls: [{ label: 'lookup', input: { email, step: seed } }] },
      ]);
    },
  );
  add(
    out,
    't/canonical-count',
    2,
    5,
    GIVEN,
    'run-modes.md "Teacher-forced": each expected call as many times as its count asks, its min for a range, once with no count',
    'canonicalGiven repeats each expected call by count, range min, or once.',
    async ({ seed }) => {
      const raw = threeBlocks(seed, [
        {
          expect: {
            must: ['R-'],
            tools: [
              { label: 'a', count: 2 },
              { label: 'b', count: { min: 1 + (seed % 2), max: 5 } },
              { label: 'c' },
            ],
          },
        },
      ]);
      const { p } = await runProbe(raw, 'T');
      const calls = (p.turns[1]?.prefix[1]?.tool_calls ?? []).map((call) => call.label);
      const want = ['a', 'a', ...Array(1 + (seed % 2)).fill('b'), 'c'];
      return sameJson('canonical tool calls of block 0', calls, want);
    },
  );
  add(
    out,
    't/canonical-forced-result',
    3,
    5,
    GIVEN,
    'run-modes.md "Teacher-forced": the canonical call carries the result or error the spec\'s world forces at that block',
    'canonicalGiven attaches the forced world.tools result or error to the canonical call.',
    async ({ seed }) => {
      const raw = threeBlocks(
        seed,
        [
          {
            expect: {
              must: ['R-'],
              tools: [
                { label: 'lookup', count: 1 },
                { label: 'send', count: 1 },
              ],
            },
          },
        ],
        {
          given: {
            world: {
              tools: { lookup: { result: { code: `R-${6000 + seed}` } }, send: { error: 'timeout' } },
            },
          },
        },
      );
      const { p } = await runProbe(raw, 'T');
      return sameJson('canonical calls of block 0', p.turns[1]?.prefix[1]?.tool_calls, [
        { label: 'lookup', input: {}, output: { code: `R-${6000 + seed}` } },
        { label: 'send', input: {}, error: 'timeout' },
      ]);
    },
  );
  add(
    out,
    't/canonical-ledger',
    1,
    5,
    GIVEN,
    'run-modes.md "Teacher-forced": the ledger also holds the ledger_add facts of every earlier block',
    'canonicalGiven adds earlier ledger_add facts to the canonical ledger.',
    async ({ seed }) => {
      const { p } = await runProbe(
        threeBlocks(
          seed,
          [
            { expect: { must: ['R-'], ledger_add: { plan: `p${seed}` } } },
            { given: { ledger: { n: seed } } },
          ],
          {
            given: { ledger: { email: `c${seed}@example.org` } },
          },
        ),
        'T',
      );
      return sameJson('block 2 canonical ledger', p.turns[2]?.ledger, {
        email: `c${seed}@example.org`,
        n: seed,
        plan: `p${seed}`,
      });
    },
  );
  add(
    out,
    't/canonical-prefix-from-latest',
    2,
    5,
    GIVEN,
    'run-modes.md "Teacher-forced": the prefix starts from the latest given.prefix a block up to k writes',
    'canonicalGiven starts the canonical prefix at the latest written prefix.',
    async ({ seed }) => {
      const prefix = [{ role: 'user', content: `Restart ${seed}` }];
      const raw = threeBlocks(seed, [{}, { given: { prefix } }]);
      const { p } = await runProbe(raw, 'T');
      return sameJson('block 2 canonical prefix', p.turns[2]?.prefix, [
        ...prefix,
        { role: 'user', content: (raw.blocks as Raw[])[1]?.user },
        { role: 'assistant', content: '' },
      ]);
    },
  );
  add(
    out,
    't/agent-replies-not-in-prefix',
    1,
    5,
    RUN,
    'running.md "The history": in mode T the history is the canonical prefix, never the agent\'s own replies',
    "The runner never puts the agent's replies into a mode T prefix.",
    async ({ seed }) => {
      const { p } = await runProbe(threeBlocks(seed), 'T');
      const leaked = p.turns
        .flatMap((g) => g.prefix)
        .filter((m) => m.role === 'assistant' && m.content !== '');
      return leaked.length === 0 ? PASS : fail(`mode T prefixes hold agent replies: ${show(leaked)}`);
    },
  );
}

function moreRules(out: BankItem[]): void {
  add(
    out,
    'issue/retention-perturbation-before-block-given',
    3,
    1,
    SEMANTICS,
    'cli.md "Issue codes": RETENTION_FACT_UNKNOWN when no ledger holds the fact before the block; a perturbation inserted before block k runs before block k sets its given.ledger',
    "The loader checks a perturbation's knowledge_retention against the facts known before block inject_at, without that block's own given.ledger.",
    async ({ seed }) =>
      expectError(
        v({
          id: `s${seed}`,
          blocks: [block(seed, 0), block(seed, 1, { given: { ledger: { phone: `+3200${seed}` } } })],
          perturbations: [
            {
              id: 'p0',
              class: 'D10_return',
              inject_at: 1,
              user: 'ok, let us continue',
              expect: { knowledge_retention: [{ fact: 'phone' }] },
              recovery: { within_blocks: 1 },
            },
          ],
        }),
        'RETENTION_FACT_UNKNOWN',
        'perturbations.0.expect.knowledge_retention.0.fact',
      ),
    'adversarial',
  );
  add(
    out,
    'schema/tool-latency-nonnegative',
    1,
    1,
    SCHEMA,
    'spec.md "ToolOverride": latency_ms is a number of at least 0',
    'The ToolOverride schema refuses a negative latency_ms.',
    async ({ seed }) =>
      expectSchemaError(
        v(base(seed, { given: { world: { tools: { lookup: { latency_ms: -seed } } } } })),
        'given.world.tools.lookup.latency_ms',
      ),
  );
  add(
    out,
    'schema/prefix-call-label',
    1,
    1,
    SCHEMA,
    'spec.md "PrefixToolCall": label is required and not empty',
    'The PrefixToolCall schema requires a non-empty label.',
    async ({ seed }) =>
      expectSchemaError(
        v(
          base(seed, {
            blocks: [
              block(seed, 0, {
                given: {
                  prefix: [
                    { role: 'assistant', content: '', tool_calls: [{ label: '', input: { n: seed } }] },
                  ],
                },
              }),
            ],
          }),
        ),
        'blocks.0.given.prefix.0.tool_calls.0.label',
      ),
  );
  add(
    out,
    'schema/nonempty-true-only',
    2,
    1,
    SCHEMA,
    'spec.md "Assertion": nonempty takes the value true only',
    'The Assertion schema refuses nonempty: false.',
    async ({ seed }) =>
      expectAll([
        [
          !v(
            base(seed, {
              blocks: [
                block(seed, 0, { expect: { tools: [{ label: 'a', input: { x: { nonempty: false } } }] } }),
              ],
            }),
          ).ok,
          'nonempty: false was accepted',
        ],
        [
          v(
            base(seed, {
              blocks: [
                block(seed, 0, { expect: { tools: [{ label: 'a', input: { x: { nonempty: true } } }] } }),
              ],
            }),
          ).ok,
          'nonempty: true was refused',
        ],
      ]),
  );
  add(
    out,
    'schema/one-of-min-one',
    2,
    1,
    SCHEMA,
    'spec.md "Assertion": one_of is a list of at least 1 item',
    'The Assertion schema refuses an empty one_of.',
    async ({ seed }) =>
      expectAll([
        [
          !v(
            base(seed, {
              blocks: [block(seed, 0, { expect: { tools: [{ label: 'a', input: { x: { one_of: [] } } }] } })],
            }),
          ).ok,
          'one_of: [] was accepted',
        ],
        [
          v(
            base(seed, {
              blocks: [
                block(seed, 0, {
                  expect: { tools: [{ label: 'a', input: { x: { one_of: [seed, 'b'] } } }] },
                }),
              ],
            }),
          ).ok,
          `one_of: [${seed}, 'b'] was refused`,
        ],
      ]),
  );
  const GLOB = 'packages/core/src/spec/glob.ts';
  add(
    out,
    'glob/star-within-folder',
    1,
    1,
    GLOB,
    'spec.md "ReferenceExpect": * matches within a folder',
    'globMatches keeps * inside one folder.',
    async ({ seed }) =>
      expectAll([
        [globMatches('docs/*.md', `docs/n${seed}.md`), `docs/*.md should match docs/n${seed}.md`],
        [
          !globMatches('docs/*.md', `docs/sub/n${seed}.md`),
          `docs/*.md should not match docs/sub/n${seed}.md`,
        ],
      ]),
  );
  add(
    out,
    'glob/double-star-across',
    1,
    1,
    GLOB,
    'spec.md "ReferenceExpect": ** matches across folders',
    'globMatches lets ** cross folders.',
    async ({ seed }) =>
      expectAll([
        [globMatches('docs/**/*.md', `docs/a/b${seed}/c.md`), 'docs/**/*.md should match docs/a/b/c.md'],
        [globMatches('docs/**', `docs/a/b${seed}/c.md`), 'docs/** should match a nested file'],
        [!globMatches('docs/**/*.md', `src/a${seed}.md`), 'docs/**/*.md should not match src/a.md'],
      ]),
  );
  add(
    out,
    'glob/question-one-char',
    1,
    1,
    GLOB,
    'spec.md "ReferenceExpect": ? matches one character',
    'globMatches reads ? as exactly one character.',
    async ({ seed }) =>
      expectAll([
        [globMatches('r?.txt', `r${seed % 10}.txt`), `r?.txt should match r${seed % 10}.txt`],
        [
          !globMatches('r?.txt', `r${seed % 10}${seed % 10}.txt`),
          `r?.txt should not match r${seed % 10}${seed % 10}.txt`,
        ],
        [!globMatches('r?.txt', 'r.txt'), 'r?.txt should not match r.txt'],
      ]),
  );
  add(
    out,
    'glob/literal-path',
    1,
    1,
    GLOB,
    'spec.md "ReferenceExpect": a path without a wildcard is the path read, so it matches only itself',
    'globMatches escapes regex characters in literal paths.',
    async ({ seed }) =>
      expectAll([
        [
          globMatches(`data/a+b(${seed}).csv`, `data/a+b(${seed}).csv`),
          'a literal path with + and () should match itself',
        ],
        [!globMatches(`data/a.${seed}.csv`, `data/aX${seed}.csv`), 'a dot should match only a dot'],
        [!globMatches('data/a.csv', 'data/a.csv.bak'), 'a literal path should not match a longer one'],
      ]),
    'adversarial',
  );
  add(
    out,
    'paths/folder-walk',
    1,
    1,
    LOAD,
    'cli.md "Paths": a folder is searched recursively for *.yaml, *.yml and *.spec.json, in sorted order',
    'findSpecFiles walks folders recursively, keeps the three spec extensions and sorts them.',
    async ({ scratch, seed }) => {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const dir = join(scratch, `walk-${seed}`);
      for (const sub of ['b', 'a/deep']) mkdirSync(join(dir, sub), { recursive: true });
      for (const file of [
        'b/z.yaml',
        'a/deep/y.yml',
        'a/x.spec.json',
        'a/plain.json',
        'a/notes.md',
        'c.YAML',
      ])
        writeFileSync(join(dir, file), 'id: x\n');
      const got = (await findSpecFiles([dir])).map((path) => path.slice(dir.length + 1));
      return sameJson('spec files found', got, ['a/deep/y.yml', 'a/x.spec.json', 'b/z.yaml', 'c.YAML']);
    },
  );
  add(
    out,
    'paths/skips',
    1,
    1,
    LOAD,
    'cli.md "Paths": entries whose name starts with a dot, node_modules and dist are skipped',
    'findSpecFiles skips dot entries, node_modules and dist.',
    async ({ scratch, seed }) => {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const dir = join(scratch, `skip-${seed}`);
      for (const sub of ['.hidden', 'node_modules/p', 'dist', 'ok'])
        mkdirSync(join(dir, sub), { recursive: true });
      for (const file of ['.hidden/a.yaml', 'node_modules/p/b.yaml', 'dist/c.yaml', '.d.yaml', 'ok/e.yaml'])
        writeFileSync(join(dir, file), 'id: x\n');
      const got = (await findSpecFiles([dir])).map((path) => path.slice(dir.length + 1));
      return sameJson('spec files found', got, ['ok/e.yaml']);
    },
  );
  add(
    out,
    'paths/other-extension-is-yaml',
    2,
    1,
    LOAD,
    'cli.md "Paths": every file not ending in .json is read as YAML',
    'loadSpecFile reads any non-.json file as YAML.',
    async ({ scratch, seed }) => {
      const { writeFileSync } = await import('node:fs');
      const path = join(scratch, `spec-${seed}.txt`);
      writeFileSync(path, `id: txt-${seed}\nblocks:\n  - user: hi\n    expect: { must: [x] }\n`);
      return expectValid(await loadSpecFile(path), (spec) =>
        spec.id === `txt-${seed}` ? PASS : fail(`id: expected txt-${seed}, got ${spec.id}`),
      );
    },
  );
  add(
    out,
    'given/prefix-on-first-block',
    2,
    5,
    RUN,
    'running.md "Given resolution and the hash": a prefix on block 0 ends no session, so one session runs the conversation',
    'The runner opens exactly one session when only block 0 writes a prefix.',
    async ({ seed }) => {
      const prefix = [{ role: 'user', content: `Earlier ${seed}` }];
      const { p } = await runProbe(threeBlocks(seed, [{ given: { prefix } }]));
      return p.opens.length === 1 ? PASS : fail(`expected 1 session, got ${p.opens.length}`);
    },
  );
  add(
    out,
    't/sandbox-keeps-session',
    3,
    5,
    RUN,
    'run-modes.md "Teacher-forced": on an adapter with a sandbox, a block keeps the session of the block before and only its history is replaced',
    'The runner reseats the open session in mode T when the adapter has a sandbox and the block writes no workspace.',
    async ({ seed }) => {
      const raw = threeBlocks(seed, [], {
        kind: 'task',
        workspace_seed: { files: { [`a${seed}.csv`]: 'a' } },
      });
      const { p } = await runProbe(raw, 'T', undefined, { sandbox: true });
      const blocks = raw.blocks as Raw[];
      return expectAll([
        [p.opens.length === 1, `expected 1 session across 3 sandbox blocks, got ${p.opens.length}`],
        [
          canon(p.histories[2]) ===
            canon([
              { role: 'user', content: blocks[0]?.user },
              { role: 'assistant', content: '' },
              { role: 'user', content: blocks[1]?.user },
              { role: 'assistant', content: '' },
              { role: 'user', content: blocks[2]?.user },
            ]),
          `block 2 history ${show(p.histories[2])}, expected the canonical prefix then the block message`,
        ],
      ]);
    },
  );
  add(
    out,
    't/sandbox-own-workspace-new-session',
    3,
    5,
    RUN,
    'running.md "Given resolution and the hash": in mode T a sandbox block that writes its own given.world.workspace opens a new session',
    'The runner opens a new session in mode T for a block that writes its own workspace.',
    async ({ seed }) => {
      const raw = threeBlocks(
        seed,
        [{}, { given: { world: { workspace: { from: `fixtures/after-${seed}` } } } }],
        {
          kind: 'task',
        },
      );
      const { p } = await runProbe(raw, 'T', undefined, { sandbox: true });
      return p.opens.length === 2
        ? PASS
        : fail(`expected 2 sessions (start, then the workspace block), got ${p.opens.length}`);
    },
  );
  add(
    out,
    'p/perturbation-world-merges',
    2,
    5,
    GIVEN,
    'running.md "Given resolution and the hash": the world of an injected perturbation merges the same way, from that point on',
    "The runner merges a perturbation's world into the running Given for the injected block and the blocks after it.",
    async ({ seed }) => {
      const raw = threeBlocks(seed, [], {
        given: { world: { tools: { lookup: { result: { ok: true } } } } },
        perturbations: [
          {
            id: `p${seed}`,
            class: 'D8_tool_failure',
            inject_at: 1,
            user: `Is it done ${seed}?`,
            world: { tools: { send: { error: 'timeout' } } },
            recovery: { within_blocks: 1 },
          },
        ],
      });
      const { p } = await runProbe(raw, 'P', undefined, { perturbationId: `p${seed}` });
      const want = { lookup: { result: { ok: true } }, send: { error: 'timeout' } };
      return expectAll([
        [p.turns.length === 4, `expected 4 sends (3 blocks and the injection), got ${p.turns.length}`],
        [
          canon(p.turns[0]?.world.tools) === canon({ lookup: { result: { ok: true } } }),
          `block 0 tools ${show(p.turns[0]?.world.tools)}`,
        ],
        [
          canon(p.turns[1]?.world.tools) === canon(want),
          `injected block tools ${show(p.turns[1]?.world.tools)}`,
        ],
        [canon(p.turns[3]?.world.tools) === canon(want), `last block tools ${show(p.turns[3]?.world.tools)}`],
      ]);
    },
  );
}

export function specItems(): BankItem[] {
  const out: BankItem[] = [];
  shorthand(out);
  issueCodes(out);
  schemaRules(out);
  lintRules(out);
  hashRules(out);
  givenRules(out);
  moreRules(out);
  return out;
}
