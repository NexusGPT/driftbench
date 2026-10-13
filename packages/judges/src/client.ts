import type { JudgeClass, JudgeRequest, JudgeResult } from './contract';
import type { HttpOptions } from './http';

/**
 * One judge. Every client, a real provider, a cassette player or a test fake, answers through this one
 * interface: a request in, the answer contract out.
 *
 * A client throws a JudgeError only when it got no answer at all (configuration, transport after its
 * retries, a cassette miss). An answer it cannot read is returned as an unparsed inconclusive result.
 */
export interface JudgeClient {
  /** The name votes carry, unique in a council. */
  readonly id: string;
  /** The model family, such as openai, anthropic or google. A judge never shares the agent's family. */
  readonly family: string;
  readonly cls: JudgeClass;
  readonly model?: string;
  /** Relative cost of one call. The cascade runs the cheapest first. */
  readonly cost: number;
  /**
   * The client's own settings that shape an answer beyond the model, such as command flags, as one string.
   * Part of the cassette key: a recording made with other settings never replays.
   */
  readonly settings?: string;
  judge(request: JudgeRequest): Promise<JudgeResult>;
}

/** What every provider client takes. Keys are read from `env` only, never from an option. */
export type ClientOptions = HttpOptions & {
  /** Where variables are read. Default `process.env`. */
  env?: Record<string, string | undefined>;
  /** The vote name. Default the client kind, such as `openai`. */
  id?: string;
  /** The model, when the variable that names it is not set. */
  model?: string;
  /**
   * Reasoning effort for OpenAI chat and Google Gemini clients, on models supporting the level.
   * Unset preserves the provider default. Anthropic chat, Jev, OpenAI Decisions and HTTP judges reject it.
   */
  reasoning?: 'low' | 'medium' | 'high';
  /** Relative cost. Defaults: 1 for system 1 clients, 10 for chat models. */
  cost?: number;
};
