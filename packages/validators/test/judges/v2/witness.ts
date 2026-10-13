import type {
  Cassette,
  ClientOptions,
  CouncilResult,
  CriteriaLoad,
  CriterionText,
  JudgeAnswer,
  JudgeClient,
  JudgeRequest,
  JudgeResult,
  TranscriptEntry,
  Vote,
} from '@agent-nexus/driftbench-judges';
import * as judges from '@agent-nexus/driftbench-judges';
import { clopperPearson } from '@agent-nexus/driftbench-stats';
import { type JudgesApi, realApi } from '../../../src/ladders/judges/v2/bank';
import { fleissOf, metricsOf } from '../../../src/ladders/judges/v2/families/agreement';
import { bankMajority } from '../../../src/ladders/judges/v2/families/council';
import { firstPlace } from '../../../src/ladders/judges/v2/families/evidence';
import { LANGUAGES } from '../../../src/ladders/judges/v2/families/injection';
import { referenceBradleyTerry, stronglyConnected } from '../../../src/ladders/judges/v2/families/pairwise';
import { referenceFit } from '../../../src/ladders/judges/v2/families/turns';
import { moreWitness } from './witness-more';

/**
 * The witness: a version of the judges package written only to show that every deterministic item of the bank
 * can pass at once. It is test code, never the package: an executor climbing the ladder writes its own fixes
 * in packages/judges and does not read this file. Each override follows the spec its family states.
 */

// ---------------------------------------------------------------- the answer contract

function topLevelObjects(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let quote: string | null = null;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] as string;
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote || (quote === '“' && ch === '”')) quote = null;
      continue;
    }
    if (depth > 0 && (ch === '"' || ch === "'" || ch === '“')) quote = ch;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0) out.push(raw.slice(start, i + 1));
    }
  }
  return out;
}

function duplicateTopKeys(text: string): boolean {
  const keys: string[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const after = text.slice(j + 1).match(/^\s*:/);
      if (depth === 1 && after) keys.push(text.slice(i + 1, j));
      i = j;
    } else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
  }
  return new Set(keys).size !== keys.length;
}

/** Escapes a double quote inside a string value: one the next non-space character does not end. */
function escapeInnerQuotes(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (ch === '\\' && inString) {
      out += ch + (text[i + 1] ?? '');
      i += 1;
    } else if (ch === '"') {
      if (!inString) inString = true;
      else if (/^\s*[,:}\]]/.test(text.slice(i + 1)) || i === text.length - 1) inString = false;
      else {
        out += '\\"';
        continue;
      }
      out += ch;
    } else out += ch;
  }
  return out;
}

/** Strict JSON first; near-JSON repaired (docs/concepts/judges.md), and the repair said. */
function lenient(candidate: string): { value: unknown; repaired: boolean } | undefined {
  if (!/[:]/.test(candidate)) return undefined;
  let text = candidate
    .replace(/[“”]/g, '"')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
  if (!text.includes('"')) text = text.replace(/'/g, '"');
  for (const [attempt, repaired] of [
    [candidate, false],
    [text, true],
    [escapeInnerQuotes(text), true],
  ] as const) {
    try {
      if (duplicateTopKeys(attempt)) return undefined;
      return { value: JSON.parse(attempt), repaired };
    } catch {
      // the next attempt
    }
  }
  return undefined;
}

function contractOf(read: { value: unknown; repaired: boolean } | undefined): JudgeAnswer | undefined {
  const value = read?.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = { ...(value as Record<string, unknown>) };
  if (typeof v.outcome === 'string') v.outcome = v.outcome.toLowerCase();
  if (typeof v.score === 'string' && /^\s*\d*\.?\d+\s*$/.test(v.score)) v.score = Number(v.score);
  const parsed = judges.JudgeAnswer.safeParse(v);
  if (!parsed.success) return undefined;
  const a = parsed.data;
  if (
    a.score !== undefined &&
    ((a.outcome === 'pass' && a.score < 0.5) || (a.outcome === 'fail' && a.score > 0.5))
  )
    return undefined;
  return a;
}

export function parseAnswerText(raw: string): JudgeResult {
  const answers: { answer: JudgeAnswer; repaired: boolean }[] = [];
  for (const candidate of topLevelObjects(raw)) {
    const read = lenient(candidate);
    const answer = contractOf(read);
    if (!answer || !read) continue;
    const repaired =
      read.repaired ||
      (read.value as Record<string, unknown>).outcome !== answer.outcome ||
      typeof (read.value as Record<string, unknown>).score === 'string';
    answers.push({ answer, repaired });
  }
  if (answers.length === 0) return { answer: judges.inconclusive('unparseable answer'), raw, unparsed: true };
  if (new Set(answers.map((a) => a.answer.outcome)).size > 1) {
    return { answer: judges.inconclusive('two answers that disagree'), raw, unparsed: true };
  }
  const first = answers[0] as { answer: JudgeAnswer; repaired: boolean };
  return { answer: first.answer, raw, ...(first.repaired ? { repaired: true } : {}) } as JudgeResult;
}

function outcomeFromProbability(p: number, bounds: { passAt?: number; failAt?: number } = {}) {
  const passAt = bounds.passAt ?? 0.6;
  const failAt = bounds.failAt ?? 0.4;
  if (!(failAt < passAt)) throw new RangeError('failAt must be under passAt');
  if (!Number.isFinite(p) || p < 0 || p > 1) return 'inconclusive';
  return judges.outcomeFromProbability(p, bounds);
}

// ---------------------------------------------------------------- the prompt kit

const INVISIBLE = /[​-‏⁠-⁤﻿­᠎]/g;
const BREAKS = /\r\n|[\n\r\u2028\u2029\u0085\v\f]/g;

/**
 * Escapes data-tag lookalikes only: the text is read as seen (each character folded on its own, invisible ones
 * dropped) to find a tag, and only that tag's opening bracket is escaped in the text as written.
 */
function escapeData(text: string): string {
  const chars = [...text];
  let seen = '';
  const origin: number[] = [];
  chars.forEach((ch, i) => {
    if (/[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD\u180E]/.test(ch)) return;
    const folded = ch.normalize('NFKC');
    for (const f of folded.length === 1 ? folded : ch) {
      seen += f;
      origin.push(i);
    }
  });
  const hit = new Set<number>();
  for (const m of seen.matchAll(/<\s*\/?\s*(?:transcript_data|artifact_data|given_data|reference_data)\b/gi))
    hit.add(origin[m.index ?? 0] as number);
  return chars.map((ch, i) => (hit.has(i) ? '&lt;' : ch)).join('');
}

function renderEntry(entry: TranscriptEntry): string {
  const tool = entry.tool?.replace(BREAKS, ' ').replace(/[\]]/g, ')');
  const label = tool ? `${entry.role} ${tool}` : entry.role;
  return `[${label}] ${entry.text.replace(BREAKS, ' ⏎ ')}`;
}

