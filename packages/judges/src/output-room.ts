import { type Budget, type JudgeRequest, MAX_TOKENS, REASONING_TOKENS } from './contract';

/**
 * Output room for one default-policy model call when no reasoning level is set. A model that thinks by default
 * spends that thinking from the same output limit as its answer, so the answer budget alone can end a stage with no
 * text. An explicit reasoning level keeps its own allowance.
 */
export const THINKING_ROOM = 12288;

export function outputRoom(budget: Budget, reasoning: JudgeRequest['reasoning']): number {
  return MAX_TOKENS[budget] + (reasoning === undefined ? THINKING_ROOM : REASONING_TOKENS[reasoning]);
}
