/**
 * Records the real systems on the planted spans (run from the repository root):
 *
 *   pnpm exec tsx examples/variables/conditions/record.ts [--probe]
 *
 * System 1 is Jev (key: ~/.nexus-secrets/jev.key, gateway route; the typesafe key is the fallback), system 2 is
 * Haiku (key: ~/.nexus-secrets/anthropic-driftbench.key). Keys are read by path into the clients and never
 * printed. The output is cassette.json beside this file, which `feed/conditions-real.test.ts` replays.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseVariableStoreText } from '@agent-nexus/driftbench-space';
import {
  createAnthropicPort,
  createJevReader,
  createModelProposer,
  emptyRecording,
  feedFromConditions,
  recordConditions,
} from '../../../packages/generate/src';

const here = new URL('.', import.meta.url).pathname;
const secret = (name: string) => readFileSync(join(homedir(), '.nexus-secrets', name), 'utf8').trim();
const spans = (
  JSON.parse(readFileSync(join(here, 'spans.json'), 'utf8')) as { spans: Array<Record<string, string>> }
).spans;
const loaded = parseVariableStoreText(readFileSync(join(here, 'store.yaml'), 'utf8'), 'yaml');
if (!loaded.ok) throw new Error('the candidate store does not load');

const texts = new Map<string, string>();
for (const span of spans) {
  const path = span.path as string;
  texts.set(path, readFileSync(join(here, '../../estates', path), 'utf8'));
}

const tryRoutes: Array<Record<string, string>> = [
  { JEV_ROUTE: 'gateway', JEV_API_KEY: secret('jev.key') },
  { JEV_ROUTE: 'typesafe', JEV_API_KEY: secret('jev-typesafe.key') },
];
const model = process.env.CONDITIONS_MODEL ?? 'claude-haiku-5-5';
const port = createAnthropicPort({
  env: { ANTHROPIC_API_KEY: secret('anthropic-driftbench.key'), ANTHROPIC_MODEL: model },
});
const proposer = createModelProposer(port);

const probe = process.argv.includes('--probe');
const subset = probe ? spans.slice(0, 1) : spans;
let lastError = '';
for (const env of tryRoutes) {
  const reader = createJevReader({ env });
  const recording = emptyRecording();
  const wrapped = recordConditions(recording, reader, proposer);
  const { report, store } = await feedFromConditions({
    store: loaded.store,
    spans: subset.map((s) => ({ id: s.id as string, path: s.path as string, quote: s.quote as string })),
    texts,
    reader: wrapped.reader,
    ...(wrapped.proposer ? { proposer: wrapped.proposer } : {}),
  });
  if (report.failed === subset.length) {
    lastError = report.outcomes[0]?.reason ?? 'failed';
    console.error(`route ${env.JEV_ROUTE}: ${lastError}`);
    continue;
  }
  console.log(`route ${env.JEV_ROUTE}:`, JSON.stringify({ ...report, outcomes: undefined }));
  console.log('usage', JSON.stringify(reader.usage()));
  if (!probe) {
    // Second pass: the same spans read with the no threshold at 0.5. The candidates grow as values are
    // proposed, so this pass asks Jev again (its questions differ) and records into a second recording.
    const recording2 = emptyRecording();
    const extra = recordConditions(recording2, reader, proposer);
    await feedFromConditions({
      store: loaded.store,
      spans: subset.map((s) => ({ id: s.id as string, path: s.path as string, quote: s.quote as string })),
      texts,
      reader: extra.reader,
      ...(extra.proposer ? { proposer: extra.proposer } : {}),
      options: { decide: { noAt: 0.5 } },
    });
    const meta = {
      reader: `jev (${env.JEV_ROUTE})`,
      proposer: `${port.family}:${port.model}`,
      spans: spans.length,
    };
    writeFileSync(
      join(here, 'cassette-no-at-0.5.json'),
      `${JSON.stringify({ ...recording2, recorded: meta }, null, 2)}\n`,
    );
    writeFileSync(
      join(here, 'cassette.json'),
      `${JSON.stringify({ ...recording, recorded: { reader: `jev (${env.JEV_ROUTE})`, proposer: `${port.family}:${port.model}`, spans: spans.length } }, null, 2)}\n`,
    );
    for (const o of report.outcomes) console.log(o.span, o.status, o.values.join(','), o.reason ?? '');
  }
  void store;
  process.exit(0);
}
console.error('no route answered:', lastError);
process.exit(1);