function buildPrompt(request: JudgeRequest): { system: string; user: string } {
  const parts = [judges.renderRubric(request.criterion), ''];
  const given = request.given
    ? [
        request.given.stage ? `stage expected: ${request.given.stage}` : '',
        request.given.ledger && Object.keys(request.given.ledger).length > 0
          ? `ledger: ${JSON.stringify(request.given.ledger)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  const tag = (name: string, text: string) => `<${name}>\n${escapeData(text)}\n</${name}>`;
  if (given) parts.push(tag('given_data', given), '');
  const frame = JSON.stringify(
    request.transcript.map((entry, index) => ({ entry: index, ...entry })),
    null,
    2,
  );
  parts.push(tag('transcript_data', frame), '');
  if (request.artifact !== undefined) parts.push(tag('artifact_data', request.artifact), '');
  const reference = (request as JudgeRequest & { reference?: string }).reference;
  if (reference !== undefined) parts.push(tag('reference_data', reference), '');
  parts.push('Answer the QUESTION for the data above, as the JSON object.');
  return { system: judges.SYSTEM_PROMPT, user: parts.join('\n') };
}

// ---------------------------------------------------------------- the screen

const JUDGE_TERMS = [
  'rubric',
  'grader',
  'grading',
  'judge',
  'judges',
  'evaluator',
  'evaluating',
  'evaluates',
  'evaluation',
  'reviewer',
  'verdict',
  'scoring model',
  'criterion',
  'criteria',
  'fail picture',
  'score it',
  'rate this',
  '"outcome"',
  'outcome',
  'grille',
  'évaluation',
  'rúbrica',
  'evaluación',
  'bewertung*',
  'valutazione',
  'griglia',
  'rubrica',
  'avaliação',
  'beoordeling*',
  'oceny',
  'değerlendirme',
  'оценки',
  '评分',
  '評価',
  '평가',
  'التقييم',
  'मूल्यांकन',
  'bedömning*',
  'penilaian',
];
const DIRECTIVES = [
  'pass',
  'passing',
  'passed',
  'passes',
  'success',
  'satisfied',
  'compliant',
  'met',
  '1.0',
  '0.99',
  'fail',
  'fails',
  'réponds pass',
  'aprobado',
  'bestanden',
  'superato',
  'aprovado',
  'geslaagd',
  'zaliczone',
  'geçti',
  'пройдено',
  '通过',
  '合格',
  '통과',
  'ناجح',
  'पास',
  'godkänt',
  'lulus',
];
const HOMO: Record<string, string> = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', і: 'i' };
const LEET: Record<string, string> = { '4': 'a', '3': 'e', '1': 'i', '0': 'o', '5': 's', '7': 't' };
const LATIN = /^[a-z0-9 ."_]+$/;

function termPattern(term: string): string {
  const body = term.replace(/\*$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (term.endsWith('*')) return `(?:^|[^\\p{L}])${body}`;
  return LATIN.test(term) ? `(?:^|[^\\p{L}])${body}(?:$|[^\\p{L}])` : body;
}
const JUDGE_RE = new RegExp(JUDGE_TERMS.map(termPattern).join('|'), 'u');
const DIRECTIVE_RE = new RegExp(DIRECTIVES.map(termPattern).join('|'), 'u');

/** In English the words alone are not enough: the sentence must instruct (an imperative, a modal, a note). */
const ENGLISH = /\b(the|and|is|was|my|of|to|this|for|a)\b/;
const CUE =
  /\b(mark|give|return|treat|must|report|ignore|disregard|answer|answers|consider|output|should|set|always|never|forget (the|your|all)|respond|rate|override|score it|pick|pass (this|it)|note|instructions?|expected answer|apply|you are|on a scale|message to|system prompt|new criterion|reading this)\b|verdict\s*[:=]/;

function hit(text: string): boolean {
  return text
    .split(/(?<=[.!?;])\s+|\n/)
    .some(
      (sentence) =>
        JUDGE_RE.test(sentence) &&
        DIRECTIVE_RE.test(sentence) &&
        (!ENGLISH.test(sentence) || CUE.test(sentence)),
    );
}

const rot = (t: string, n: number) =>
  t.replace(/[a-z]/gi, (c) => {
    const a = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - a + n) % 26) + a);
  });

function decodings(text: string, depth = 0): string[] {
  const out = [text];
  for (const m of text.matchAll(/[A-Za-z0-9+/_-]{16,}={0,2}/g)) {
    const raw = Buffer.from(m[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const printable = [...raw].filter((c) => c >= ' ' || c === '\n').length / Math.max(1, raw.length);
    if (printable > 0.95 && raw.length >= 8) {
      out.push(raw);
      if (depth < 2) out.push(...decodings(raw, depth + 1));
    }
  }
  for (const m of text.matchAll(/0x([0-9a-f]{16,})/gi))
    out.push(Buffer.from(m[1] as string, 'hex').toString('utf8'));
  if (/%[0-9a-f]{2}/i.test(text)) {
    try {
      out.push(decodeURIComponent(text));
    } catch {
      // not URL encoded after all
    }
  }
  if (/&#\d+;/.test(text))
    out.push(text.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))));
  if (/\\u[0-9a-f]{4}/i.test(text))
    out.push(
      text.replace(/\\u([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16))),
    );
  const bin = text.match(/(?:[01]{8}\s?){4,}/);
  if (bin)
    out.push(
      Buffer.from(
        bin[0]
          .trim()
          .split(/\s+/)
          .map((b) => Number.parseInt(b, 2)),
      ).toString('utf8'),
    );
  return out;
}

function variants(text: string): string[] {
  const base = text.replace(INVISIBLE, '').normalize('NFKC');
  const out = new Set<string>();
  for (const d of decodings(base)) {
    const lower = d.toLowerCase();
    const folded = [...lower].map((c) => HOMO[c] ?? c).join('');
    const words = folded.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-/]+/g, ' ');
    const camel = d
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[_\-/]+/g, ' ');
    const leet = [...words].map((c) => LEET[c] ?? c).join('');
    const spaced = words
      .replace(/ {3}/g, '\ue000')
      .replace(/ /g, '')
      .replace(/\ue000/g, ' ');
    const dotted = words.replace(/(?<=\S)\.(?=\S)/g, '');
    for (const v of [lower, folded, words, camel, leet, spaced, dotted, [...words].reverse().join('')])
      out.add(v);
    if (d.length <= 4000) for (let n = 1; n < 26; n += 1) out.add(rot(words, n));
  }
  return [...out];
}

function screenData(request: JudgeRequest): { flagged: boolean; findings: { where: string }[] } {
  const places: [string, string][] = [
    ...request.transcript.map((e, i): [string, string] => [`transcript.${i}`, `${e.tool ?? ''} ${e.text}`]),
    ...(request.artifact === undefined ? [] : [['artifact', request.artifact] as [string, string]]),
    ...(request.given === undefined ? [] : [['given', JSON.stringify(request.given)] as [string, string]]),
  ];
  const findings: { where: string }[] = [];
  for (const [where, text] of places) if (variants(text).some(hit)) findings.push({ where });
  // An instruction split over entries: read the transcript as one text too.
  if (findings.length === 0 && variants(request.transcript.map((e) => e.text).join(' ')).some(hit)) {
    findings.push({ where: 'transcript' });
  }
  return { flagged: findings.length > 0, findings };
}

void LANGUAGES;

// ---------------------------------------------------------------- the council

type Config = judges.CouncilConfig & {
  size?: number;
  weights?: Record<string, number>;
  cascade?: boolean | { threshold?: number; thresholds?: Record<string, number> };
};

function createCouncil(config: Config) {
  const size = config.size ?? 3;
  const fail = (m: string) => {
    throw new judges.CouncilConfigError(m);
  };
  if (!Number.isInteger(size) || size < 1) fail('size must be a whole number from 1');
  const cascade =
    config.cascade === true
      ? { threshold: 0.9 }
      : config.cascade
        ? { threshold: config.cascade.threshold ?? 0.9, thresholds: config.cascade.thresholds }
        : undefined;
  for (const t of [cascade?.threshold, ...Object.values(cascade?.thresholds ?? {})]) {
    if (t !== undefined && !(t > 0.5 && t <= 1)) fail(`a cascade threshold must be in (0.5, 1], not ${t}`);
  }
  if (!config.agentFamily.trim()) fail('the agent family is not set');
  for (const j of config.judges)
    if (judges.sameFamily(j.family, config.agentFamily)) fail(`judge ${j.id} is from the agent's family`);
  const classes =
    config.mode === 'system1' ? ['system1'] : config.mode === 'llm' ? ['system2'] : ['system1', 'system2'];
  for (const cls of classes)
    if (config.judges.filter((j) => j.cls === cls).length < size)
      fail(`mode ${config.mode} needs ${size} ${cls} judges`);
  const cheapest = (cls: string) =>
    config.judges
      .filter((j) => j.cls === cls)
      .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))
      .slice(0, size);
  const vote = async (
    judge: JudgeClient,
    request: JudgeRequest,
    budget: judges.Budget,
    counter: { errors: number; cost: number },
  ): Promise<Vote> => {
    const name = budget === 'large' ? `${judge.id}@large` : judge.id;
    counter.cost += judge.cost;
    try {
      let result = await judge.judge({ ...request, budget });
      if (result.unparsed && budget === 'normal') {
        counter.cost += judge.cost;
        result = await judge.judge({ ...request, budget: 'large' });
      }
      return {
        judge: name,
        outcome: result.answer.outcome,
        ...(result.answer.score === undefined ? {} : { score: result.answer.score }),
        reasoning: result.answer.reasoning,
      };
    } catch (cause) {
      counter.errors += 1;
      return { judge: name, outcome: 'inconclusive', reasoning: `no answer: ${String(cause)}` };
    }
  };
  const round = async (
    request: JudgeRequest,
    cls: string,
    members: JudgeClient[],
    budget: judges.Budget,
    useCascade: boolean,
    counter: { errors: number; cost: number },
  ) => {
    const votes: Vote[] = [];
    let cascaded = false;
    if (useCascade && cascade) {
      const [cheap, ...rest] = members;
      const first = await vote(cheap as JudgeClient, request, budget, counter);
      votes.push(first);
      const threshold = cascade.thresholds?.[(cheap as JudgeClient).id] ?? cascade.threshold;
      if (
        first.outcome === 'pass' &&
        first.score !== undefined &&
        first.score >= threshold &&
        !screenData(request).flagged
      )
        cascaded = true;
      else for (const j of rest) votes.push(await vote(j, request, budget, counter));
    } else for (const j of members) votes.push(await vote(j, request, budget, counter));
    const weights = config.weights
      ? Object.fromEntries(
          Object.entries(config.weights).flatMap(([k, w]) => [
            [k, w],
            [`${k}@large`, w],
          ]),
        )
      : undefined;
    const outcome = cascaded ? 'pass' : bankMajority(votes, weights ? { weights } : {});
    return { cls, budget, votes, outcome, cascaded };
  };
  return {
    mode: config.mode,
    agentFamily: config.agentFamily,
    assignmentFor: (criterion: string) => {
      const cls = config.mode === 'llm' ? 'system2' : 'system1';
      return { criterion, cls, judges: cheapest(cls).map((j) => j.id), rejudge: [], source: 'default' };
    },
    async judge(request: JudgeRequest): Promise<CouncilResult & { cost: number }> {
      const counter = { errors: 0, cost: 0 };
      const cls = config.mode === 'llm' ? 'system2' : 'system1';
      const rounds = [await round(request, cls, cheapest(cls), 'normal', true, counter)];
      let decided = rounds[0]?.outcome === 'split' ? undefined : rounds[0];
      if (!decided && config.mode === 'hybrid') {
        const second = await round(request, 'system2', cheapest('system2'), 'normal', false, counter);
        rounds.push(second);
        if (second.outcome !== 'split') decided = second;
      }
      if (!decided) {
        const last = await round(request, cls, cheapest(cls), 'large', false, counter);
        rounds.push(last);
        if (last.outcome !== 'split') decided = last;
      }
      const outcome = (decided ? decided.outcome : 'inconclusive') as judges.JudgeOutcome;
      const agreeing = (decided?.votes ?? []).filter((v) => v.outcome === outcome && v.score !== undefined);
      return {
        criterion: request.criterion.name,
        outcome,
        cls: (decided?.cls ?? cls) as judges.JudgeClass,
        votes: rounds.flatMap((r) => r.votes),
        rounds: rounds.map((r) => ({
          ...r,
          cls: r.cls as judges.JudgeClass,
          outcome: r.outcome as judges.RoundOutcome,
        })),
        split: rounds[0]?.outcome === 'split',
        cascaded: rounds[0]?.cascaded ?? false,
        errors: counter.errors,
        cost: counter.cost,
        ...(agreeing.length > 0
          ? { score: agreeing.reduce((s, v) => s + (v.score as number), 0) / agreeing.length }
          : {}),
        log: rounds.map(
          (r) =>
            `${r.cls}: ${r.votes.map((v) => `${v.judge} ${v.outcome}`).join(', ')}; ${r.cascaded ? 'pass, the cheapest judge was sure' : r.outcome}`,
        ),
      };
    },
  };
}

