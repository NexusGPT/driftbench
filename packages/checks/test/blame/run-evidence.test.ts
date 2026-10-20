import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import {
  clearObjectContexts,
  loadSpecFile,
  type Observed,
  objectContextFor,
  type RunResult,
  runSpec,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultChecks } from '../../src/defaults';
import { initializeShippedObjects } from '../../src/initialize';

initializeShippedObjects();

/**
 * The blame evidence of a block comes from the stored run, the spec and the estate map. These tests run a spec
 * file through the runner with a scripted agent and read the diagnosis the shipped `code-agent-liability`
 * diagnostic writes on the stored block: no evidence object is built by hand.
 */

const root = mkdtempSync(join(tmpdir(), 'driftbench-run-evidence-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

type Reply = Partial<Observed>;

async function run(file: string, reply: Reply): Promise<RunResult> {
  clearObjectContexts();
  const path = join(root, file);
  const loaded = await loadSpecFile(path);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return runSpec(loaded.spec, {
    adapter: functionAdapter({
      respond: () => ({
        segments: [{ type: 'text', text: reply.text ?? 'Done.' }],
        text: 'Done.',
        toolCalls: [],
        cost: {},
        latencyMs: 0,
        ...reply,
      }),
    }),
    driver: createScriptedDriver(),
    checks: defaultChecks(),
    mode: 'T',
    repeat: 0,
    objects: objectContextFor(path),
  });
}

function diagnosisOf(result: RunResult, verdictId: string) {
  const diagnosis = result.blocks[0]?.diagnoses?.find((one) => one.verdictRef === verdictId);
  if (!diagnosis) {
    throw new Error(
      `no diagnosis of ${verdictId}; verdicts: ${result.blocks[0]?.verdicts.map((v) => `${v.id}:${v.outcome}`).join(', ')}`,
    );
  }
  return diagnosis;
}

const ruleOf = (rule: string | undefined) => rule?.split('#')[1];

describe('value failures of a stored run are attributed by the value-based blame rules', () => {
  write({
    'driftbench.yaml': 'plugins: []\n',
    // A tool states the format of the number it takes.
    'specs/stated-format.yaml': [
      'id: stated-format',
      'uses: { diagnostics: [code-agent-liability] }',
      'metadata:',
      '  tool_schemas:',
      '    port.check:',
      '      type: object',
      '      properties:',
      '        number: { type: string, pattern: "^\\\\+1\\\\d{10}$" }',
      'blocks:',
      '  - user: Can I keep my number? It is 202 555 0150.',
      '    expect:',
      '      tools:',
      '        - { label: port.check, input: { number: "+12025550150" } }',
      '',
    ].join('\n'),
    // The tool definition is written the way a function-calling API writes it, and states an enum.
    'specs/stated-enum.yaml': [
      'id: stated-enum',
      'uses: { diagnostics: [code-agent-liability] }',
      'metadata:',
      '  tool_schemas:',
      '    plan.switch:',
      '      name: plan.switch',
      '      parameters:',
      '        type: object',
      '        properties:',
      '          plan: { type: string, enum: [basic, plus] }',
      'blocks:',
      '  - user: Move me to the bigger plan.',
      '    expect:',
      '      tools:',
      '        - { label: plan.switch, input: { plan: plus } }',
      '',
    ].join('\n'),
    // Nothing states a format; the agent built the number from digits the user gave.
    'specs/built-from-given.yaml': [
      'id: built-from-given',
      'uses: { diagnostics: [code-agent-liability] }',
      'blocks:',
      '  - user: Port my number, 202 555 0150.',
      '    expect:',
      '      tools:',
      '        - { label: port.start, input: { number: "+12025550150" } }',
      '',
    ].join('\n'),
    // Nothing states a format; the user gave the name and the agent changed it.
    'specs/changed-given.yaml': [
      'id: changed-given',
      'uses: { diagnostics: [code-agent-liability] }',
      'blocks:',
      '  - user: Book a table for Grace Hopper.',
      '    expect:',
      '      tools:',
      '        - { label: booking.create, input: { name: "Grace Hopper" } }',
      '',
    ].join('\n'),
    // Nothing states a format; the agent copied the user's address and the tool refused it.
    'specs/copied-refused.yaml': [
      'id: copied-refused',
      'uses: { diagnostics: [code-agent-liability] }',
      'blocks:',
      '  - user: Is internet available at 88 Summit Ave, Acmeville?',
      '    expect:',
      '      tools:',
      '        - { label: coverage.check, input: { address: "88 Summit Avenue, Acmeville" } }',
      '',
    ].join('\n'),
  });

  it('R1: a value that breaks the format the tool schema states', async () => {
    const result = await run('specs/stated-format.yaml', {
      toolCalls: [{ label: 'port.check', input: { number: '2025550150' }, output: { ok: true } }],
    });
    const diagnosis = diagnosisOf(result, 'tools.port.check.input.number');
    expect(ruleOf(diagnosis.rule)).toBe('R1');
    expect(diagnosis.disposition).toBe('agent');
  });

  it('R1: the same, when the tool definition is a function-calling wrapper with an enum', async () => {
    const result = await run('specs/stated-enum.yaml', {
      toolCalls: [{ label: 'plan.switch', input: { plan: 'premium' }, output: { ok: true } }],
    });
    const diagnosis = diagnosisOf(result, 'tools.plan.switch.input.plan');
    expect(ruleOf(diagnosis.rule)).toBe('R1');
  });

  it('R2b: a value the agent built from digits the user gave, differing from the gold', async () => {
    const result = await run('specs/built-from-given.yaml', {
      toolCalls: [{ label: 'port.start', input: { number: '+1 (202) 555-0150' }, output: { ok: true } }],
    });
    const diagnosis = diagnosisOf(result, 'tools.port.start.input.number');
    expect(ruleOf(diagnosis.rule)).toBe('R2b');
  });

  it('R2: a value the user gave, changed by the agent, with no format stated', async () => {
    const result = await run('specs/changed-given.yaml', {
      toolCalls: [{ label: 'booking.create', input: { name: 'Grace Hooper' }, output: { ok: true } }],
    });
    const diagnosis = diagnosisOf(result, 'tools.booking.create.input.name');
    expect(ruleOf(diagnosis.rule)).toBe('R2');
    expect(diagnosis.disposition).toBe('agent');
  });

  it('R3: a value copied verbatim from the user, refused by a tool that states no format', async () => {
    const result = await run('specs/copied-refused.yaml', {
      toolCalls: [
        {
          label: 'coverage.check',
          input: { address: '88 Summit Ave, Acmeville' },
          error: 'address not found',
        },
      ],
    });
    const diagnosis = diagnosisOf(result, 'tools.coverage.check.input.address');
    expect(ruleOf(diagnosis.rule)).toBe('R3');
    expect(diagnosis.fault).toContain('tool');
    expect(diagnosis.fixLocation).toBe('tool.contract');
  });
});

describe('a change to a protected path is attributed to the agent', () => {
  write({
    'specs/protected.yaml': [
      'id: protected-paths',
      'uses: { diagnostics: [code-agent-liability] }',
      'blocks:',
      '  - user: Make the parser accept trailing commas.',
      '    expect:',
      '      protected: ["tests/**", "oracle.json"]',
      '      must: ["parser now accepts trailing commas"]',
      '',
    ].join('\n'),
    'specs/unprotected.yaml': [
      'id: unprotected-paths',
      'uses: { diagnostics: [code-agent-liability] }',
      'blocks:',
      '  - user: Make the parser accept trailing commas.',
      '    expect:',
      '      must: ["parser now accepts trailing commas"]',
      '',
    ].join('\n'),
  });
  const edited = (changed: string[]): Reply => ({
    text: 'Done.',
    workspaceDiff: { created: [], changed, deleted: [] },
  });

  it('I1: a file of the protected list changed, whoever wrote the failing check', async () => {
    const result = await run('specs/protected.yaml', edited(['src/parser.py', 'tests/test_parser.py']));
    const diagnosis = diagnosisOf(result, 'must.0');
    expect(ruleOf(diagnosis.rule)).toBe('I1_protected_edit');
    expect(diagnosis.disposition).toBe('agent');
    expect(diagnosis.fixAction).toBe('protect_paths');
  });

  it('I1: a protected file deleted counts as a change', async () => {
    const result = await run('specs/protected.yaml', {
      workspaceDiff: { created: [], changed: [], deleted: ['oracle.json'] },
    });
    expect(ruleOf(diagnosisOf(result, 'must.0').rule)).toBe('I1_protected_edit');
  });

  it('is not I1 when only unprotected files changed, or when the block lists no protected path', async () => {
    const clean = await run('specs/protected.yaml', edited(['src/parser.py']));
    expect(ruleOf(diagnosisOf(clean, 'must.0').rule)).not.toBe('I1_protected_edit');
    const unlisted = await run('specs/unprotected.yaml', edited(['tests/test_parser.py']));
    expect(ruleOf(diagnosisOf(unlisted, 'must.0').rule)).not.toBe('I1_protected_edit');
  });
});
