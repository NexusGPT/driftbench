// Run the committed core's payload builder verbatim, with its dependency bodies.
// This isolates payload construction without installing or copying node_modules.
import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const here = fileURLToPath(new URL('.', import.meta.url));
function declarations(file: string, names: string[]) {
  const source = ts.createSourceFile(file, readFileSync(`${here}dialect/vendor/${file}`, 'utf8'), ts.ScriptTarget.ES2022, true);
  const selected = source.statements.filter(node => {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return !!node.name && names.includes(node.name.text);
    return ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(source)));
  });
  deepStrictEqual(selected.length, names.length);
  return selected.map(node => node.getText(source)).join('\n');
}
const code = [
  declarations('hash.ts', ['canonicalJson', 'sortKeys', 'contentHash']),
  declarations('prompt.ts', ['promptFingerprint']),
  declarations('http.ts', ['JudgeError', 'isRecord']),
  declarations('dialects.ts', ['JUDGE_DIALECTS', 'googleResponseSchema']),
  declarations('transport.ts', ['buildDialectRequest']),
].join('\n');
const exports: Record<string, any> = {};
runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, createHash }, { timeout: 5000 });
const schema = {
  type: 'object', additionalProperties: false, required: ['checks'], properties: {
    checks: { type: 'array', minItems: 1, items: {
      type: 'object', additionalProperties: false, required: ['requirement', 'status', 'evidence'], properties: {
        requirement: { type: 'string' }, status: { type: 'string', enum: ['met', 'violated', 'unknown'] }, evidence: { type: 'string' }
      }
    }}
  }
};
const prompts = JSON.parse(readFileSync(`${here}prompts.json`, 'utf8'));
const rendered = [];
for (const entry of prompts) {
  for (const model of ['haiku', 'gpt-6-luna', 'gemini-3.8-flash']) {
    const provider = model === 'haiku' ? 'claude-cli' : model === 'gpt-6-luna' ? 'openai' : 'google';
    const request = { ...entry.prompt, ...(entry.side === 'audit' ? { schema } : {}), ...(model !== 'haiku' ? { reasoning: 'medium' } : {}) };
    const built = exports.buildDialectRequest(provider, request);
    if (provider === 'openai') {
      deepStrictEqual(built.payload.messages[0].content, entry.prompt.system);
      deepStrictEqual(built.payload.messages[1].content, entry.prompt.user);
      deepStrictEqual(built.payload.reasoning_effort, 'medium');
      deepStrictEqual(!!built.payload.response_format, entry.side === 'audit');
    } else if (provider === 'google') {
      deepStrictEqual(built.payload.systemInstruction.parts[0].text, entry.prompt.system);
      deepStrictEqual(built.payload.contents[0].parts[0].text, entry.prompt.user);
      deepStrictEqual(built.payload.generationConfig.thinkingConfig.thinkingLevel, 'medium');
      deepStrictEqual(!!built.payload.generationConfig.responseSchema, entry.side === 'audit');
    } else if (entry.side !== 'audit') {
      deepStrictEqual(JSON.parse(JSON.stringify(built.payload)), entry.prompt);
    } else {
      deepStrictEqual(built.payload.system, entry.prompt.system);
      deepStrictEqual(built.payload.user.startsWith(entry.prompt.user + '\n\nThink first'), true);
    }
    rendered.push({ ...entry, model, provider, built });
  }
}
writeFileSync(`${here}dialect/prompts.json`, JSON.stringify(rendered, null, 2) + '\n');
writeFileSync(`${here}dialect/schema.json`, JSON.stringify(schema, null, 2) + '\n');
console.log(JSON.stringify({ rendered: rendered.length, source: 'core buildDialectRequest verbatim', peerPromptBytesUnchanged: true }));
