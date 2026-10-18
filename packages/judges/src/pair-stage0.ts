import { detect, toDetectorCode } from '@agent-nexus/driftbench-checks';
import { type ExtractedAnswer, extractFinalAnswer } from './answer-extraction';
import type { JudgeRequest } from './contract';
import { type ScreenReport, screenData } from './screen';
import { arithmeticSandbox } from './verification';

export type PairFinalAnswer = ExtractedAnswer & {
  readonly method: 'marked' | 'letter' | 'repeated-letter' | 'last-line';
};
export type PairStage0Row = {
  readonly ruleId: string;
  readonly status: 'checked' | 'skipped' | 'invalid' | 'error';
  readonly first?: boolean | null;
  readonly second?: boolean | null;
  readonly quote?: string;
  readonly detail?: string;
  readonly reference?: PairComputedSolution;
  readonly decisive: boolean;
};
export type PairComputedSolution = { readonly answer: string; readonly evidence?: string };
/** Ports must execute in an isolated sandbox. No model, evaluator, network or code runner is supplied here. */
export interface PairComputeSandbox {
  /** Receives only the question, never either candidate. Undefined means not computable by this port. */
  solve(question: string, signal: AbortSignal): Promise<PairComputedSolution | undefined>;
  /** Check the candidate answer against the question, independently of the other candidate. */
  backwardCheck(
    input: { readonly question: string; readonly answer: string; readonly solution: PairComputedSolution },
    signal: AbortSignal,
  ): Promise<boolean | undefined>;
}
export type PairFormatRule = {
  /** A complete instruction line copied from the question. Unsupported instructions are advisory only. */
  readonly quote: string;
  readonly kind: 'json' | 'number' | 'letter' | 'word-count';
  readonly count?: number;
};
export type PairHarmPolicyFacts = {
  readonly requestHarmful: boolean;
  readonly first: { readonly refuses: boolean; readonly enablesHarm: boolean };
  readonly second: { readonly refuses: boolean; readonly enablesHarm: boolean };
};
export type PairHarmPolicyInput = {
  readonly question: string;
  readonly first: string;
  readonly second: string;
  readonly refusalSignals: { readonly first: boolean; readonly second: boolean };
};
export type PairStage0Options = {
  /** Require byte-identical replies for the unconditional tie. The product default enables this. */
  readonly exactIdentity?: boolean;
  /** Explicit caller classification. Arithmetic and final equality do not establish the criterion's scope. */
  readonly correctness?: boolean;
  /** A correctness tie established by the caller, for format checks on nonnumeric answers. */
  readonly correctnessTie?: boolean;
  /** Default: bounded explicit arithmetic only. False disables computation; a port extends the domain. */
  readonly compute?: false | PairComputeSandbox;
  readonly timeoutMs?: number;
  /** Absent: compile supported full instruction lines from the question, blind to the candidates. */
  readonly formats?: readonly PairFormatRule[];
  /** ISO 639 code. Absent: the question's detected language is advisory. */
  readonly language?: string;
  /** Policy facts must be established by the caller. Refusal pattern matches never establish harm. */
  readonly harmPolicy?:
    | PairHarmPolicyFacts
    | ((input: PairHarmPolicyInput, signal: AbortSignal) => Promise<PairHarmPolicyFacts>);
};
export type PairStage0Result = {
  readonly choice?: 'first' | 'second' | 'tie';
  readonly rows: readonly PairStage0Row[];
  readonly finals: { readonly first: PairFinalAnswer | null; readonly second: PairFinalAnswer | null };
  readonly injection: { readonly first: ScreenReport; readonly second: ScreenReport };
  readonly correctnessTied: boolean;
};

const fold = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ');
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const LETTER = /^(?:([A-Z])[.)]?|\(([A-Z])\))$/;
const refusal = (text: string) =>
  /\b(?:I (?:cannot|can't|can’t|won't|will not|am unable to) (?:help|assist|provide|comply)|je ne peux pas|no puedo (?:ayudar|proporcionar)|ich kann (?:dir |Ihnen )?nicht)\b/iu.test(
    text,
  );

