import type { JudgeClient } from '../client';
import {
  type JudgeAnswer,
  type JudgeClass,
  type JudgeRequest,
  type JudgeResult,
  parseAnswerText,
} from '../contract';

/** One scripted answer: the contract, raw text to parse, an error to throw, or a function of the request. */
export type FakeAnswer =
  | JudgeAnswer
  | string
  | Error
  | ((request: JudgeRequest) => JudgeAnswer | string | Promise<JudgeAnswer | string>);

/**
 * A judge for tests. It answers in order and keeps every request; when the answers run out the last one
 * repeats. A string answer goes through the contract parser, as a model's text would.
 */
export class FakeJudge implements JudgeClient {
  readonly id: string;
  readonly family: string;
  readonly cls: JudgeClass;
  readonly cost: number;
  readonly requests: JudgeRequest[] = [];
  private readonly answers: FakeAnswer[];

  constructor(
    id: string,
    answers: readonly FakeAnswer[],
    options: { family?: string; cls?: JudgeClass; cost?: number } = {},
  ) {
    if (answers.length === 0) throw new Error(`FakeJudge ${id} needs at least one answer`);
    this.id = id;
    this.answers = [...answers];
    this.family = options.family ?? 'fake';
    this.cls = options.cls ?? 'system1';
    this.cost = options.cost ?? 1;
  }

  async judge(request: JudgeRequest): Promise<JudgeResult> {
    this.requests.push(request);
    const index = Math.min(this.requests.length - 1, this.answers.length - 1);
    const next = this.answers[index] as FakeAnswer;
    if (next instanceof Error) throw next;
    const value = typeof next === 'function' ? await next(request) : next;
    if (typeof value === 'string') return parseAnswerText(value);
    return { answer: value, raw: JSON.stringify(value) };
  }
}
