import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { buildPrompt } from '../../../packages/judges/src/prompt.ts';
import { buildPrompt as pinnedPrompt } from './.pr115-source/packages/judges/src/prompt.ts';
import { COMPLIANCE_AUDIT } from './compliance.mts';
import { AUDIT, nativePrompt, nativeSchema } from './judges.mts';
import { type Call, here } from './runner.mts';
import {
  type StructuredCase,
  trustedComplianceUser,
  trustedNativeUser,
  trustedRequest,
} from './trusted-adapter-v2.mts';
export function tokens(source: string): string {
  const parsed = ts.createSourceFile('verify.mts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result: Array<[ts.SyntaxKind, string]> = [];
  function visit(node: ts.Node) {
    const children = node.getChildren(parsed);
    if (children.length) for (const child of children) visit(child);
    else if (node.kind !== ts.SyntaxKind.EndOfFileToken) result.push([node.kind, node.getText(parsed)]);
  }
  visit(parsed);
  return JSON.stringify(
    result.filter(
      ([kind], index) =>
        kind !== ts.SyntaxKind.CommaToken ||
        ![ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.CloseBracketToken].includes(
          result[index + 1]?.[0] ?? ts.SyntaxKind.Unknown,
        ),
    ),
  );
}
export function verifyModelInputs(): number {
  const calls = new Map<string, Call>(
    readFileSync(join(here, 'recorded/calls.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const call = JSON.parse(line);
        return [call.request_sha256, call];
      }),
  );
  let verified = 0;
  for (const [prefix, fixture] of [
    ['adapter-v2', 'judges-entries-v2.json'],
    ['longtrace-v2', 'longtrace-v2/hard.json'],
  ] as const) {
    const cases = new Map<string, StructuredCase>(
      (JSON.parse(readFileSync(join(here, fixture), 'utf8')) as StructuredCase[]).map((c) => [c.id, c]),
    );
    for (const variant of ['ours', 'audit', 'theirs', 'compliance', 'pr115']) {
      const record = JSON.parse(readFileSync(join(here, 'recorded', `${prefix}-${variant}.json`), 'utf8'));
      if (!record.complete || record.answers.length !== 120)
        throw new Error('Finish every frozen run before formatting');
      for (const answer of record.answers) {
        const item = cases.get(answer.id);
        if (!item) throw new Error('Unknown recorded case');
        for (const [index, digest] of (answer.request_sha256s as string[]).entries()) {
          const call = calls.get(digest);
          if (!call) throw new Error('Missing raw request');
          let system: string, user: string;
          if (variant === 'theirs') {
            system = nativePrompt(item);
            user = trustedNativeUser(item);
            if (JSON.stringify(call.schema) !== JSON.stringify(nativeSchema(item.criteria)))
              throw new Error('Native schema changed');
          } else {
            const request = trustedRequest(item, index),
              prompt = variant === 'pr115' ? pinnedPrompt(request) : buildPrompt(request);
            system =
              variant === 'compliance' ? COMPLIANCE_AUDIT : variant === 'audit' ? AUDIT : prompt.system;
            user =
              variant === 'compliance'
                ? trustedComplianceUser(item, item.criteria[index] ?? '')
                : prompt.user;
          }
          if (system !== call.system || user !== call.user)
            throw new Error(`Model payload changed: ${prefix}/${variant}/${answer.id}/${index}`);
          verified++;
        }
      }
    }
  }
  return verified;
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1])
  console.log(JSON.stringify({ unchangedModelInputs: true, verifiedRequestCount: verifyModelInputs() }));
