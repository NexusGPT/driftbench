import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseAnswerText } from '../../../packages/judges/src/contract.ts';
import { buildPrompt } from '../../../packages/judges/src/prompt.ts';
import { COMPLIANCE_AUDIT, compliancePrediction } from './compliance.mts';
import { AUDIT, auditPrediction, keyOf, nativePrompt, nativeSchema } from './judges.mts';
import { here, Runner } from './runner.mts';
import {
  type StructuredCase,
  trustedComplianceUser,
  trustedNativeUser,
  trustedRequest,
} from './trusted-adapter-v2.mts';

const root = resolve(here, '../../..');
const sha = (x: Buffer) => createHash('sha256').update(x).digest('hex');
export function registration() {
  const manifest = JSON.parse(readFileSync(join(here, 'adapter-v2-freeze.json'), 'utf8'));
  for (const [path, digest] of Object.entries(manifest.hashes)) {
    const absolute = join(here, path);
    if (sha(readFileSync(absolute)) !== digest) throw new Error(`Frozen adapter/source changed: ${path}`);
    const committed = execFileSync('git', ['show', `HEAD:${relative(root, absolute)}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    if (sha(committed) !== digest) throw new Error(`Preregistration must be committed: ${path}`);
  }
  const committed = execFileSync('git', ['show', 'HEAD:comparisons/langwatch/hard/adapter-v2-freeze.json'], {
    cwd: root,
  });
  if (sha(committed) !== sha(readFileSync(join(here, 'adapter-v2-freeze.json'))))
    throw new Error('Commit the frozen protocol first');
  return {
    registrationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    procedureHashes: manifest.hashes,
  };
}
async function main() {
  const variant = process.argv[2];
  if (!['ours', 'audit', 'theirs', 'compliance', 'pr115'].includes(variant ?? ''))
    throw new Error('Unknown contestant');
  const long = process.argv.includes('--longtrace-v2');
  const registered = registration();
  const fixture = readFileSync(join(here, long ? 'longtrace-v2/hard.json' : 'judges-entries-v2.json'));
  const items = JSON.parse(fixture.toString()) as StructuredCase[];
  const runner = new Runner(process.argv.includes('--replay'));
  const pinned = variant === 'pr115' ? await import('./pr115.mts') : undefined;
  const source = pinned?.pr115Runtime();
  const answers: unknown[] = [];
  const save = () =>
    writeFileSync(
      join(here, 'recorded', `${long ? 'longtrace-v2' : 'adapter-v2'}-${variant}.json`),
      JSON.stringify(
        {
          variant,
          adapterVersion: 2,
          seed: long ? 20261020 : 20261019,
          ...registered,
          ...source,
          fixtureSha256: sha(fixture),
          expected: items.length,
          complete: answers.length === items.length,
          candidateLabel: ['audit', 'compliance'].includes(variant ?? '')
            ? 'not yet the shipped default'
            : undefined,
          answers,
        },
        null,
        2,
      ) + '\n',
    );
  try {
    for (const item of items) {
      const request_sha256s: string[] = [];
      const predictions: Array<string | null> = [];
      const details: unknown[] = [];
      let costUsd = 0;
      let transportRecovered = false;
      let unscored = false;
      const account = (call: Awaited<ReturnType<Runner['ask']>>) => {
        request_sha256s.push(call.request_sha256);
        costUsd += call.costUsd;
      };
      if (variant === 'theirs') {
        const system = nativePrompt(item),
          user = trustedNativeUser(item),
          schema = nativeSchema(item.criteria);
        let call = await runner.ask(system, user, schema);
        account(call);
        if (call.failed && !call.text && !call.structured) {
          call = await runner.ask(system, user, schema, 6);
          account(call);
          transportRecovered = !call.failed && call.structured !== undefined;
          unscored = !transportRecovered;
        }
        let value: { criteria?: Record<string, { status?: string }> } = {};
        if (!call.failed)
          try {
            value = (call.structured as typeof value) ?? JSON.parse(call.text);
          } catch {
            /* Invalid quality response remains incorrect. */
          }
        for (const rubric of item.criteria) {
          const status = value.criteria?.[keyOf(rubric)]?.status;
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
        const client = pinned?.createPR115Client(runner, account);
        for (const [index, rubric] of item.criteria.entries()) {
          const request = trustedRequest(item, index);
          if (client) {
            const result = await client.judge(request);
            predictions.push(result.unparsed ? null : result.answer.outcome);
            details.push({ answer: result.answer, checks: result.checks, unparsed: result.unparsed });
          } else {
            const prompt = buildPrompt(request);
            const call = await runner.ask(
              variant === 'compliance' ? COMPLIANCE_AUDIT : variant === 'audit' ? AUDIT : prompt.system,
              variant === 'compliance' ? trustedComplianceUser(item, rubric) : prompt.user,
            );
            account(call);
            const result = parseAnswerText(call.text);
            predictions.push(
              call.failed
                ? null
                : variant === 'compliance'
                  ? compliancePrediction(call.text)
                  : variant === 'audit'
                    ? auditPrediction(call.text)
                    : result.unparsed
                      ? null
                      : result.answer.outcome,
            );
          }
        }
      }
      answers.push({
        id: item.id,
        predictions,
        details,
        request_sha256s,
        costUsd,
        transportRecovered,
        unscored,
      });
      save();
      if (answers.length % 10 === 0)
        console.log(
          `${long ? 'longtrace-v2' : 'adapter-v2'} ${variant}: ${answers.length}/${items.length}, new USD ${runner.fresh.toFixed(6)}`,
        );
    }
  } finally {
    save();
  }
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1])
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
