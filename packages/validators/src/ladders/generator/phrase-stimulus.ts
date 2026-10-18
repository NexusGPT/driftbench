import type { Spec } from '@agent-nexus/driftbench-core';
import { DEVIATIONS } from '@agent-nexus/driftbench-users';
import { type HiddenPhrase, phrasePattern } from './hidden';

type Stimulus = { carrier: 'user'; text: string } | { carrier: 'world'; class: string; texts: string[] };

/** Read content values, never filenames, JSON keys or metadata claiming that a phrase was used. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

/**
 * A world-carried deviation with no user message puts its stimulus in the block's world delta.
 * The carrier registry and WorldState schema own this distinction. Only supplied file contents and
 * tool results carry instructions; background Given, paths, store/fixtures and tool errors are not
 * phrase evidence. A nonempty user turn still has to prove its own provenance.
 */
export function phraseStimulus(block: Spec['blocks'][number]): Stimulus {
  const when = block.when;
  if (when && 'injection' in when) {
    const injection = when.injection;
    if (injection.user.trim() === '' && DEVIATIONS[injection.class].carrier === 'world') {
      const world = block.given?.world;
      return {
        carrier: 'world',
        class: injection.class,
        texts: [
          ...Object.values(world?.workspace?.files ?? {}),
          ...Object.values(world?.tools ?? {}).flatMap((tool) => strings(tool.result)),
        ],
      };
    }
  }
  return {
    carrier: 'user',
    text: !when
      ? ''
      : 'user' in when
        ? when.user
        : 'injection' in when
          ? when.injection.user
          : when.burst.join('\n'),
  };
}

/** The same approved phrase may be a whole user turn or embedded inside its class's untrusted data. */
export function matchesPhrase(stimulus: Stimulus, phrase: HiddenPhrase): boolean {
  const pattern = phrasePattern(phrase.text);
  if (stimulus.carrier === 'user') return pattern.test(stimulus.text);
  if (phrase.intent.kind !== 'deviation' || phrase.intent.class !== stimulus.class) return false;
  // Remove only the whole-turn anchors; keep the literal wording and slot grammar unchanged.
  const embedded = new RegExp(pattern.source.slice(1, -1));
  return stimulus.texts.some((text) => embedded.test(text));
}
