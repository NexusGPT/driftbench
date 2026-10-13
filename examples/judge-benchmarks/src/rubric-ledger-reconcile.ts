/** Offline receipt reconciliation. Never constructs or invokes a paid transport. */
import { readFile, writeFile } from 'node:fs/promises';
import { appendRecording, readRecordingRows } from './recording-files';
import { LedgerCalls } from './rubric-ledger-calls';
import { DIRECTORY, latestDecisions, type DecisionRow } from './rubric-ledger-live';
import { classifyAllProviderBlocks, nativeProviderBlockReason } from './rubric-ledger-native-blocks';
import { report } from './rubric-ledger-report';

async function main() {
  const directory = process.argv[2] ?? DIRECTORY;
  const before = JSON.parse(await readFile(`${directory}/live-summary.json`, 'utf8'));
  const calls = await new LedgerCalls(`${directory}/live`, before.settings.capUsd).load();
  let changed = 0;
  for (const phase of ['pilot', 'fixtures', 'noise', 'validity', 'provider-probe', 'test']) {
    const path = `${directory}/decisions-${phase}.jsonl`;
    for (const row of latestDecisions(await readRecordingRows<DecisionRow>(path))) {
      if (!calls.rows.some((c) => row.callKeys.includes(c.key) && nativeProviderBlockReason(c))) continue;
      const next = classifyAllProviderBlocks(row, calls.rows);
      if (JSON.stringify(next) !== JSON.stringify(row)) { await appendRecording(path, next); changed++; }
    }
  }
  const result = await report({ directory, models: before.cells.map((c: any) => c.model),
    capUsd: before.settings.capUsd, settings: before.settings });
  const logical = (r: typeof calls.rows[number]) => JSON.stringify([r.model, r.identity.phase, r.item, r.contestant, r.identity.sample, r.identity.ordinal]);
  const answered = new Set(calls.rows.filter((r) => r.status === 'ok').map(logical));
  const missing = [...new Map(calls.rows.filter((r) => !answered.has(logical(r))).map((r) => [logical(r), r])).values()];
  for (const cell of result.cells) {
    cell.verdict = !cell.coverage.complete ? 'PENDING: incomplete' : cell.stats!.difference < 0 && cell.stats!.gameMcNemarP < .05 ? 'LOSS' : 'TIE-only preregistered';
    Object.assign(cell, { transportMissingRequests: missing.filter((r) => r.model === cell.model).length,
      final: cell.coverage.complete && !missing.some((r) => r.model === cell.model) && !calls.uncertainKeys.length });
  }
  await writeFile(`${directory}/live-summary.json`, `${JSON.stringify(result, null, 2)}\n`);
  const nativeBlocks = calls.rows.flatMap((r) => {
    const reason = nativeProviderBlockReason(r);
    return reason ? [{ key: r.key, model: r.model, phase: r.identity.phase, item: r.item,
      contestant: r.contestant, ordinal: r.identity.ordinal, reason, costUsd: r.costUsd,
      outputTokens: 0, source: 'saved native CLI receipt', rawJournalUnchanged: true }] : [];
  });
  await writeFile(`${directory}/native-provider-block-audit.json`, `${JSON.stringify({ at: new Date().toISOString(),
    method: 'is_error, output_tokens=0, API Error prefix and explicit Anthropic AUP URL; no paid calls; apply predeclared symmetric block policy',
    rows: nativeBlocks }, null, 2)}\n`);
  console.log(JSON.stringify({ changedDecisionRows: changed, nativeBlocks: nativeBlocks.length,
    cells: result.cells.map((c) => ({ model: c.model, ...(c as any).final !== undefined ? { final: (c as any).final } : {},
      transportMissingRequests: (c as any).transportMissingRequests, score: c.stats ? [c.stats.ours.correct, c.stats.peer.correct] : null })) }));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