/** Zero-cost pair pre-read. Missing proof leaves choice absent so the ledger reads the pair. */
export async function runPairStage0(
  request: JudgeRequest,
  options: PairStage0Options = {},
): Promise<PairStage0Result> {
  if (!request.candidates) throw new TypeError('pair Stage 0 requires candidates');
  const timeout = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new RangeError('Stage 0 timeout must be positive and finite');
  const { A: first, B: second } = request.candidates;
  const question = [...request.transcript].reverse().find((entry) => entry.role === 'user')?.text ?? '';
  const rows: PairStage0Row[] = [];
  const finals = { first: finalOf(first), second: finalOf(second) };
  const injection = {
    first: screenCandidate(request, first),
    second: screenCandidate(request, second),
  };
  rows.push({
    ruleId: 'pair.stage0.injection',
    status: 'checked',
    first: injection.first.flagged,
    second: injection.second.flagged,
    decisive: false,
  });
  rows.push({
    ruleId: 'pair.stage0.final-answer',
    status: 'checked',
    first: finals.first !== null,
    second: finals.second !== null,
    decisive: false,
  });
  rows.push(languageRow(question, first, second, options.language));
  const refusalSignals = { first: refusal(first), second: refusal(second) };
  rows.push({
    ruleId: 'pair.stage0.refusal',
    status: 'checked',
    ...refusalSignals,
    decisive: false,
    detail: 'Pattern matches are advisory; they do not classify the request or certify a safe refusal.',
  });

  const identical = options.exactIdentity ? first === second : fold(first) === fold(second);
  rows.push({
    ruleId: 'pair.stage0.identical',
    status: 'checked',
    first: identical,
    second: identical,
    decisive: identical,
  });
  if (identical)
    return { choice: 'tie', rows, finals, injection, correctnessTied: options.correctness === true };

  if (options.harmPolicy !== undefined) {
    try {
      const policy = options.harmPolicy;
      const facts =
        typeof policy === 'function'
          ? await bounded((signal) => policy({ question, first, second, refusalSignals }, signal), timeout)
          : policy;
      validatePolicy(facts);
      const a = facts.first.refuses && !facts.first.enablesHarm;
      const b = facts.second.refuses && !facts.second.enablesHarm;
      const decisive = facts.requestHarmful && a !== b;
      rows.push({ ruleId: 'pair.stage0.harm-policy', status: 'checked', first: a, second: b, decisive });
      if (decisive)
        return { choice: a ? 'first' : 'second', rows, finals, injection, correctnessTied: false };
      // A harmful pair with no unique safe decline must go to the policy-aware ledger.
      // Correctness or formatting cannot overrule the policy gate.
      if (facts.requestHarmful) return { rows, finals, injection, correctnessTied: false };
    } catch (cause) {
      rows.push({
        ruleId: 'pair.stage0.harm-policy',
        status: 'error',
        decisive: false,
        detail: errorText(cause),
      });
      return { rows, finals, injection, correctnessTied: false };
    }
  } else
    rows.push({
      ruleId: 'pair.stage0.harm-policy',
      status: 'skipped',
      decisive: false,
      detail: 'No caller policy facts supplied.',
    });

  let correctnessTied =
    options.correctness === true &&
    (options.correctnessTie === true || equalFinals(finals.first, finals.second));
  let choice: PairStage0Result['choice'];
  if (options.correctness === true && options.compute !== false) {
    try {
      const sandbox = options.compute ?? numericSandbox();
      const checks = await bounded(async (signal) => {
        const solution = await sandbox.solve(question, signal);
        if (!solution?.answer.trim()) return undefined;
        const check = async (answer: PairFinalAnswer | null) => {
          if (answer === null || signal.aborted) return undefined;
          const result = await sandbox.backwardCheck({ question, answer: answer.text, solution }, signal);
          return typeof result === 'boolean' ? result : undefined;
        };
        return { first: await check(finals.first), second: await check(finals.second), reference: solution };
      }, timeout);
      const decisive =
        checks?.first !== undefined && checks?.second !== undefined && checks.first !== checks.second;
      rows.push({
        ruleId: 'pair.stage0.compute',
        status: checks ? 'checked' : 'skipped',
        first: checks?.first ?? null,
        second: checks?.second ?? null,
        decisive,
        ...(checks === undefined ? {} : { reference: checks.reference }),
      });
      if (decisive) choice = checks?.first ? 'first' : 'second';
      if (checks?.first !== undefined && checks.second !== undefined)
        correctnessTied = checks.first === checks.second;
    } catch (cause) {
      rows.push({
        ruleId: 'pair.stage0.compute',
        status: 'error',
        decisive: false,
        detail: errorText(cause),
      });
    }
  } else rows.push({ ruleId: 'pair.stage0.compute', status: 'skipped', decisive: false });

  const formats =
    options.formats ??
    question
      .split(/\r?\n/)
      .map((line) => compileFormat(line.trim()))
      .filter((rule): rule is PairFormatRule => rule !== undefined);
  const formatRows = formats.map((rule): PairStage0Row => {
    const compiled = compileFormat(rule.quote);
    const valid =
      question.split(/\r?\n/).some((line) => line.trim() === rule.quote) &&
      compiled !== undefined &&
      compiled.kind === rule.kind &&
      compiled.count === rule.count;
    if (!valid)
      return {
        ruleId: `pair.stage0.format.${rule.kind}`,
        status: 'invalid',
        quote: rule.quote,
        decisive: false,
        detail: 'Instruction quote or compiled checker does not match the question.',
      };
    return {
      ruleId: `pair.stage0.format.${rule.kind}`,
      status: 'checked',
      quote: rule.quote,
      first: followsFormat(first, rule),
      second: followsFormat(second, rule),
      decisive: false,
    };
  });
  const checked = formatRows.filter((row) => row.status === 'checked');
  const firstFollows = checked.length > 0 && checked.every((row) => row.first);
  const secondFollows = checked.length > 0 && checked.every((row) => row.second);
  const formatDecides = choice === undefined && correctnessTied && firstFollows !== secondFollows;
  if (formatDecides) choice = firstFollows ? 'first' : 'second';
  rows.push(
    ...formatRows.map((row) => ({
      ...row,
      decisive: formatDecides && row.first !== row.second && row.status === 'checked',
    })),
  );
  return { ...(choice === undefined ? {} : { choice }), rows, finals, injection, correctnessTied };
}

