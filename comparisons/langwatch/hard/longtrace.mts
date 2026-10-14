import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseAnswerText } from '../../../packages/judges/src/contract.ts';
import { buildPrompt } from '../../../packages/judges/src/prompt.ts';
import { COMPLIANCE_AUDIT, compliancePrediction, complianceUser } from './compliance.mts';
import { AUDIT, auditPrediction, type JudgeCase, keyOf, nativePrompt, nativeSchema } from './judges.mts';
import { here, Runner } from './runner.mts';

const root = resolve(here, '../../..');
const digest = (content: Buffer) => createHash('sha256').update(content).digest('hex');
export function registered() {
  const files = [
    'longtrace.mts',
    'pr115.mts',
    'pr115-criteria.mts',
    'compliance.mts',
    'compliance-freeze.json',
    ...readdirSync(join(here, 'longtrace'))
      .filter((name) => /\.(json|mjs|md|py)$/.test(name))
      .map((name) => `longtrace/${name}`),
  ];
  for (const file of files) {
    const path = join(here, file);
    const committed = spawnSync('git', ['show', `HEAD:${relative(root, path)}`], { cwd: root });
    if (committed.status !== 0 || digest(committed.stdout) !== digest(readFileSync(path)))
      throw new Error(`Preregistration must be committed before calls: ${file}`);
  }
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (head.status !== 0) throw new Error('Unable to identify preregistration commit');
  const frozen = JSON.parse(readFileSync(join(here, 'frozen.json'), 'utf8'));
  for (const [path, sha] of Object.entries(frozen.sourceHashes))
    if (digest(readFileSync(join(here, path))) !== sha) throw new Error(`Frozen procedure changed: ${path}`);
  return head.stdout.trim();
}
async function run() {
  const variant = process.argv[2];
  if (!['ours', 'audit', 'theirs', 'compliance'].includes(variant ?? ''))
    throw new Error('Use ours|audit|theirs|compliance');
  const registrationCommit = registered();
  const required = [
    ...['judges', 'simulator'].flatMap((row) =>
      (row === 'judges' ? ['ours', 'audit', 'theirs', 'compliance'] : ['ours', 'checked', 'theirs']).flatMap(
        (name) => ['', '-heldout'].map((tag) => `${row}-${name}${tag}.json`),
      ),
    ),
    ...['pii', 'injection'].flatMap((row) =>
      ['ours', 'audit'].flatMap((name) => ['', '-heldout'].map((tag) => `${row}-${name}${tag}.json`)),
    ),
    ...['ours', 'checked', 'theirs'].map((name) => `pairwise-${name}-heldout.json`),
  ];
  for (const file of required) {
    const measured = JSON.parse(readFileSync(join(here, 'recorded', file), 'utf8'));
    if (!measured.complete) throw new Error(`Finish the frozen measurements before long traces: ${file}`);
  }

  const frozen = JSON.parse(readFileSync(join(here, 'frozen.json'), 'utf8'));
  const procedurePaths = [
    ...Object.keys(frozen.sourceHashes),
    'vendor/prompts.json',
    'runner.mts',
    'compliance.mts',
    'compliance-freeze.json',
    '../../../packages/judges/src/prompt.ts',
    '../../../packages/judges/src/contract.ts',
  ];
  const procedureHashes = Object.fromEntries(
    procedurePaths.map((path) => [path, digest(readFileSync(join(here, path)))]),
  );
  const fixture = readFileSync(join(here, 'longtrace/hard.json'));
  const items = JSON.parse(fixture.toString()) as JudgeCase[];
  const runner = new Runner(process.argv.includes('--replay'));
  const answers: unknown[] = [];
  const save = () =>
    writeFileSync(
      join(here, 'recorded', `longtrace-${variant}.json`),
      `${JSON.stringify({ row: 'preregistered-long-trace', variant, expected: items.length, complete: answers.length === items.length, registrationCommit, procedureHashes, fixtureSha256: digest(fixture), candidateLabel: ['audit', 'compliance'].includes(variant ?? '') ? 'not yet the shipped default' : undefined, answers }, null, 2)}\n`,
    );
  try {
    for (const item of items) {
      const request_sha256s: string[] = [];
      const predictions: Array<string | null> = [];
      let costUsd = 0;
      let transportRecovered = false;
      let unscored = false;
      if (variant === 'theirs') {
        const system = nativePrompt(item);
        const user = `\n<transcript>\n${item.transcript}\n</transcript>\n<opentelemetry_traces>\n\n</opentelemetry_traces>\n`;
        const schema = nativeSchema(item.criteria);
        let call = await runner.ask(system, user, schema);
        request_sha256s.push(call.request_sha256);
        costUsd += call.costUsd;
        if (call.failed && !call.text && !call.structured) {
          call = await runner.ask(system, user, schema, 6);
          request_sha256s.push(call.request_sha256);
          costUsd += call.costUsd;
          transportRecovered = !call.failed && call.structured !== undefined;
          unscored = !transportRecovered;
        }
        let parsed: { criteria?: Record<string, { status?: string }> } = {};
        if (!call.failed) {
          try {
            parsed = (call.structured as typeof parsed) ?? JSON.parse(call.text);
          } catch {
            /* Malformed output is recorded, never silently treated as a pass. */
          }
        }
        for (const criterion of item.criteria) {
          const status = parsed.criteria?.[keyOf(criterion)]?.status;
          predictions.push(
            status === 'passed'
              ? 'pass'
              : status === 'failed'
                ? 'fail'
                : status === 'inconclusive'
                  ? 'inconclusive'
                  : null,
          );
        }
      } else {
        for (const [index, rubric] of item.criteria.entries()) {
          const prompt = buildPrompt({
            criterion: { name: `requirement_${index + 1}`, rubric, scope: 'conversation' },
            transcript: [
              { role: 'context', text: item.scenario },
              { role: 'agent', text: item.transcript },
            ],
          });
          const call = await runner.ask(
            variant === 'compliance' ? COMPLIANCE_AUDIT : variant === 'audit' ? AUDIT : prompt.system,
            variant === 'compliance' ? complianceUser(item, rubric) : prompt.user,
          );
          request_sha256s.push(call.request_sha256);
          costUsd += call.costUsd;
          const parsed = call.failed ? undefined : parseAnswerText(call.text);
          predictions.push(
            call.failed
              ? null
              : variant === 'compliance'
                ? compliancePrediction(call.text)
                : variant === 'audit'
                  ? auditPrediction(call.text)
                  : parsed?.unparsed
                    ? null
                    : (parsed?.answer.outcome ?? null),
          );
        }
      }
      answers.push({ id: item.id, predictions, request_sha256s, costUsd, transportRecovered, unscored });
      save();
      if (answers.length % 10 === 0)
        console.log(
          `longtrace ${variant}: ${answers.length}/${items.length}, fresh USD ${runner.fresh.toFixed(6)}`,
        );
    }
  } finally {
    save();
  }
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1])
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
