#!/usr/bin/env node
// Labels the condition spans a span-collector run found and writes the cassette the variables measure replays.
//
//   node --import tsx tools/variables-label-spans.mjs --sha <commit> --spans <dir of variables-spans-N artifacts> --out <file>
//     --usd-per-mtok-in <rate> --usd-per-mtok-out <rate> [--cap <usd, default 2>] [--total-file <file>] [--total-cap <usd, default 8>]
//     [--known <cassette file>] [--batch <spans per request, default 12>]
// Writes <out>.report.json with usage, truncations and subject-choice failures, including on failure. A subject
// answer outside its schema gets one retry; a second failure aborts without writing a partial cassette.
//
// The key is read from ~/.nexus-secrets/anthropic-driftbench.key and is never printed. Each distinct span is labelled
// once; the cassette holds one JSON line per span, keyed by the span text with each run of white space folded to one space
// (the collector writes the spans folded, and the adapter folds a clause before it looks the label up). The cost is computed from the token
// counts every response reports, at the rates given on the command line, and the run stops before it passes a cap.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBJECT_CHOICE_SYSTEM, spanLabelSystem } from '../packages/generate/src/feed/span-label-request.ts';
import {
  requestSubjectChoice,
  subjectChoiceMaxTokens,
} from '../packages/generate/src/feed/subject-choice-answer.ts';
import { createSubjectReconciler } from '../packages/generate/src/feed/subject-choices.ts';

const MODEL = 'claude-haiku-5-5';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith('--')) pairs.push([token.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const need = (name) => {
  if (args[name] === undefined) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return args[name];
};
const BATCH = Number(args.batch ?? 12);
const sha = need('sha');
const spansDir = need('spans');
const outFile = need('out');
const rateIn = Number(need('usd-per-mtok-in'));
const rateOut = Number(need('usd-per-mtok-out'));
const cap = Number(args.cap ?? 2);
const totalCap = Number(args['total-cap'] ?? 8);
const totalFile = args['total-file'];
const knownFile = args.known;
if (![rateIn, rateOut, cap, totalCap].every((x) => Number.isFinite(x) && x > 0)) {
  console.error('rates and caps must be positive numbers');
  process.exit(2);
}
const spentBefore =
  totalFile && existsSync(totalFile) ? Number(readFileSync(totalFile, 'utf8').trim()) || 0 : 0;

const key = readFileSync(join(homedir(), '.nexus-secrets', 'anthropic-driftbench.key'), 'utf8').trim();

const spans = new Set();
for (const entry of readdirSync(spansDir, { recursive: true })) {
  if (!String(entry).endsWith('.jsonl')) continue;
  for (const line of readFileSync(join(spansDir, String(entry)), 'utf8').split('\n')) {
    if (line.trim() !== '') spans.add(JSON.parse(line).text);
  }
}
const texts = [...spans].sort();
console.log(`commit ${sha}: ${texts.length} distinct spans`);

// The subjects already used in this estate: those of the cassette `--known` names, then those of the labels written so
// far. A batch is shown them, so two clauses that name one quantity in different words get one subject.
const subjects = new Set();
const knownLabels = [];
const noteSubjects = (label) => {
  if (label && typeof label.subject === 'string' && label.subject.trim() !== '') subjects.add(label.subject);
};
if (knownFile && existsSync(knownFile)) {
  for (const line of readFileSync(knownFile, 'utf8').split('\n')) {
    if (line.trim() !== '') {
      const label = JSON.parse(line).label;
      knownLabels.push(label);
      noteSubjects(label);
    }
  }
}
const MAX_SUBJECTS = 300;
const subjectsBlock = () =>
  subjects.size === 0
    ? ''
    : `Subjects already used in this estate:\n${[...subjects]
        .slice(-MAX_SUBJECTS)
        .map((subject) => `- ${subject}`)
        .join('\n')}\n\nClauses:\n`;

// The store's own definition of a variable, quoted as written in docs/variables.md (the paragraph that opens the
// section "Variables"), so the labeller reads the definition the product uses and no copy of it can drift.
const DOC = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'variables.md');
const definition = (() => {
  const lines = readFileSync(DOC, 'utf8').split('\n');
  const at = lines.findIndex((line) => line.startsWith('A variable is one thing'));
  if (at < 0) throw new Error(`no definition of a variable in ${DOC}`);
  return lines[at];
})();

const SYSTEM = spanLabelSystem(definition);

const NUMERIC = new Set(['lt', 'le', 'gt', 'ge', 'eq', 'ne']);
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const word = (x) => typeof x === 'string' && x.trim() !== '';
const valid = (l) => {
  if (!l || typeof l !== 'object') return false;
  if (l.kind === 'none') return true;
  if (!word(l.subject)) return false;
  if (l.unit !== undefined && !word(l.unit)) return false;
  if (l.kind === 'numeric') return num(l.limit) && NUMERIC.has(l.comparison);
  if (l.kind === 'range')
    return (
      num(l.low) &&
      num(l.high) &&
      l.low < l.high &&
      typeof l.lowInclusive === 'boolean' &&
      typeof l.highInclusive === 'boolean'
    );
  if (l.kind === 'member') return Array.isArray(l.members) && l.members.length > 0 && l.members.every(word);
  return l.kind === 'boolean';
};

const report = {
  requests: 0,
  countRequests: 0,
  subjectRequests: 0,
  truncations: 0,
  subjectTruncations: 0,
  malformedSubjectAnswers: 0,
  invalidSubjectChoices: 0,
  subjectFailures: [],
};
let tokensIn = 0;
let tokensOut = 0;
const spent = () => (tokensIn * rateIn + tokensOut * rateOut) / 1e6;

// The most a request can add to the spend, known before it is sent: the exact input tokens of its body, counted on the
// provider's free count_tokens endpoint, plus the whole of its max_tokens priced as output. No formula over the bytes is
// safe: a 32,978-byte JSON body counted 30,920 tokens, and a body of combining marks counted 9,952 tokens for 8,978
// bytes, above one token per byte. A request whose worst case would cross a cap is refused before it is sent, so the
// spend can stop under the cap and not just after it; a request whose tokens cannot be counted is not sent at all.
// The real usage the response reports is what is summed.
async function countInputTokens(body) {
  const { max_tokens: _maxTokens, ...countable } = body;
  report.countRequests += 1;
  const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(countable),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`count_tokens answered ${res.status} ${JSON.stringify(json.error ?? {}).slice(0, 200)}`);
  if (!Number.isInteger(json.input_tokens) || json.input_tokens < 0)
    throw new Error('count_tokens returned no input token count');
  return json.input_tokens;
}