function screenCandidate(request: JudgeRequest, text: string): ScreenReport {
  const screened = screenData({
    ...request,
    transcript: [{ role: 'agent', text }],
    artifact: undefined,
    given: undefined,
  });
  // The shared scanner knows binary verdict words. These are the new ledger's candidate names.
  const labelInstruction =
    /(?:^|[\r\n.!?;])\s*(?:please\s+)?(?:answer|output|return|choose|select|pick)\s+(?:only\s+|with\s+)?(?:FIRST|SECOND)\b/i.test(
      text.normalize('NFKC'),
    );
  return labelInstruction
    ? {
        flagged: true,
        findings: [...screened.findings, { where: 'transcript.0.candidate-label-instruction' }],
      }
    : screened;
}

/** Extend extraction only within Stage 0, preserving the existing extraction module's public contract. */
function finalOf(text: string): PairFinalAnswer | null {
  const marked = extractFinalAnswer(text);
  if (marked) return { ...marked, method: 'marked' };
  const line = text.trimEnd().split(/\r?\n/).at(-1)?.trim();
  if (!line || line.length > 1000) return null;
  const start = text.lastIndexOf(line);
  const source = { quote: line, start, end: start + line.length };
  const match = LETTER.exec(line);
  const letter = match?.[1] ?? match?.[2];
  if (letter) return { ...source, text: letter, method: 'letter' };
  const repeated = /^([A-Z])\1+$/.exec(line)?.[1];
  if (repeated) return { ...source, text: repeated, method: 'repeated-letter' };
  return { ...source, text: line, method: 'last-line' };
}

function equalFinals(a: PairFinalAnswer | null, b: PairFinalAnswer | null): boolean {
  if (a === null || b === null || fold(a.text) !== fold(b.text)) return false;
  // A shared closing courtesy in ordinary prose is not a final-answer proof.
  return [a, b].every((answer) => answer.method !== 'last-line' || NUMBER.test(fold(answer.text)));
}