function majority(
  votes: readonly Vote[],
  options?: number | { weights?: Record<string, number>; families?: Record<string, string> },
) {
  const out = bankMajority(votes, options);
  if (out === 'refused') throw new RangeError('a weight must be finite and not negative');
  return out;
}

async function judgeRepeated(client: JudgeClient, request: JudgeRequest, k: number) {
  if (!Number.isInteger(k) || k < 1) throw new RangeError('k must be a whole number from 1');
  const outcomes: string[] = [];
  for (let i = 0; i < k; i += 1) outcomes.push((await client.judge(request)).answer.outcome);
  return { outcomes, consistent: outcomes.every((o) => o === outcomes[0]) && outcomes[0] !== 'inconclusive' };
}

// ---------------------------------------------------------------- clients, cassettes, criteria, check

async function loadCassette(path: string): Promise<Cassette> {
  const cassette = await judges.loadCassette(path);
  const ids = cassette.judges.map((j) => j.id);
  if (new Set(ids).size !== ids.length) throw new judges.JudgeError('config', 'a judge is listed twice');
  for (const e of cassette.entries) {
    if (!ids.includes(e.judge))
      throw new judges.JudgeError('config', `an entry of the unlisted judge ${e.judge}`);
    const held = [
      e.answer !== undefined,
      e.raw !== undefined && e.answer === undefined,
      e.error !== undefined,
    ].filter(Boolean).length;
    if (held !== 1 || (e.error !== undefined && (e.answer !== undefined || e.raw !== undefined)))
      throw new judges.JudgeError('config', 'an entry must hold one of answer, raw or error');
    if (e.answer !== undefined && !judges.JudgeAnswer.safeParse(e.answer).success)
      throw new judges.JudgeError('config', 'an answer breaks the contract');
    if (!/^[0-9a-f]{12}$/.test(e.key)) throw new judges.JudgeError('config', 'a key is not a request hash');
  }
  return cassette;
}