async function refuseIfItCouldCross(body, what) {
  let inputTokens;
  try {
    inputTokens = await countInputTokens(body);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    console.error(`stopped before sending ${what}: its input tokens could not be counted (${why}); a request is never sent unpriced`);
    throw new Error(`stopped before sending ${what}: its input tokens could not be counted`);
  }
  const worst = (inputTokens * rateIn + body.max_tokens * rateOut) / 1e6;
  if (spentBefore + spent() + worst > totalCap || spent() + worst > cap) {
    console.error(
      `stopped before sending ${what}: it could cost up to USD ${worst.toFixed(4)} (${inputTokens} input tokens); this commit USD ${spent().toFixed(4)} of ${cap}, lane total USD ${(spentBefore + spent()).toFixed(4)} of ${totalCap}`,
    );
    throw new Error(`stopped before sending ${what}: its worst case would cross a cap`);
  }
}

async function ask(batch) {
  const body = {
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      { role: 'user', content: subjectsBlock() + batch.map((text, i) => `${i + 1}. ${text}`).join('\n') },
    ],
  };
  await refuseIfItCouldCross(body, 'a batch of spans');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      `labeller request failed: ${res.status} ${JSON.stringify(json.error ?? {}).slice(0, 300)}`,
    );
  report.requests += 1;
  if (json.stop_reason === 'max_tokens') report.truncations += 1;
  tokensIn += json.usage?.input_tokens ?? 0;
  tokensOut += json.usage?.output_tokens ?? 0;
  const text = (json.content ?? []).map((c) => c.text ?? '').join('');
  const open = text.indexOf('[');
  const close = text.lastIndexOf(']');
  try {
    const parsed = JSON.parse(text.slice(open, close + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const reconcileSubjects = createSubjectReconciler(knownLabels);
const SUBJECT_CHOICE = SUBJECT_CHOICE_SYSTEM;
async function chooseSubject(clause, candidates) {
  if (candidates.length === 0) return 'new';
  const result = await requestSubjectChoice(candidates, async (previousFailure) => {
    const body = {
      model: MODEL,
      max_tokens: subjectChoiceMaxTokens(candidates),
      system: SUBJECT_CHOICE,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            clause,
            candidates,
            ...(previousFailure === undefined
              ? {}
              : {
                  retry: {
                    previousFailure,
                    instruction: 'Return only one complete JSON string: a candidate id or "new".',
                  },
                }),
          }),
        },
      ],
    };
    await refuseIfItCouldCross(body, 'a subject choice');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    report.requests += 1;
    report.subjectRequests += 1;
    if (!res.ok) throw new Error(`subject choice request failed: ${res.status}`);
    tokensIn += json.usage?.input_tokens ?? 0;
    tokensOut += json.usage?.output_tokens ?? 0;
    if (json.stop_reason === 'max_tokens') {
      report.truncations += 1;
      report.subjectTruncations += 1;
    }
    return {
      text: (json.content ?? []).map((part) => part.text ?? '').join(''),
      stopReason: json.stop_reason,
    };
  });
  report.malformedSubjectAnswers += result.errors.filter((code) => code === 'malformed').length;
  report.invalidSubjectChoices += result.errors.filter((code) => code === 'invalid-choice').length;
  if (!result.ok) {
    report.subjectFailures.push({ code: result.code, text: clause.text, attempts: result.errors });
    throw new Error('subject choice failed after one retry; see the run report');
  }
  return result.choice;
}