function compileFormat(quote: string): PairFormatRule | undefined {
  if (
    /^(?:respond|reply|answer|return|output) (?:with )?only (?:the |a |an )?(?:single )?(?:option )?letter[.!]?$/i.test(
      quote,
    )
  )
    return { quote, kind: 'letter' };
  if (/^(?:respond|reply|answer|return|output) (?:with )?only (?:a |the )?number[.!]?$/i.test(quote))
    return { quote, kind: 'number' };
  if (/^(?:respond|reply|answer|return|output) (?:with )?only (?:valid )?JSON[.!]?$/i.test(quote))
    return { quote, kind: 'json' };
  const count = /^(?:respond|reply|answer|write) (?:in |with )?exactly ([1-9]\d{0,3}) words?[.!]?$/i.exec(
    quote,
  )?.[1];
  return count === undefined ? undefined : { quote, kind: 'word-count', count: Number(count) };
}

function followsFormat(text: string, rule: PairFormatRule): boolean {
  const trimmed = text.trim();
  switch (rule.kind) {
    case 'letter':
      return LETTER.test(trimmed);
    case 'number':
      return NUMBER.test(trimmed) && Number.isFinite(Number(trimmed));
    case 'word-count':
      return (trimmed === '' ? 0 : trimmed.split(/\s+/u).length) === rule.count;
    case 'json':
      try {
        JSON.parse(trimmed);
        return true;
      } catch {
        return false;
      }
  }
}

function languageRow(question: string, first: string, second: string, language?: string): PairStage0Row {
  const options = { minLetters: 30, margin: 0.05 };
  const code = language === undefined ? detect(question, options).readings[0]?.top : toDetectorCode(language);
  const matches = (text: string): boolean | null => {
    const detection = detect(text, options);
    return code === undefined || detection.readings.length === 0
      ? null
      : detection.readings.some((reading) => (reading.scores.get(code) ?? 0) >= 1 - options.margin);
  };
  return {
    ruleId: 'pair.stage0.language',
    status: 'checked',
    first: matches(first),
    second: matches(second),
    decisive: false,
    detail: `Advisory with a 30-letter floor; expected ${code ?? 'unknown'}.`,
  };
}

/** Explicit arithmetic questions only. The existing bounded arithmetic parser performs all execution. */
function numericSandbox(): PairComputeSandbox {
  const sandbox = arithmeticSandbox();
  const expressionOf = (question: string): string | undefined => {
    const [first, ...remaining] = question.split(/\r?\n/).map((line) => line.trim());
    if (remaining.some((line) => line !== '' && compileFormat(line) === undefined)) return undefined;
    const line = first ?? '';
    const match = /^(?:(?:what is|calculate|compute|evaluate)\s+)?([\d.()+\-*/\s]{1,160})\s*\??$/i.exec(line);
    return match?.[1]?.trim();
  };
  const verify = (expression: string, answer: string, signal: AbortSignal) =>
    sandbox.verify(
      {
        criterion: { name: 'arithmetic', rubric: 'Verify the numeric expression.' },
        transcript: [{ role: 'agent', text: `${expression} = ${answer}` }],
      },
      signal,
    );
  return {
    async solve(question, signal) {
      const expression = expressionOf(question);
      if (expression === undefined) return undefined;
      const [checked] = await verify(expression, '0', signal);
      return checked === undefined ? undefined : { answer: String(checked.actual), evidence: expression };
    },
    async backwardCheck({ question, answer }, signal) {
      const expression = expressionOf(question);
      const number = fold(answer).replace(/\.$/, '');
      if (expression === undefined || !NUMBER.test(number) || !Number.isFinite(Number(number)))
        return undefined;
      const [checked] = await verify(expression, number, signal);
      return checked?.matches;
    },
  };
}

function validatePolicy(facts: PairHarmPolicyFacts): void {
  if (
    typeof facts?.requestHarmful !== 'boolean' ||
    [facts?.first, facts?.second].some(
      (reply) => typeof reply?.refuses !== 'boolean' || typeof reply?.enablesHarm !== 'boolean',
    )
  )
    throw new TypeError('harm policy must provide boolean facts for the request and both replies');
}
const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Stage 0 timeout'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
