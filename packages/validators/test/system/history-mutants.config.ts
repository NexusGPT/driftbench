import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../../../vitest.config.js';

// Run the real bank checks against in-memory product mutations. Product files on
// disk stay untouched, and the normal config never loads these mutations.
const mutant = process.env.HISTORY_MUTANT;
const modes = ['share-without-freezing', 'runner-only-freeze', 'no-copy-no-freeze'];
if (!mutant || !modes.includes(mutant)) throw new Error(`Set HISTORY_MUTANT to ${modes.join(', ')}`);

function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error(`Mutant anchor changed: ${before}`);
  return source.replace(before, after);
}

export default mergeConfig(
  base,
  defineConfig({
    plugins: [
      {
        name: 'history-safety-mutants',
        enforce: 'pre',
        transform(source, id) {
          if (mutant !== 'runner-only-freeze' && id.endsWith('/packages/core/src/contracts/history.ts')) {
            // Disable protection everywhere, retaining the real shallow-array handoff.
            return replaceOnce(
              source,
              'export function freezeMessage(message: Message): Message {',
              'export function freezeMessage(message: Message): Message { return message;',
            );
          }
          if (!/\/packages\/adapters\/src\/(function|process)\/index\.ts$/.test(id)) return;
          if (mutant === 'runner-only-freeze') {
            // The runner still freezes its messages. Only the direct adapter boundary
            // loses protection, so fixtures that pre-freeze inputs would miss this bug.
            let result = replaceOnce(source, 'copyHistory(given.prefix)', '[...given.prefix]');
            result = replaceOnce(result, 'copyHistory(session.history)', '[...session.history]');
            return result;
          }
          if (mutant === 'no-copy-no-freeze' && id.endsWith('/function/index.ts')) {
            let result = replaceOnce(source, 'structuredClone(turn.given.world)', 'turn.given.world');
            result = replaceOnce(result, 'structuredClone(turn.given.vars)', 'turn.given.vars');
            result = replaceOnce(result, 'structuredClone(session.target)', 'session.target');
            return result;
          }
        },
      },
    ],
  }),
);