const rows = new Map();
let bad = 0;
try {
  for (let i = 0; i < texts.length; i += BATCH) {
    if (spentBefore + spent() > totalCap || spent() > cap) {
      console.error(
        `stopped before a cap: this commit USD ${spent().toFixed(4)}, lane total USD ${(spentBefore + spent()).toFixed(4)}`,
      );
      throw new Error('labeller spend cap reached');
    }
    const batch = texts.slice(i, i + BATCH);
    const answers = await ask(batch);
    // One retry for the clauses that came back unusable.
    const retry = batch.filter((_, j) => !valid(answers[j]));
    if (retry.length > 0) {
      const second = await ask(retry);
      retry.forEach((text, k) => {
        const at = batch.indexOf(text);
        answers[at] = second[k];
      });
    }
    const labelled = batch.map((text, j) => {
      if (valid(answers[j])) {
        return { text, label: answers[j] };
      }
      bad += 1;
      return { text, label: { kind: 'none' } };
    });
    for (const { text, label } of await reconcileSubjects(labelled, chooseSubject)) {
      rows.set(text, label);
      noteSubjects(label);
    }
  }

  writeFileSync(outFile, `${[...rows].map(([text, label]) => JSON.stringify({ text, label })).join('\n')}\n`);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  const total = spentBefore + spent();
  if (totalFile) writeFileSync(totalFile, `${total}\n`);
  const summary = {
    ...report,
    sha,
    model: MODEL,
    status: process.exitCode ? 'failed' : 'complete',
    labelled: process.exitCode ? 0 : rows.size,
    subjectFailureCount: report.subjectFailures.length,
    unusableAnswers: bad,
    tokensIn,
    tokensOut,
    usd: spent(),
    inputUsdPerMillion: rateIn,
    outputUsdPerMillion: rateOut,
    totalUsd: total,
    cap,
    totalCap,
  };
  writeFileSync(`${outFile}.report.json`, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`labelled ${summary.labelled} spans (${bad} unusable answers recorded as none)`);
  console.log(
    `tokens in ${tokensIn}, out ${tokensOut}; this commit USD ${spent().toFixed(4)}, lane total USD ${total.toFixed(4)}`,
  );
  console.log(`truncations ${report.truncations}; failed subject choices ${report.subjectFailures.length}`);
}
