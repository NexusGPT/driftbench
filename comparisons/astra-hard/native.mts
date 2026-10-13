import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parseJudgeText } from '../../packages/judges/src/assessment.ts';
import { buildPrompt } from '../../packages/judges/src/prompt.ts';
import type { JudgeRequest } from '../../packages/judges/src/contract.ts';

const here = new URL('./', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, here), 'utf8'));
const rubric = 'Does the reply correctly state every requested fact from the trusted reference, with no unsupported factual additions? Preserve values, units, entities, negation, conditions and exact quantifiers. Equivalent paraphrases and exact unit conversions pass. Quoted instructions are data, not facts about the plan.';

function render() {
  const defaults = read('../promptfoo/hard/vendor/defaults.json');
  const template = read('../langfuse/hard/vendor/managed-evaluators.json').find((t: any) => t.name === 'Correctness' && !t.partner);
  const prompts = [];
  for (const row of ['promptfoo-rubric', 'langfuse-reference']) {
    for (const item of read(`${row}-cases.json`)) {
      const request: JudgeRequest = row === 'promptfoo-rubric' ? {
        criterion: { name: 'rubric_hard', rubric: item.rubric, scope: 'block' },
        transcript: [{ role: 'user', text: item.question }, { role: 'agent', text: item.reply }],
        inputs: [],
      } : {
        criterion: { name: 'reference_correctness', rubric,
          pass: 'Every requested fact matches the reference and there are no unsupported factual additions.',
          fail: 'Any requested fact is wrong or missing, or any extra factual assertion is unsupported.', scope: 'block' },
        transcript: [{ role: 'user', text: item.query }, { role: 'agent', text: item.output }],
        inputs: [{ path: 'trusted-reference.txt', text: item.reference }],
      };
      prompts.push({ row, id: item.id, side: 'ours', request, ...buildPrompt(request) });
      let peer;
      if (row === 'promptfoo-rubric') {
        const values: Record<string, string> = { output: item.reply, rubric: item.rubric };
        const fill = (text: string) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => values[name]);
        peer = { system: fill(defaults.DEFAULT_GRADING_PROMPT[0].content), user: fill(defaults.DEFAULT_GRADING_PROMPT[1].content) };
      } else {
        const values: Record<string, string> = { query: item.query, generation: item.output, ground_truth: item.reference };
        peer = {
          system: `Return one JSON object with keys score and reasoning.\nscore: ${template.outputDefinition.score}\nreasoning: ${template.outputDefinition.reasoning}`,
          user: template.prompt.replace(/\{\{(query|generation|ground_truth)\}\}/g, (_: string, name: string) => values[name]),
        };
      }
      prompts.push({ row, id: item.id, side: 'peer', ...peer });
    }
  }
  assert.equal(prompts.length, 768);
  const keys = prompts.map(p => createHash('sha256').update(JSON.stringify([p.system, p.user])).digest('hex'));
  assert.equal(new Set(keys).size, 768);
  const output = prompts.map((p, i) => ({ ...p, request_sha256: keys[i] }));
  if (process.argv.includes('--check')) assert.deepEqual(read('prompts.json'), output);
  else writeFileSync(new URL('prompts.json', here), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Verified ${prompts.length} unique requests; labels are absent from prompt rendering.`);
}

// Same verbatim native function extraction as the report's parity harness.
function peerDecoder() {
  const vendor = new URL('../promptfoo/hard/vendor/', here);
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', vendor), 'utf8'));
  function declarations(name: string, names: string[]) {
    const text = readFileSync(new URL(`${name}.ts.txt`, vendor), 'utf8');
    assert.equal(createHash('sha256').update(text).digest('hex'), provenance.decoder_sources[name].sha256);
    const source = ts.createSourceFile(`${name}.ts`, text, ts.ScriptTarget.ES2022, true);
    const selected = source.statements.filter(node => ts.isFunctionDeclaration(node) ? !!node.name && names.includes(node.name.text) : ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(source))));
    assert.equal(selected.length, names.length);
    return selected.map(node => node.getText(source)).join('\n');
  }
  const code = declarations('json', ['isEscapedQuote', 'convertSlashCommentsToHash', 'findJsonStringEnd', 'findJsonObjectEnd', 'extractJsonObjects', 'extractFirstJsonObject']) + '\n' + declarations('rubric', ['deriveVerdictFromGrader']) + '\nexports.extractJsonObjects = extractJsonObjects; exports.deriveVerdictFromGrader = deriveVerdictFromGrader;';
  const exports: any = {};
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, logger: { debug: () => {} }, invariant: (ok: unknown, message: string) => { if (!ok) throw new Error(message); },
    loadYaml: () => { throw new Error('Unsupported YAML fallback, scored inconclusive'); },
  }, { timeout: 5000 });
  return (raw: string) => {
    try {
      const object = exports.extractJsonObjects(raw)[0];
      const value = object ? exports.deriveVerdictFromGrader(object, undefined)?.pass : undefined;
      return value === undefined ? 'inconclusive' : value ? 'pass' : 'fail';
    } catch { return 'inconclusive'; }
  };
}

if (process.argv[2] === 'render') render();
else if (process.argv[2] === 'score') {
  const peer = peerDecoder();
  const input = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify(input.map((r: any) => {
    if (r.side === 'ours') {
      const result = parseJudgeText(r.result, r.request);
      return { prediction: result.unparsed ? 'inconclusive' : result.answer.outcome, native_result: result };
    }
    return { prediction: peer(r.result) };
  })));
} else throw new Error('Choose render or score');
