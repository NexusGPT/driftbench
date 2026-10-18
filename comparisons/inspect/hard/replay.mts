import './archive-env';
import { writeFileSync } from 'node:fs';
import { generate, rows } from './generate.mts';
import { parseOutcome, promptFor, requestSha256, type Variant } from './harness';
import { recordingLines } from './recordings';

const root = new URL('./', import.meta.url);
const calls = recordingLines(root).map((s) => {
  const record = JSON.parse(s);
  return { ...record, request_sha256: record.request_sha256 ?? record.key };
});
const byDigest = new Map(calls.map((c) => [c.request_sha256, c]));
const arch = calls.some((c) => c.variant === 'arch') ? await import('./arch') : undefined;
const main = await import('./main-deciding');
const failures = [];
for (const set of ['hard', 'heldout'] as const)
  for (const row of rows) {
    for (const variant of ['ours', 'theirs', 'audit', 'arch'] as Variant[]) {
      if (variant === 'arch' && !arch) continue;
      for (const c of generate(row, set === 'heldout' ? { seed: 20261013, count: 60 } : undefined)) {
        const repeats = row === 'panel' || row === 'borderline' ? 3 : 1;
        for (let repeat = 0; repeat < repeats; repeat++) {
          const answer = byDigest.get(
            requestSha256(
              variant === 'arch' && arch
                ? arch.archPrompt(c)
                : variant === 'ours'
                  ? main.mainPrompt(c)
                  : promptFor(c, row, variant),
              repeat,
            ),
          );
          if (!answer) continue;
          const outcome =
            variant === 'arch' && arch
              ? arch.parseArch(answer.text, c)
              : variant === 'ours'
                ? main.parseMain(answer.text)
                : parseOutcome(answer.text, variant, c.submission);
          if (outcome === c.label) continue;
          failures.push({
            row,
            set,
            variant,
            id: c.id,
            family: c.family,
            repeat,
            label: c.label,
            outcome,
            request_sha256: answer.request_sha256,
            submission: c.submission,
            text: answer.text,
            error: answer.error,
          });
        }
      }
    }
  }
writeFileSync(new URL('./failures.json', root), `${JSON.stringify(failures, null, 2)}\n`);
console.log(
  JSON.stringify({
    recordedCalls: calls.length,
    costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
    reservedUsd: calls.reduce((s, c) => s + c.reservedUsd, 0),
    failures: failures.length,
    byGroup: failures.reduce(
      (s, f) => {
        const key = `${f.set}/${f.row}/${f.variant}/${f.family}`;
        s[key] = (s[key] ?? 0) + 1;
        return s;
      },
      {} as Record<string, number>,
    ),
  }),
);
