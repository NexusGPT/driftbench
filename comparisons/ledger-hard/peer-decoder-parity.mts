// Replay recorded answers through verbatim pinned native parsing/verdict functions.
import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as yaml from './native-validation/js-yaml/dist/js-yaml.mjs';

const here = fileURLToPath(new URL('../promptfoo/hard/', import.meta.url));
const study = fileURLToPath(new URL(process.argv.includes('--dialect') ? './dialect/' : '.', import.meta.url));
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
const yamlExports: Record<string, (...args: unknown[]) => unknown> = {};
const yamlPath = fileURLToPath(new URL('./native-validation/yamlLoad.ts', import.meta.url));
const yamlProvenance = JSON.parse(readFileSync(fileURLToPath(new URL('./native-validation/provenance.json', import.meta.url)), 'utf8'));
const yamlCode = readFileSync(yamlPath, 'utf8');
deepStrictEqual(createHash('sha256').update(yamlCode).digest('hex'), yamlProvenance.sha256);
runInNewContext(ts.transpileModule(yamlCode.replace("import * as yaml from 'js-yaml';", ''), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}
}).outputText, {exports: yamlExports, yaml}, {timeout: 5000});
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
    loadYaml: (...args: unknown[]) => {
      yamlFallbacks += 1;
      return yamlExports.loadYaml(...args);
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
for (const line of [readFileSync(`${study}calls.jsonl`, 'utf8'), existsSync(`${study}retry-results.jsonl`) ? readFileSync(`${study}retry-results.jsonl`, 'utf8') : ''].join('\n').split('\n')) {
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
writeFileSync(`${study}peer-native-decoder.json`, `${JSON.stringify(decoded, null, 2)}\n`);
writeFileSync(`${study}peer-native-decoder-meta.json`, `${JSON.stringify({answers: Object.keys(decoded).length, yamlFallbacks, yamlVersion: '5.4.2'})}\n`);
console.log(`Decoded ${Object.keys(decoded).length} peer answers with pinned native verdict functions; ${yamlFallbacks} native YAML attempts.`);