function playerClient(cassette: Cassette, judgeId: string): JudgeClient {
  const base = judges.playerClient(cassette, judgeId);
  const index = new Map<string, Cassette['entries']>();
  for (const e of cassette.entries)
    if (e.judge === judgeId) index.set(e.key, [...(index.get(e.key) ?? []), e]);
  const used = new Map<string, number>();
  // The key as the package's own player computes it: the request, the prompt and the recorded client.
  const judge = cassette.judges.find((candidate) => candidate.id === judgeId);
  return {
    ...base,
    async judge(request) {
      const key = requestKey(request, judge);
      const matches = index.get(key);
      if (!matches) throw new judges.JudgeError('cassette_miss', `no recording for ${key}`);
      const i = used.get(key) ?? 0;
      used.set(key, i + 1);
      const e = matches[Math.min(i, matches.length - 1)] as Cassette['entries'][number];
      if (e.error !== undefined) throw new judges.JudgeError('http', e.error);
      if (e.answer !== undefined) return judges.parseAnswerValue(e.answer, e.raw);
      return parseAnswerText(e.raw ?? '');
    },
  };
}

const foldText = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

async function loadCriteria(dir: string): Promise<CriteriaLoad> {
  const got = await judges.loadCriteria(dir);
  const issues = [...got.issues];
  const criteria = got.criteria.filter((c) => {
    const slice = (f: typeof c.fixtures.pass) =>
      foldText(
        JSON.stringify([f.transcript.map((e) => [e.role, e.tool, foldText(e.text)]), f.artifact ?? '']),
      );
    if (slice(c.fixtures.pass) === slice(c.fixtures.fail)) {
      issues.push({
        path: c.path,
        message: 'the fixtures are the same slice once spacing and case are folded',
      });
      return false;
    }
    if (c.def.rubric.length > 2000) {
      issues.push({
        path: c.path,
        message: `the rubric is ${c.def.rubric.length} characters, over 2000: too long`,
      });
      return false;
    }
    if (foldText(c.def.pass ?? '') === foldText(c.def.fail ?? '')) {
      issues.push({ path: c.path, message: 'the PASS and FAIL pictures say the same' });
      return false;
    }
    return true;
  });
  return { criteria, issues };
}

