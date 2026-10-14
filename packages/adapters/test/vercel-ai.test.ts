import { collectRetries, type Message, type Session } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { ToolLabels } from '../src/anthropic/common';
import { type GenerateTextLike, toModelMessages, vercelAiAdapter } from '../src/vercel-ai/index';
import { acmeGiven, adapterContract, COVERAGE_QUESTION, expectWholeObserved, sendUser } from './contract';
import recorded from './fixtures/frameworks/recorded/vercel-ai-steps.json';
import { acmeModel, acmeVercelTools, fakeGenerateText } from './fixtures/frameworks/vercel-ai';
import { ACME_SIDE_EFFECTS, ACME_TOOL_NAMES } from './fixtures/sdk/acme-model';

adapterContract(
  'vercel-ai',
  () =>
    vercelAiAdapter({
      generateText: fakeGenerateText(),
      model: acmeModel(),
      tools: () => acmeVercelTools(),
      toolLabels: ACME_TOOL_NAMES,
      sideEffects: ACME_SIDE_EFFECTS,
      deterministic: true,
    }),
  {
    brokenTransport: () =>
      vercelAiAdapter({
        generateText: fakeGenerateText(),
        model: {
          modelId: 'dead',
          doGenerate: async () => {
            throw Object.assign(new Error('Cannot connect to API'), {
              name: 'AI_APICallError',
              cause: { code: 'ECONNREFUSED' },
            });
          },
        },
        sleep: async () => {},
      }),
    released: (session: Session) => (session.state as { closed?: boolean }).closed === true,
  },
);

const given = acmeGiven({ adapter: 'vercel-ai' });
const labels = new ToolLabels(ACME_TOOL_NAMES);

