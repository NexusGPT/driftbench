import type { Message, TargetRef } from '@agent-nexus/driftbench-core';

/**
 * `target.prompt`, set by `campaign run --prompt`, is the prompt version the agent runs with. Adapters
 * that send a history hand it over as a leading system message: the history the runner owns is never
 * changed, a copy is.
 */
export function promptMessages(history: Message[], target: TargetRef): Message[] {
  if (target.prompt === undefined) return history;
  return [{ role: 'system', content: target.prompt.text }, ...history];
}