function combineVerdicts(machine: judges.JudgeResult[] | never[], judged: never[]) {
  if (machine.length + judged.length === 0) return { verdicts: [], pass: false };
  const ids = judged.map((v: { id: string }) => v.id);
  if (new Set(ids).size !== ids.length) throw new Error('two judge verdicts share an id');
  return judges.combineVerdicts(machine as never, judged);
}

function judgeCheck(council: judges.Council, options?: judges.JudgeCheckOptions) {
  const safe: judges.Council = {
    ...council,
    async judge(request, cls) {
      try {
        return await council.judge(request, cls);
      } catch (cause) {
        return {
          criterion: request.criterion.name,
          outcome: 'inconclusive',
          cls: 'system1',
          votes: [],
          rounds: [],
          split: false,
          cascaded: false,
          errors: 1,
          log: [`the council failed: ${cause instanceof Error ? cause.message : String(cause)}`],
        };
      }
    },
  };
  const inner = judges.judgeCheck(safe, options);
  return {
    ...inner,
    async evaluate(ctx: Parameters<typeof inner.evaluate>[0]) {
      const out = await inner.evaluate(ctx);
      const seen = new Map<string, number>();
      return out.map((v) => {
        const n = seen.get(v.id) ?? 0;
        seen.set(v.id, n + 1);
        return n === 0 ? v : { ...v, id: `${v.id}.${n + 1}` };
      });
    },
  };
}

function summarizeDiff(diff: Parameters<typeof judges.summarizeDiff>[0]) {
  return judges.summarizeDiff(diff).replace(BREAKS, ' ');
}

// ---------------------------------------------------------------- rubric lint

