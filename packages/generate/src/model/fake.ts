import { ModelError, type ModelPort, type ModelRequest } from './port';

/** One recorded answer: the text to return, an error to throw, or a function of the request. */
export type FakeAnswer = string | Error | ((request: ModelRequest) => string | Promise<string>);

/**
 * A port for tests that replays recorded answers in order and keeps every request it received. When the
 * answers run out it throws a ModelError with the code `exhausted`, so a test never hangs on a missing one.
 */
export class FakeModelPort implements ModelPort {
  readonly family: string;
  readonly model: string;
  readonly requests: ModelRequest[] = [];
  private readonly answers: FakeAnswer[];

  constructor(answers: readonly FakeAnswer[], options: { family?: string; model?: string } = {}) {
    this.answers = [...answers];
    this.family = options.family ?? 'fake';
    this.model = options.model ?? 'fake-model';
  }

  /** How many recorded answers are left. */
  get remaining(): number {
    return this.answers.length;
  }

  async complete(request: ModelRequest): Promise<string> {
    this.requests.push(request);
    const next = this.answers.shift();
    if (next === undefined) {
      throw new ModelError(
        'exhausted',
        `the fake port has no answer left for request ${this.requests.length}`,
      );
    }
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(request) : next;
  }
}
