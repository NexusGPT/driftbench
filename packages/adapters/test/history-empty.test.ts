import type { Message } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { WireNames } from '../src/anthropic/common';
import { anthropicAdapter } from '../src/anthropic/index';
import { ANTHROPIC_NAME, toAnthropicMessages } from '../src/anthropic/messages';
import { GOOGLE_NAME, toGoogleContents } from '../src/google/contents';
import { googleAdapter } from '../src/google/index';
import { acmeGiven } from './contract';
import { carried, fromAnthropic } from './history-wires';

const history: Message[] = [
  { role: 'user', content: 'Hello.' },
  { role: 'assistant', content: 'Ready.' },
  { role: 'user', content: '' },
  { role: 'assistant', content: 'Still ready.' },
];

describe('empty text turns on block-based wires', () => {
  for (const wire of ['anthropic', 'google'] as const) {
    const render = (input: readonly Message[]) =>
      wire === 'anthropic'
        ? toAnthropicMessages(input, new WireNames([], ANTHROPIC_NAME))
        : toGoogleContents(input, new WireNames([], GOOGLE_NAME));

    const readText = (rendered: ReturnType<typeof render>) =>
      'messages' in rendered
        ? fromAnthropic(rendered)
        : rendered.contents.flatMap((message) =>
            (message.parts ?? []).map((part) => ({
              role: message.role === 'model' ? 'assistant' : 'user',
              content: part.text,
            })),
          );

    it(`${wire}: records the omitted empty user turn without inventing model input`, () => {
      const rendered = render(history);
      expect(rendered.normalizations).toEqual([
        { wire, historyIndex: 2, role: 'user', kind: 'omitted-empty-turn' },
      ]);
      const text = readText(rendered);
      expect(text).toEqual([
        { role: 'user', content: 'Hello.' },
        { role: 'assistant', content: 'Ready.' },
        { role: 'assistant', content: 'Still ready.' },
      ]);
      expect(history[2]).toEqual({ role: 'user', content: '' });
      expect({ messages: text, normalizations: rendered.normalizations }).toEqual(
        carried(history, { system: 'apart', omitEmptyText: wire }),
      );
    });

    it(`${wire}: still fails exact read-back when nonempty text or the omission record is lost`, () => {
      const expected = carried(history, { system: 'apart', omitEmptyText: wire });
      const rendered = render(history);
      // Lose a nonempty turn on the wire, keeping the legitimate empty-turn record intact.
      if ('messages' in rendered) rendered.messages.shift();
      else rendered.contents.shift();
      expect(() =>
        expect({ messages: readText(rendered), normalizations: rendered.normalizations }).toEqual(expected),
      ).toThrow();
      const intact = render(history);
      expect(() => expect({ messages: readText(intact), normalizations: [] }).toEqual(expected)).toThrow();
    });

    it(`${wire}: records each empty text-only role, but keeps whitespace and tool calls`, () => {
      const input: Message[] = [
        { role: 'system', content: '' },
        { role: 'user', content: '' },
        { role: 'assistant', content: '' },
        { role: 'tool', content: '' },
        { role: 'user', content: ' ' },
        { role: 'assistant', content: '', tool_calls: [{ label: 'lookup', output: 0 }] },
      ];
      expect(render(input).normalizations).toEqual(
        input.slice(0, 4).map((message, historyIndex) => ({
          wire,
          historyIndex,
          role: message.role,
          kind: 'omitted-empty-turn',
        })),
      );
    });

    it(`${wire}: sends whitespace-only text unchanged on the wire`, () => {
      for (const content of [' ', '\t', '\n', ' \t\n ']) {
        for (const role of ['system', 'user', 'assistant', 'tool'] as const) {
          const input: Message[] = [
            { role: 'user', content: 'Hello.' },
            { role: 'assistant', content: 'Ready.' },
            { role, content },
            { role: 'user', content: 'After.' },
          ];
          const rendered = render(input);
          expect(rendered.normalizations).toEqual([]);
          expect(rendered.system).toEqual(role === 'system' ? [content] : []);
          expect(readText(rendered)).toEqual([
            { role: 'user', content: 'Hello.' },
            { role: 'assistant', content: 'Ready.' },
            ...(role === 'system' ? [] : [{ role: role === 'tool' ? 'user' : role, content }]),
            { role: 'user', content: 'After.' },
          ]);
        }
      }
    });

    it(`${wire}: exposes the difference on the observation and preserves the session history`, async () => {
      const adapter =
        wire === 'anthropic'
          ? anthropicAdapter({
              model: 'fictional',
              client: {
                messages: {
                  create: async () => ({
                    content: [{ type: 'text', text: 'Answer.' }],
                    stop_reason: 'end_turn',
                  }),
                },
              },
            })
          : googleAdapter({
              model: 'fictional',
              client: {
                models: {
                  generateContent: async () => ({
                    candidates: [{ content: { role: 'model', parts: [{ text: 'Answer.' }] } }],
                  }),
                },
              },
            });
      const given = { ...acmeGiven({ adapter: wire }), prefix: history };
      const session = await adapter.open(given);
      const observed = await adapter.send(session, { index: 0, stimulus: { user: '' }, given });
      expect(observed.historyNormalizations).toEqual([
        { wire, historyIndex: 2, role: 'user', kind: 'omitted-empty-turn' },
      ]);
      expect(session.history).toEqual(history);
      expect(observed.text).toBe('Answer.');
      await adapter.close(session);

      // Absence is a serialization contract: an empty array would change legacy bytes and hashes.
      const cleanGiven = { ...given, prefix: history.filter((message) => message.content !== '') };
      const cleanSession = await adapter.open(cleanGiven);
      const cleanObserved = await adapter.send(cleanSession, {
        index: 0,
        stimulus: { user: 'Hello.' },
        given: cleanGiven,
      });
      expect(cleanObserved).not.toHaveProperty('historyNormalizations');
      await adapter.close(cleanSession);
    });
  }
});
