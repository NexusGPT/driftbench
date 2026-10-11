/**
 * The model port: one system prompt and one user message in, the text of the answer out. driftbench uses a
 * model for two jobs only (finding where an agent's behaviour is specified, and proposing phrasings), so the
 * port stays this small. Every client reads its key from the environment and never logs, prints or stores it.
 */

export type ModelRequest = {
  system: string;
  user: string;
  /** The ceiling on the answer's length. Each client has its own default. */
  maxTokens?: number;
};

export interface ModelPort {
  /** The model family, such as anthropic or openai. Recorded in produced_by: a family never sits in two seats. */
  readonly family: string;
  /** The model as the provider names it. Recorded in produced_by; `unknown` when a port leaves it out. */
  readonly model?: string;
  complete(request: ModelRequest): Promise<string>;
}

export const ModelErrorCodes = [
  'config',
  'http',
  'network',
  'timeout',
  'refusal',
  'truncated',
  'empty',
  'bad_response',
  'exhausted',
] as const;
export type ModelErrorCode = (typeof ModelErrorCodes)[number];

/**
 * A model call that did not give an answer. The message names the provider's error type and text, never a
 * key or a header.
 */
export class ModelError extends Error {
  readonly code: ModelErrorCode;
  /** The HTTP status, when the provider answered. */
  readonly status: number | undefined;
  /** True for a status or a failure that may pass on a later try: 429, 5xx, 529, network, timeout. */
  readonly retryable: boolean;

  constructor(code: ModelErrorCode, message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}