function lintCriterion(c: CriterionText): { issues: { code: string }[] } {
  const codes: string[] = [];
  const r = c.rubric;
  const lower = r.toLowerCase();
  const word = (list: string[], text = lower) => list.some((w) => new RegExp(`\\b${w}\\b`).test(text));
  if (r.trim() === '') codes.push('empty-rubric');
  if ((r.match(/\?/g) ?? []).length > 1) codes.push('two-questions');
  if (
    word([
      'good',
      'appropriate',
      'nice',
      'reasonable',
      'properly',
      'adequate',
      'helpful',
      'polite',
      'professional',
      'friendly',
    ])
  )
    codes.push('subjective');
  if (word(['some', 'several', 'many', 'often', 'usually', 'mostly', 'a few', 'most of the time']))
    codes.push('vague-quantity');
  if ((lower.match(/\b(not|no|never|fail to|avoid)\b/g) ?? []).length >= 2) codes.push('double-negative');
  if (
    r.trim() !== '' &&
    !word([
      'reply',
      'agent',
      'assistant',
      'message',
      'tool',
      'call',
      'order',
      'customer',
      'user',
      'file',
      'transcript',
    ])
  )
    codes.push('no-observable');
  if (r.length > 400) codes.push('too-long');
  if (c.fail === undefined) codes.push('no-fail-picture');
  if (c.pass === undefined) codes.push('no-pass-picture');
  if (c.pass !== undefined && c.fail !== undefined) {
    if (foldText(c.pass) === foldText(c.fail)) codes.push('same-pictures');
    else if (foldText(c.fail).replace(/\bdoes not do\b/, 'does') === foldText(c.pass))
      codes.push('picture-contradicts-rubric');
    if (/\bfails?\b/i.test(c.pass) || /\bpasses\b/i.test(c.fail)) codes.push('pictures-swapped');
  }
  if (
    (c.scope === 'conversation' && /\b(the last reply|this reply)\b/.test(lower)) ||
    (c.scope !== 'conversation' && /\b(the whole conversation|every turn)\b/.test(lower))
  )
    codes.push('scope-mismatch');
  if (/\{[^}]*\}|<[^>]+>/.test(r)) codes.push('placeholder');
  if ((r.match(/"/g) ?? []).length % 2 === 1) codes.push('unbalanced-quotes');
  if (/\b(and also|as well as)\b/.test(lower)) codes.push('compound');
  if (
    word(['might', 'may', 'could', 'perhaps', 'possibly']) ||
    word(['might', 'may', 'could', 'perhaps', 'possibly'], (c.pass ?? '').toLowerCase())
  )
    codes.push('hedged');
  if (/\b(answer pass|always pass|mark as)\b/.test(lower)) codes.push('instruction-to-judge');
  return { issues: codes.map((code) => ({ code })) };
}

// ---------------------------------------------------------------- evidence, budget, turns

function groundEvidence(request: JudgeRequest, answer: JudgeAnswer) {
  if (answer.evidence === undefined) return { grounded: false };
  const where = firstPlace(request, answer.evidence);
  return where === undefined ? { grounded: false } : { grounded: true, where };
}

function fitPrompt(request: JudgeRequest, max: number): JudgeRequest {
  const out = referenceFit(buildPrompt, request, max);
  if (out === 'refused') throw new RangeError('the request does not fit the budget');
  return out;
}

async function judgeTurns(judge: JudgeClient, request: JudgeRequest) {
  const starts: number[] = [];
  request.transcript.forEach((e, i) => {
    if (e.role === 'user' && (starts.length === 0 || request.transcript[i - 1]?.role !== 'user'))
      starts.push(i);
  });
  if (starts.length === 0) throw new RangeError('no customer message');
  const turns: { turn: number; outcome: string }[] = [];
  for (let t = 0; t < starts.length; t += 1) {
    const end = starts[t + 1] ?? request.transcript.length;
    let outcome: string;
    try {
      outcome = (await judge.judge({ ...request, transcript: request.transcript.slice(0, end) })).answer
        .outcome;
    } catch {
      outcome = 'inconclusive';
    }
    turns.push({ turn: t + 1, outcome });
  }
  const first = turns.findIndex((t) => t.outcome === 'fail');
  const recovered = first < 0 ? -1 : turns.findIndex((t, i) => i > first && t.outcome === 'pass');
  return {
    turns,
    outcome: turns.some((t) => t.outcome === 'fail')
      ? 'fail'
      : turns.some((t) => t.outcome === 'inconclusive')
        ? 'inconclusive'
        : 'pass',
    ...(first < 0 ? {} : { firstFailing: first + 1 }),
    ...(recovered < 0 ? {} : { recoveredAt: recovered + 1 }),
  };
}

// ---------------------------------------------------------------- pairwise

type PairJudge = { judgePair(r: unknown): Promise<string> };
async function comparePair(
  judge: PairJudge,
  r: { criterion: CriterionText; a: TranscriptEntry[]; b: TranscriptEntry[] },
) {
  const ask = async (first: TranscriptEntry[], second: TranscriptEntry[]) => {
    try {
      return await judge.judgePair({ criterion: r.criterion, first, second });
    } catch {
      return 'inconclusive';
    }
  };
  const one = await ask(r.a, r.b);
  const two = await ask(r.b, r.a);
  const map1 = one === 'first' ? 'a' : one === 'second' ? 'b' : one;
  const map2 = two === 'first' ? 'b' : two === 'second' ? 'a' : two;
  return { winner: map1 === map2 && map1 !== 'inconclusive' ? map1 : 'inconclusive', calls: 2 };
}

function buildPairPrompt(r: {
  criterion: CriterionText;
  first: TranscriptEntry[];
  second: TranscriptEntry[];
}) {
  const guard = (t: string) => escapeData(t).replace(/<(\s*\/?\s*(?:first_data|second_data)\b)/gi, '&lt;$1');
  const block = (tag: string, entries: TranscriptEntry[]) =>
    `<${tag}>\n${entries.map((e) => guard(renderEntry(e))).join('\n')}\n</${tag}>`;
  return {
    system: judges.SYSTEM_PROMPT,
    user: [
      judges.renderRubric(r.criterion),
      '',
      block('first_data', r.first),
      '',
      block('second_data', r.second),
      '',
      'Which candidate passes better?',
    ].join('\n'),
  };
}

function bradleyTerry(wins: number[][]): number[] {
  if (!stronglyConnected(wins)) throw new RangeError('the comparison graph is not strongly connected');
  return referenceBradleyTerry(wins);
}

function eloUpdate(ra: number, rb: number, score: number, k = 32): number[] {
  const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
  return [ra + k * (score - ea), rb + k * (1 - score - (1 - ea))];
}

function findCycles(wins: number[][]): number[][] {
  const n = wins.length;
  const beats = (i: number, j: number) => (wins[i]?.[j] ?? 0) > (wins[j]?.[i] ?? 0);
  const out: number[][] = [];
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j < n; j += 1)
      for (let k = 0; k < n; k += 1)
        if (i < j && i < k && j !== k && beats(i, j) && beats(j, k) && beats(k, i)) out.push([i, j, k]);
  return out.sort((a, b) => a.join(',').localeCompare(b.join(',')));
}

// ---------------------------------------------------------------- calibration

function agreementInterval(agree: number, n: number) {
  const ci = clopperPearson(agree, n);
  return { lower: ci.lower, upper: ci.upper };
}

async function calibrate(config: Parameters<typeof judges.calibrate>[0]) {
  const report = await judges.calibrate(config);
  const run = new Set(config.criteria.map((c) => c.def.name));
  const slice = (t: unknown) => JSON.stringify(t);
  return {
    ...report,
    unknownLabels: [...config.labels.keys()].filter((name) => !run.has(name)),
    criteria: report.criteria.map((c) => {
      const loaded = config.criteria.find((x) => x.def.name === c.criterion);
      const blocks = config.labels.get(c.criterion) ?? [];
      const conflicts: string[][] = [];
      const firstBySlice = new Map<string, (typeof blocks)[number]>();
      for (const b of blocks) {
        const key = slice(b.transcript);
        const a = firstBySlice.get(key);
        if (!a) firstBySlice.set(key, b);
        else if (a.label !== b.label) conflicts.push([a.id, b.id]);
      }
      const fixtures = loaded
        ? [slice(loaded.fixtures.pass.transcript), slice(loaded.fixtures.fail.transcript)]
        : [];
      const leaks = blocks.filter((b) => fixtures.includes(slice(b.transcript))).map((b) => b.id);
      const few = ['pass', 'fail'].some((label) => blocks.filter((b) => b.label === label).length < 5);
      const verdicts = c.judges.map((j) =>
        j.labels.blocks.map((b) => b.judged as 'pass' | 'fail' | 'inconclusive'),
      );
      return {
        ...c,
        ...(verdicts.length > 1 && blocks.length > 0 ? { fleissKappa: fleissOf(verdicts) } : {}),
        labelConflicts: conflicts,
        fixtureLeaks: leaks,
        warnings: blocks.length > 0 && few ? ['few-labels'] : [],
        judges: c.judges.map((j) => {
          const { n, agree, blocks: judged } = j.labels;
          const classes = new Set(judged.map((b) => b.label));
          const po = n === 0 ? 0 : agree / n;
          const pi =
            n === 0
              ? 0
              : (judged.filter((b) => b.label === 'pass').length +
                  judged.filter((b) => b.judged === 'pass').length) /
                (2 * n);
          const pe = 2 * pi * (1 - pi);
          const { kappa, ...rest } = j.labels;
          return {
            ...j,
            labels: {
              ...rest,
              ...(classes.size < 2 ? {} : kappa === undefined ? {} : { kappa }),
              // The page names a Wilson 95% interval: the package's own report.
              agreement: j.labels.agreement,
              pabak: 2 * po - 1,
              ac1: (po - pe) / (1 - pe),
              ...(n === 0
                ? {}
                : {
                    metrics: metricsOf(
                      judged.map((b) => b.label),
                      judged.map((b) => b.judged as 'pass' | 'fail' | 'inconclusive'),
                    ),
                  }),
            },
          };
        }),
      };
    }),
  };
}

// ---------------------------------------------------------------- clients that read every provider shape

async function postWitness(url: string, body: unknown, options: ClientOptions): Promise<unknown> {
  const fetchFn = options.fetch ?? ((u: string, init: RequestInit) => fetch(u, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const max = options.maxRetries ?? 2;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch (cause) {
        const events = text.split('\n').filter((line) => line.startsWith('data:'));
        if (events.length === 0) throw cause;
        return JSON.parse((events.at(-1) as string).slice(5).trim());
      }
    }
    const retryable = [408, 409, 429, 500, 502, 503, 504, 529].includes(response.status);
    if (!retryable || attempt >= max)
      throw new judges.JudgeError('http', `${url} answered ${response.status}`, { status: response.status });
    const after = response.headers.get('retry-after');
    let wait = 1000 * 2 ** attempt;
    if (after)
      wait = /^\d+$/.test(after.trim()) ? Number(after) * 1000 : Math.max(0, Date.parse(after) - Date.now());
    await sleep(Math.min(30_000, wait));
  }
}

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const declinedResult = (raw: unknown): JudgeResult => ({
  answer: judges.inconclusive('the provider declined'),
  raw: JSON.stringify(raw),
});

function chatClient(
  id: string,
  family: string,
  read: (payload: unknown, request: JudgeRequest) => JudgeResult,
  body: (request: JudgeRequest) => unknown,
) {
  return (options: ClientOptions = {}): JudgeClient => ({
    id: options.id ?? id,
    family,
    cls: 'system2',
    cost: 10,
    async judge(request) {
      return read(await postWitness(`https://${family}.example.com`, body(request), options), request);
    },
  });
}

function readChatText(text: string, request: JudgeRequest): JudgeResult {
  if (request.answerContract === 'legacy') return parseAnswerText(text);
  let value: { checks?: { id: string; reasoning: string; evidence: string | null; met: boolean | null }[] };
  try {
    value = JSON.parse(text);
  } catch {
    return { raw: text, answer: judges.inconclusive('invalid JSON'), unparsed: true };
  }
  const requirements = request.requirements ?? [
    { id: request.criterion.name, requirement: request.criterion.rubric },
  ];
  const checks = value.checks;
  if (!checks || requirements.some((r) => checks.filter((c) => c.id === r.id).length !== 1))
    return { raw: text, answer: judges.inconclusive('missing or repeated requirement'), unparsed: true };
  const known = checks.filter((c) => requirements.some((r) => r.id === c.id));
  if (
    known.some(
      (c) =>
        c.met === true &&
        (!c.evidence || !request.transcript.some((entry) => entry.text.includes(c.evidence as string))),
    )
  )
    return { raw: text, answer: judges.inconclusive('ungrounded evidence'), unparsed: true };
  return {
    raw: text,
    answer: {
      outcome: known.some((c) => c.met === false)
        ? 'fail'
        : known.some((c) => c.met === null)
          ? 'inconclusive'
          : 'pass',
      reasoning: known.map((c) => c.reasoning).join('; '),
    },
  };
}

const openaiWitness = chatClient(
  'openai',
  'openai',
  (payload, request) => {
    const choice = rec((rec(payload).choices as unknown[] | undefined)?.[0]);
    if (Object.keys(choice).length === 0)
      return { answer: judges.inconclusive('no choice'), raw: JSON.stringify(payload), unparsed: true };
    if (choice.finish_reason === 'content_filter') return declinedResult(payload);
    const message = rec(choice.message);
    if (typeof message.refusal === 'string' && message.refusal) return declinedResult(payload);
    const text =
      typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map((p) => (typeof rec(p).text === 'string' ? rec(p).text : '')).join('')
          : '';
    if (!text && Array.isArray(message.tool_calls))
      return parseAnswerText(String(rec(rec(message.tool_calls[0]).function).arguments ?? ''));
    if (!text && typeof choice.text === 'string') return parseAnswerText(choice.text);
    if (choice.finish_reason === 'length')
      return { answer: judges.inconclusive('cut'), raw: text, unparsed: true };
    return readChatText(text, request);
  },
  (request) => ({
    temperature: 0,
    max_tokens: judges.MAX_TOKENS[request.budget ?? 'normal'],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'answer',
        schema: request.answerContract === 'legacy' ? ANSWER_SCHEMA : LEDGER_SCHEMA,
      },
    },
    messages: buildPrompt(request),
  }),
);