describe('vercel-ai adapter', () => {
  it('validates and freezes messages before the tools factory receives the Given', async () => {
    let called = 0;
    const adapter = vercelAiAdapter({
      generateText: fakeGenerateText(),
      model: acmeModel(),
      tools: (start) => {
        called++;
        const message = start.prefix[0];
        if (!message) throw new Error('missing prefix');
        expect(() => {
          message.content = 'setup-mutated';
        }).toThrow(TypeError);
        return {};
      },
    });
    const session = await adapter.open({ ...given, prefix: [{ role: 'user', content: 'before' }] });
    expect(session.history[0]?.content).toBe('before');
    await adapter.close(session);
    await expect(
      adapter.open({
        ...given,
        prefix: [
          {
            role: 'user',
            get content() {
              return 'before';
            },
          },
        ],
      }),
    ).rejects.toThrow(/content.*accessor/);
    expect(called).toBe(1);
  });

  it('reads recorded steps of the real SDK: text, a tool result, a tool error, and the usage of each step', async () => {
    const generateText: GenerateTextLike = async () => ({ steps: structuredClone(recorded.steps) as never });
    const adapter = vercelAiAdapter({ generateText, model: acmeModel() });
    const observed = await sendUser(adapter, await adapter.open(given), 'Coverage at 3 Orchard Way?', 0);
    expectWholeObserved(observed);
    expect(observed.segments.map((segment) => segment.type)).toEqual([
      'text',
      'tool_call',
      'tool_result',
      'tool_call',
      'tool_result',
      'text',
    ]);
    expect(observed.toolCalls[0]).toMatchObject({
      id: 'call_1',
      label: 'coverage_check',
      input: { address: '3 Orchard Way' },
    });
    expect(observed.toolCalls[1]?.error).toBeDefined();
    expect(observed.text).toBe('Let me check.\nFiber is there.');
    expect(observed.cost).toEqual({ inputTokens: 30, outputTokens: 15 });
    expect(observed.raw).toEqual({ finishReasons: ['tool-calls', 'tool-calls', 'stop'] });
  });

  it('answers a forced tool result through a wrapped execute, and leaves the original tool alone', async () => {
    const tools = acmeVercelTools();
    const original = tools.coverage_check?.execute;
    const generateText = fakeGenerateText();
    const adapter = vercelAiAdapter({ generateText, model: acmeModel(), tools, toolLabels: ACME_TOOL_NAMES });
    const world = { tools: { 'coverage.check': { error: 'coverage service unavailable' } } };
    const start = acmeGiven({ adapter: 'vercel-ai' }, world);
    const observed = await sendUser(adapter, await adapter.open(start), COVERAGE_QUESTION, 0, start);
    expect(observed.toolCalls[0]).toMatchObject({
      label: 'coverage.check',
      error: 'coverage service unavailable',
    });
    expect(tools.coverage_check?.execute, "the caller's tool object is unchanged").toBe(original);
    expect(generateText.calls[0]?.maxRetries).toBe(0);
  });

  it('refuses a tool the policy denies before the call: the original execute never runs', async () => {
    const tools = acmeVercelTools();
    const original = tools.coverage_check?.execute;
    let ran = 0;
    if (tools.coverage_check) {
      tools.coverage_check.execute = async (input, options) => {
        ran += 1;
        return original ? original(input, options) : null;
      };
    }
    const generateText = fakeGenerateText();
    const adapter = vercelAiAdapter({
      generateText,
      model: acmeModel(),
      tools,
      toolLabels: ACME_TOOL_NAMES,
      toolPolicy: [{ pattern: 'coverage.check', action: 'deny' }],
    });
    const start = acmeGiven({ adapter: 'vercel-ai' });
    const observed = await sendUser(adapter, await adapter.open(start), COVERAGE_QUESTION, 0, start);
    expect(ran, 'the denied tool was not called').toBe(0);
    expect(observed.toolCalls[0]).toMatchObject({
      label: 'coverage.check',
      error: 'denied by tool policy rule coverage.check',
    });
  });

  it('retries a model call that fails twice under the shared policy, and records both retries', async () => {
    const model = acmeModel();
    const inner = model.doGenerate.bind(model);
    let failures = 2;
    model.doGenerate = async (options) => {
      if (failures > 0) {
        failures -= 1;
        throw Object.assign(new Error('Too Many Requests'), {
          name: 'AI_APICallError',
          statusCode: failures === 1 ? 429 : 529,
          responseHeaders: failures === 1 ? { 'retry-after': '1' } : {},
        });
      }
      return inner(options);
    };
    const waits: number[] = [];
    const adapter = vercelAiAdapter({
      generateText: fakeGenerateText(),
      model,
      tools: () => acmeVercelTools(),
      toolLabels: ACME_TOOL_NAMES,
      retry: { jitter: false, baseDelayMs: 10 },
      sleep: async (ms) => void waits.push(ms),
    });
    const session = await adapter.open(given);
    session.history.push({ role: 'user', content: COVERAGE_QUESTION });
    const { value, retries } = await collectRetries(() =>
      adapter.send(session, { index: 0, stimulus: { user: COVERAGE_QUESTION }, given }),
    );
    expectWholeObserved(value);
    expect(waits).toEqual([1_000, 20]);
    expect(retries.map((event) => [event.call, event.attempt, event.status])).toEqual([
      ['doGenerate (acme-fake) on block 0', 1, 429],
      ['doGenerate (acme-fake) on block 0', 2, 529],
    ]);
  });

  it('writes the history as model messages under the SDK tool names, an error as error-text', () => {
    const history: Message[] = [
      { role: 'system', content: 'kept out: the system prompt carries it' },
      { role: 'user', content: 'Coverage?' },
      {
        role: 'assistant',
        content: 'It is down.',
        tool_calls: [
          { label: 'coverage.check', input: { address: 'x' }, error: 'coverage service unavailable' },
        ],
      },
    ];
    expect(toModelMessages(history, labels)).toEqual([
      { role: 'user', content: 'Coverage?' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'call_h1', toolName: 'coverage_check', input: { address: 'x' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_h1',
            toolName: 'coverage_check',
            output: { type: 'error-text', value: 'coverage service unavailable' },
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'It is down.' }] },
    ]);
  });

  it('stops at the step cap, lowered by the block budget', async () => {
    const generateText = fakeGenerateText();
    const adapter = vercelAiAdapter({
      generateText,
      model: acmeModel(),
      tools: () => acmeVercelTools(),
      toolLabels: ACME_TOOL_NAMES,
      maxSteps: 1,
    });
    const observed = await sendUser(adapter, await adapter.open(given), COVERAGE_QUESTION, 0);
    expect(observed.toolCalls.map((call) => call.label)).toEqual(['coverage.check']);
    expect(observed.text).toBe('');
  });
});
