import type { Message } from '@agent-nexus/driftbench-core';
import { type AcmeStore, createStore } from '../../../../../examples/acme/src/index';
import type {
  GenerateTextLike,
  ModelMessageLike,
  StepLike,
  VercelToolLike,
} from '../../../src/vercel-ai/index';
import {
  ACME_TOOLS,
  type AcmeTurn,
  labelOf,
  nextAction,
  runAcmeTool,
  sdkName,
  tokens,
} from '../sdk/acme-model';
import { turnsOfMessages } from './acme-loop';

/**
 * A fake of the Vercel AI SDK's agent loop and a fake model that plays the Acme agent.
 *
 * `fakeGenerateText` does what `generateText` does with tools: call `model.doGenerate` once per step, run
 * the tool the model asked for through the tool's own `execute` (so a wrapped `execute` answers), put a
 * thrown error in a `tool-error` part, and stop when the model replies or `stopWhen` says so. It returns
 * `steps` with the content parts and usage the real SDK gives. `acmeModel` decides from the turns it is
 * handed, the way a model reads its prompt.
 */

export type FakeModel = {
  readonly specificationVersion: 'v4';
  readonly provider: string;
  readonly modelId: string;
  calls: number;
  doGenerate(options: { turns: AcmeTurn[] }): Promise<{ action: ReturnType<typeof nextAction> }>;
};

export function acmeModel(): FakeModel {
  return {
    specificationVersion: 'v4',
    provider: 'fake',
    modelId: 'acme-fake',
    calls: 0,
    async doGenerate({ turns }) {
      this.calls += 1;
      return { action: nextAction(turns) };
    },
  };
}

/** The Acme tools as AI SDK tools over a fresh store, named the SDK way (no dot). */
export function acmeVercelTools(store: AcmeStore = createStore()): Record<string, VercelToolLike> {
  return Object.fromEntries(
    ACME_TOOLS.map((label) => [
      sdkName(label),
      {
        description: `The Acme ${label} tool.`,
        inputSchema: { type: 'object' },
        execute: async (input: unknown) => {
          const outcome = runAcmeTool(store, label, input);
          if (!outcome.ok) throw new Error(outcome.error);
          return outcome.output;
        },
      },
    ]),
  );
}

export type FakeGenerateText = GenerateTextLike & { readonly calls: Parameters<GenerateTextLike>[0][] };

export function fakeGenerateText(): FakeGenerateText {
  const calls: Parameters<GenerateTextLike>[0][] = [];
  const generate = async (options: Parameters<GenerateTextLike>[0]) => {
    calls.push(options);
    const turns = turnsOfMessages(fromModelMessages(options.messages));
    const current = turns.at(-1);
    const steps: StepLike[] = [];
    let n = 0;
    for (;;) {
      const model = options.model as FakeModel;
      const { action } = await model.doGenerate({ turns });
      n += 1;
      if (action.kind === 'reply') {
        steps.push({
          content: [{ type: 'text', text: action.text }],
          finishReason: 'stop',
          usage: { inputTokens: tokens(turns), outputTokens: tokens(action.text) },
        });
        return { steps };
      }
      const name = sdkName(action.label);
      const callId = `call_fake_${n}`;
      const content: Record<string, unknown>[] = [
        { type: 'tool-call', toolCallId: callId, toolName: name, input: action.input },
      ];
      const tool = options.tools?.[name];
      try {
        if (!tool?.execute) throw new Error(`no tool ${name}`);
        const output = await tool.execute(action.input, { toolCallId: callId, messages: [] });
        content.push({
          type: 'tool-result',
          toolCallId: callId,
          toolName: name,
          input: action.input,
          output,
        });
        current?.calls.push({ label: action.label, input: action.input, outcome: { ok: true, output } });
      } catch (error) {
        content.push({ type: 'tool-error', toolCallId: callId, toolName: name, input: action.input, error });
        current?.calls.push({
          label: action.label,
          input: action.input,
          outcome: { ok: false, error: (error as Error).message },
        });
      }
      steps.push({
        content,
        finishReason: 'tool-calls',
        usage: { inputTokens: tokens(turns), outputTokens: tokens(action.input) },
      });
      if (options.stopWhen({ steps })) return { steps };
    }
  };
  return Object.assign(generate, { calls });
}

/** Model messages back into driftbench messages, so the Acme turns can be read from them. */
function fromModelMessages(messages: readonly ModelMessageLike[]): Message[] {
  const out: Message[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content });
    } else if (message.role === 'assistant') {
      const text = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
      const calls = message.content.flatMap((part) =>
        part.type === 'tool-call'
          ? [{ id: part.toolCallId, label: labelOf(part.toolName, []), input: part.input as never }]
          : [],
      );
      out.push({ role: 'assistant', content: text, ...(calls.length > 0 ? { tool_calls: calls } : {}) });
    } else {
      const last = out.at(-1);
      for (const part of message.content) {
        const call = last?.tool_calls?.find((entry) => entry.id === part.toolCallId);
        if (!call) continue;
        if (part.output.type === 'error-text') call.error = part.output.value;
        else call.output = part.output.value as never;
      }
    }
  }
  return out;
}