const anthropicWitness = chatClient(
  'anthropic',
  'anthropic',
  (payload, request) => {
    const p = rec(payload);
    if (p.stop_reason === 'refusal') return declinedResult(payload);
    const blocks = Array.isArray(p.content) ? p.content.map(rec) : [];
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => String(b.text))
      .join('');
    const tool = blocks.find((b) => b.type === 'tool_use');
    if (!text && tool) return judges.parseAnswerValue(tool.input);
    return readChatText(text, request);
  },
  (request) => ({
    temperature: 0,
    max_tokens: judges.MAX_TOKENS[request.budget ?? 'normal'],
    messages: buildPrompt(request),
  }),
);

const googleWitness = chatClient(
  'google',
  'google',
  (payload, request) => {
    const p = rec(payload);
    const candidate = rec((p.candidates as unknown[] | undefined)?.[0]);
    if (Object.keys(candidate).length === 0) {
      return rec(p.promptFeedback).blockReason
        ? declinedResult(payload)
        : { answer: judges.inconclusive('no candidate'), raw: JSON.stringify(payload), unparsed: true };
    }
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION')
      return declinedResult(payload);
    const parts = Array.isArray(rec(candidate.content).parts)
      ? (rec(candidate.content).parts as unknown[]).map(rec)
      : [];
    const call = parts.find((part) => rec(part.functionCall).args !== undefined);
    if (call && !parts.some((part) => typeof part.text === 'string'))
      return judges.parseAnswerValue(rec(call.functionCall).args);
    return readChatText(
      parts
        .filter((part) => part.thought !== true)
        .map((part) => String(part.text ?? ''))
        .join(''),
      request,
    );
  },
  (request) => ({
    generationConfig: {
      temperature: 0,
      responseSchema: request.answerContract === 'legacy' ? ANSWER_SCHEMA : GOOGLE_LEDGER_SCHEMA,
    },
    contents: buildPrompt(request),
  }),
);

