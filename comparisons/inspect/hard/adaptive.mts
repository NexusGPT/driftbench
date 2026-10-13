import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { adaptiveLedger } from './audit-adaptive';
import { parseScopedAudit, scopedPrompt } from './audit-scoped';
import type { Case } from './generate.mts';
import { rows } from './generate.mts';
import { requestSha256, wilson } from './harness';
import { recordingLines } from './recordings';

const root = new URL('./', import.meta.url);
const frozen = JSON.parse(readFileSync(new URL('adaptive/freeze.json', root), 'utf8'));
for (const [name, hash] of Object.entries(frozen.sha256)) {
  if (
    createHash('sha256')
      .update(readFileSync(new URL(name, root)))
      .digest('hex') !== hash
  )
    throw new Error(`Frozen adaptive input or procedure changed: ${name}`);
}
const calls = recordingLines(root).map((line) => JSON.parse(line));
const cache = new Map(calls.map((call) => [call.request_sha256 ?? call.key, call]));
for (const row of rows)
  for (const heldout of [false, true]) {
    const input = `${heldout ? 'scoped/' : ''}${row}${heldout ? '-heldout' : ''}.json`;
    const body = readFileSync(new URL(input, root), 'utf8');
    const cases = JSON.parse(body) as Case[];
    const results = cases.map((c) => {
      const maximum = row === 'panel' || row === 'borderline' ? 3 : 1;
      const recorded = [];
      for (let repeat = 0; repeat < maximum; repeat++) {
        const call = cache.get(requestSha256(scopedPrompt(c), repeat));
        if (!call) break;
        recorded.push(call);
      }
      const votes = recorded.map((call) =>
        call.error ? ('inconclusive' as const) : parseScopedAudit(call.text, c.submission),
      );
      const decision = adaptiveLedger(votes, maximum);
      const consumed = recorded.slice(0, decision.used);
      return {
        id: c.id,
        family: c.family,
        label: c.label,
        ...decision,
        request_sha256: consumed.map((call) => call.request_sha256 ?? call.key),
        votes: votes.slice(0, decision.used),
        costUsd: consumed.reduce((sum, call) => sum + call.costUsd, 0),
      };
    });
    const complete = results.filter((result) => result.complete).length;
    const right = results.filter((result) => result.complete && result.outcome === result.label).length;
    const summary = {
      row,
      set: heldout ? 'heldout' : 'hard',
      variant: 'audit',
      procedureLabel: frozen.candidate,
      date: new Date().toISOString(),
      setSha256: createHash('sha256').update(body).digest('hex'),
      items: cases.length,
      complete,
      right,
      wrong: results.filter(
        (result) => result.complete && result.outcome !== 'inconclusive' && result.outcome !== result.label,
      ).length,
      inconclusive: results.filter((result) => result.complete && result.outcome === 'inconclusive').length,
      costUsd: results.reduce((sum, result) => sum + result.costUsd, 0),
      ci95: wilson(right, complete),
      results,
    };
    writeFileSync(
      new URL(`adaptive/${row}${heldout ? '-heldout' : ''}-audit.json`, root),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    // Controls are the same once-scored shipped and default procedures on identical inputs.
    for (const variant of ['ours', 'theirs']) {
      const source = new URL(`scoped/${row}${heldout ? '-heldout' : ''}-${variant}.json`, root);
      try {
        writeFileSync(
          new URL(`adaptive/${row}${heldout ? '-heldout' : ''}-${variant}.json`, root),
          readFileSync(source),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    console.log(JSON.stringify({ ...summary, results: undefined }));
  }
