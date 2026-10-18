// Execute the pinned upstream summary helper on every fictional goal trace.
import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const here = fileURLToPath(new URL('../promptfoo/hard/', import.meta.url));
const study = fileURLToPath(new URL('.', import.meta.url));
const provenance = JSON.parse(readFileSync(`${here}vendor/provenance.json`, 'utf8')) as {
  helper_sources: Record<string, { sha256: string }>;
};

function loadSource(name: string, dependencies: Record<string, unknown> = {}) {
  const source = readFileSync(`${here}vendor/${name}.ts.txt`, 'utf8');
  const digest = createHash('sha256').update(source).digest('hex');
  deepStrictEqual(digest, provenance.helper_sources[name]?.sha256);
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(
    code,
    {
      exports,
      require: (id: string) => {
        if (!(id in dependencies)) throw new Error(`Unprovided upstream dependency: ${id}`);
        return dependencies[id];
      },
    },
    { timeout: 5_000 },
  );
  return exports;
}

const attributes = loadSource('toolAttributes');
const native = loadSource('trajectoryUtils', {
  '../tracing/toolAttributes': attributes,
  './traceUtils': {
    // Pattern matching is unused by extraction and summary; fail if that changes.
    matchesPattern: () => {
      throw new Error('Unexpected pattern matching during trajectory summary');
    },
  },
}) as { summarizeTrajectoryForJudge: (trace: unknown) => string };

type Case = { trajectory: { traceId: string }; endState: unknown };
let checked = 0;
for (const prefix of ['']) {
  const cases = JSON.parse(readFileSync(`${study}${prefix}goal.json`, 'utf8')) as Case[];
  for (const item of cases) {
    const trace = {
      traceId: item.trajectory.traceId,
      spans: [
        {
          spanId: 'create',
          name: 'order.create',
          startTime: 1,
          endTime: 2,
          statusCode: 1,
          attributes: { 'tool.name': 'order.create', 'tool.arguments': JSON.stringify(item.endState) },
        },
        { spanId: 'message', name: 'agent response', startTime: 3, endTime: 4, attributes: {} },
      ],
    };
    deepStrictEqual(JSON.parse(native.summarizeTrajectoryForJudge(trace)), item.trajectory);
    checked += 1;
  }
}
console.log(`Verified ${checked} goal summaries against the pinned upstream helper.`);