function probabilityResult(value: unknown, raw: unknown): JudgeResult {
  const p =
    typeof value === 'string' && /^\s*\d*\.?\d+\s*%\s*$/.test(value)
      ? Number(value.replace('%', '')) / 100
      : typeof value === 'string' && /^\s*\d*\.?\d+\s*$/.test(value)
        ? Number(value)
        : value;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1)
    return { answer: judges.inconclusive('no probability'), raw: JSON.stringify(raw), unparsed: true };
  return {
    answer: { outcome: outcomeFromProbability(p) as judges.JudgeOutcome, score: p, reasoning: 'probability' },
    raw: JSON.stringify(raw),
  };
}

function systemOne(id: string, family: string, read: (payload: unknown) => JudgeResult) {
  return (options: ClientOptions = {}): JudgeClient => ({
    id: options.id ?? id,
    family,
    cls: 'system1',
    cost: 1,
    async judge(request) {
      return read(
        await postWitness(`https://${id}.example.com`, { input: buildPrompt(request).user }, options),
      );
    },
  });
}

const jevWitness = systemOne('jev', 'jev', (payload) =>
  probabilityResult(rec(rec(rec(payload).answers).verdict).noul, payload),
);
const decisionsWitness = systemOne('openai-decisions', 'openai', (payload) => {
  const answers = rec(payload).answers;
  const verdict = Array.isArray(answers)
    ? rec(answers.map(rec).find((a) => a.name === 'verdict'))
    : rec(rec(answers).verdict);
  if (verdict.type === 'refusal') return declinedResult(payload);
  return probabilityResult(verdict.probability, payload);
});

const LEDGER_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          reasoning: { type: 'string' },
          evidence: { type: ['string', 'null'] },
          met: { type: ['boolean', 'null'] },
        },
        required: ['id', 'reasoning', 'evidence', 'met'],
      },
    },
  },
  required: ['checks'],
};

/** Gemini takes one type plus nullable: a null type or a type list is a 400. */
const GOOGLE_LEDGER_SCHEMA = {
  ...LEDGER_SCHEMA,
  properties: {
    checks: {
      ...LEDGER_SCHEMA.properties.checks,
      items: {
        ...LEDGER_SCHEMA.properties.checks.items,
        properties: {
          ...LEDGER_SCHEMA.properties.checks.items.properties,
          evidence: { type: 'string', nullable: true },
          met: { type: 'boolean', nullable: true },
        },
      },
    },
  },
};

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] },
    score: { type: 'number' },
    reasoning: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['outcome', 'reasoning'],
};

function createHttpJudge(options: ClientOptions & { url: string; family: string }): JudgeClient {
  return {
    id: options.id ?? 'http',
    family: options.family,
    cls: 'system2',
    cost: 10,
    async judge(request) {
      const payload = rec(await postWitness(options.url, { request, prompt: buildPrompt(request) }, options));
      // The body is the answer contract: a wrapped body breaks it.
      return judges.parseAnswerValue(payload);
    },
  };
}

async function saveCassette(path: string, cassette: Cassette): Promise<void> {
  const entries = [...cassette.entries].sort(
    (a, b) => a.judge.localeCompare(b.judge) || a.key.localeCompare(b.key),
  );
  return judges.saveCassette(path, { ...cassette, entries });
}

function mergeCassettes(a: Cassette, b: Cassette): Cassette {
  const judgesList = [...a.judges, ...b.judges.filter((j) => !a.judges.some((k) => k.id === j.id))];
  for (const e of b.entries) {
    const twin = a.entries.find((x) => x.judge === e.judge && x.key === e.key);
    if (twin && JSON.stringify(twin.answer) !== JSON.stringify(e.answer))
      throw new Error(`key ${e.key} holds two answers`);
  }
  return {
    version: 1,
    judges: judgesList,
    entries: [
      ...a.entries,
      ...b.entries.filter((e) => !a.entries.some((x) => x.judge === e.judge && x.key === e.key)),
    ],
  };
}

function pruneCassette(cassette: Cassette, keys: readonly string[]): Cassette {
  return { ...cassette, entries: cassette.entries.filter((e) => keys.includes(e.key)) };
}

/** The request key, with the reference answer hashed too. */
function requestKey(request: JudgeRequest, ...rest: unknown[]): string {
  const reference = (request as JudgeRequest & { reference?: string }).reference;
  const key = judges.requestKey as (r: JudgeRequest, ...more: unknown[]) => string;
  return reference === undefined
    ? key(request, ...rest)
    : key({ ...request, artifact: `${request.artifact ?? ''}\n[reference] ${reference}` }, ...rest);
}

/** postJson with every echoed header value redacted, whatever its length. */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: Parameters<typeof judges.postJson>[3] = {},
): Promise<unknown> {
  try {
    return await judges.postJson(url, headers, body, options);
  } catch (cause) {
    if (!(cause instanceof judges.JudgeError)) throw cause;
    let said = cause.message;
    for (const value of Object.values(headers)) {
      for (const secret of [value, value.replace(/^Bearer\s+/i, '')]) {
        if (secret.length > 0) said = said.split(secret).join('[redacted]');
      }
    }
    throw new judges.JudgeError(cause.code, said, {
      ...(cause.status === undefined ? {} : { status: cause.status }),
      retryable: cause.retryable,
    });
  }
}

/** The judges package with the witness's overrides. */
export function witnessApi(): JudgesApi {
  return {
    ...realApi,
    ...moreWitness,
    parseAnswerText,
    outcomeFromProbability,
    escapeData,
    buildPrompt,
    screenData,
    createCouncil,
    majority,
    judgeRepeated,
    createOpenAiJudge: openaiWitness,
    createAnthropicJudge: anthropicWitness,
    createGoogleJudge: googleWitness,
    createJevJudge: jevWitness,
    createHttpJudge,
    postJson,
    requestKey,
    saveCassette,
    mergeCassettes,
    pruneCassette,
    createOpenAiDecisionsJudge: decisionsWitness,
    loadCassette,
    playerClient,
    loadCriteria,
    combineVerdicts,
    judgeCheck,
    summarizeDiff,
    lintCriterion,
    groundEvidence,
    fitPrompt,
    judgeTurns,
    comparePair,
    buildPairPrompt,
    bradleyTerry,
    eloUpdate,
    findCycles,
    agreementInterval,
    calibrate,
  };
}
