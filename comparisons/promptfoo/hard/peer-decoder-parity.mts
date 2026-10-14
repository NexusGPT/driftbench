// Replay recorded answers through verbatim pinned native parsing/verdict functions.
import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const here = fileURLToPath(new URL('.', import.meta.url));
const provenance = JSON.parse(readFileSync(`${here}vendor/provenance.json`, 'utf8')) as {
  decoder_sources: Record<string, { sha256: string }>;
};

function declarations(name: string, names: string[]) {
  const text = readFileSync(`${here}vendor/${name}.ts.txt`, 'utf8');
  deepStrictEqual(createHash('sha256').update(text).digest('hex'), provenance.decoder_sources[name]?.sha256);
  const source = ts.createSourceFile(`${name}.ts`, text, ts.ScriptTarget.ES2022, true);
  const selected = source.statements.filter((node) => {
    if (ts.isFunctionDeclaration(node)) return !!node.name && names.includes(node.name.text);
    if (ts.isVariableStatement(node)) {
      return node.declarationList.declarations.some((d) => names.includes(d.name.getText(source)));
    }
    return false;
  });
  deepStrictEqual(selected.length, names.length);
  return selected.map((node) => node.getText(source)).join('\n');
}

const jsonNames = [
  'isEscapedQuote',
  'convertSlashCommentsToHash',
  'findJsonStringEnd',
  'findJsonObjectEnd',
  'extractJsonObjects',
  'extractFirstJsonObject',
];
const factualNames = [
  'FACTUALITY_CATEGORY_DESCRIPTIONS',
  'getFactualityScoreLookup',
  'buildFactualityResult',
  'parseFactualityJsonResponse',
  'parseLegacyFactualityResponse',
];
const functions = ['extractJsonObjects', 'deriveVerdictFromGrader', ...factualNames.slice(1)];
const selected = `${declarations('json', jsonNames)}\n${declarations('llmGrading', factualNames)}\n${declarations('rubric', ['deriveVerdictFromGrader'])}\n${functions.map((name) => `exports.${name} = ${name};`).join('\n')}`;
const exports: Record<string, (...args: unknown[]) => unknown> = {};
let yamlFallbacks = 0;
runInNewContext(
  ts.transpileModule(selected, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText,
  {
    exports,
    logger: { debug: () => {} },
    normalizeMatcherTokenUsage: () => ({}),
    invariant: (condition: unknown, message: string) => {
      if (!condition) throw new Error(message);
    },
    loadYaml: () => {
      yamlFallbacks += 1;
      throw new Error('Recorded JSON unexpectedly needs the upstream YAML repair path');
    },
  },
  { timeout: 5_000 },
);
for (const name of functions)
  deepStrictEqual(typeof exports[name], 'function', `Missing native function: ${name}`);

type Call = {
  side: string;
  row: string;
  request_sha256: string;
  text: string;
  success: boolean;
};
function native(name: string, ...args: unknown[]) {
  const fn = exports[name];
  if (!fn) throw new Error(`Missing native function: ${name}`);
  return fn(...args);
}
const decoded: Record<string, string> = {};
for (const line of readFileSync(`${here}recorded/calls.jsonl`, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const call = JSON.parse(line) as Call;
  if (!call.success || !['peer', 'peer-full-state'].includes(call.side)) continue;
  const digest = call.request_sha256;
  if (!digest) throw new Error('Recording lacks its request digest');
  try {
    let pass: boolean | undefined;
    if (call.row === 'factuality') {
      const parsed = (native('parseFactualityJsonResponse', call.text) ??
        native('parseLegacyFactualityResponse', call.text)) as { option: string; reason: string };
      pass = (native('buildFactualityResult', parsed.option, parsed.reason, {}, {}) as { pass: boolean })
        .pass;
    } else {
      const parsed = (native('extractJsonObjects', call.text) as object[])[0];
      pass = parsed
        ? (native('deriveVerdictFromGrader', parsed, undefined) as { pass: boolean } | undefined)?.pass
        : undefined;
    }
    decoded[digest] = pass === undefined ? 'inconclusive' : pass ? 'pass' : 'fail';
  } catch {
    decoded[digest] = 'inconclusive';
  }
}
deepStrictEqual(
  yamlFallbacks,
  0,
  'This replay must verify every JSON answer without an untested repair path',
);
deepStrictEqual(decoded, JSON.parse(readFileSync(`${here}recorded/peer-native-decoder.json`, 'utf8')));
console.log(`Decoded ${Object.keys(decoded).length} peer answers with pinned native verdict functions.`);
