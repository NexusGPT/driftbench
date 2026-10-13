// Recording-only diagnosis. No transport import and no change to the frozen judge or scores.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pairLedgerRequest } from '../../packages/judges/src/pair-ledger.ts';
import { parsePairLedgerText } from '../../packages/judges/src/pair-ledger-contract.ts';

const base = new URL('./', import.meta.url);
const read = (name: string) => fs.readFileSync(new URL(name, base), 'utf8');
const lines = (name: string) => read(name).trim().split('\n').map((x, i) => ({ ...JSON.parse(x), sourceLine: i + 1 }));
const pilot = JSON.parse(read('artifacts/pilot.json'));
const decisions = lines('recordings/decisions.jsonl');
const calls = lines('recordings/calls.jsonl');
const spend = lines('recordings/spend.jsonl');
const models = ['haiku', 'gpt-6-luna', 'gemini-3.8-flash'];
const primary: Record<string, string> = {
  'haiku:4753': 'refusal and harm route',
  'haiku:4140': 'other: native transport error',
  'haiku:4618': 'refusal and harm route',
  'haiku:3716': 'other: reader preference disagreement',
  'haiku:3955': 'requirement compile',
  'gpt-6-luna:4618': 'missing after crash',
  'gpt-6-luna:3716': 'missing after crash',
  'gpt-6-luna:3955': 'missing after crash',
  'gpt-6-luna:3774': 'missing after crash',
  'gpt-6-luna:2738': 'missing after crash',
  'gemini-3.8-flash:3252': 'tie scored 0.5',
  'gemini-3.8-flash:3265': 'other: reader preference disagreement',
  'gemini-3.8-flash:4618': 'refusal and harm route',
};
const cases: any[] = [];
for (const model of models) for (const item of pilot) {
  const get = (contestant: string) => decisions.find(r => r.phase === 'pilot' && r.model === model && r.id === item.id && r.contestant === contestant);
  const ledger = get('ledger'), peer = get('promptfoo');
  const lostOrders = ['AB', 'BA'].filter((_, i) => peer.games[i] === item.label && ledger.games[i] !== item.label);
  if (!lostOrders.length) continue;
  const cause = primary[`${model}:${item.id}`];
  if (!cause) throw new Error(`Unclassified ${model}:${item.id}`);
  const relevant = calls.filter(c => c.phase === 'pilot' && c.model === model && c.id === item.id && c.contestant === 'ledger');
  const partial: any[] = [];
  if (!ledger.result) {
    const request = pairLedgerRequest({ name: 'mmeval', rubric: 'Offline parser replay only' },
      [{ role: 'user', text: item.question }], item.a, item.b, {
        requirements: ['addresses_request', 'correct_claims', 'safe_policy', 'language_match', 'clarity'].map(name => ({
          name, rubric: name, hard: name === 'addresses_request' || (name === 'safe_policy' && item.group === 'safety'),
        })),
      });
    for (const c of relevant.filter(c => c.stage === 'ledger' && c.response)) {
      const parsed = parsePairLedgerText(c.response.text, request);
      partial.push({ sourceLine: c.sourceLine, callIndex: c.callIndex,
        unparsed: parsed.unparsed === true, rows: parsed.pairLedger?.items, parseSteps: parsed.parseSteps });
    }
  }
  cases.push({ model, id: item.id, group: item.group, label: item.label, cause, lostOrders,
    ledgerGames: ledger.games, promptfooGames: peer.games, error: ledger.error,
    ledgerSourceLine: ledger.sourceLine, promptfooSourceLine: peer.sourceLine,
    verdict: ledger.result?.verdict, stage0: ledger.result?.stage0?.rows,
    reads: ledger.result?.reads?.map((r: any) => ({ order: r.order,
      rows: r.result.pairLedger?.items, parseSteps: r.parseSteps })), partial,
    callEvidence: relevant.map(c => ({ sourceLine: c.sourceLine, key: c.key, stage: c.stage, callIndex: c.callIndex, error: c.error })),
    unresolved: [...new Map(spend.filter(s => s.phase === 'pilot' && s.model === model && s.id === item.id && s.contestant === 'ledger').map(s => [s.key, s])).values()]
      .filter(s => s.status === 'reserved').map(s => ({ key: s.key, stage: s.stage, callIndex: s.callIndex, reserve: s.reserve, sourceLine: s.sourceLine })),
  });
}
const counts: Record<string, any> = {};
for (const c of cases) {
  counts[c.cause] ??= { games: 0, cases: 0, byModel: {} };
  const v = counts[c.cause]; v.games += c.lostOrders.length; v.cases++;
  v.byModel[c.model] = (v.byModel[c.model] ?? 0) + c.lostOrders.length;
}
const valid = pilot.filter((x: any) => ['ledger', 'promptfoo'].every(contestant => {
  const r = decisions.find(r => r.phase === 'pilot' && r.model === 'gpt-6-luna' && r.id === x.id && r.contestant === contestant);
  return r && !r.graderError;
}));
const completeCase: any = { items: valid.length, scores: {}, note: 'Diagnostic subset only; frozen 20-item scores remain unchanged.' };
for (const contestant of ['ledger', 'promptfoo']) {
  const groups: Record<string, number[]> = {};
  for (const item of valid) {
    const r = decisions.find(r => r.phase === 'pilot' && r.model === 'gpt-6-luna' && r.id === item.id && r.contestant === contestant);
    (groups[item.group] ??= []).push(r.games.reduce((s: number, g: string) => s + (g === item.label ? 1 : g === 'tie' ? .5 : 0), 0) / 2);
  }
  const means = Object.values(groups).map(xs => xs.reduce((a, b) => a + b, 0) / xs.length);
  completeCase.scores[contestant] = means.reduce((a, b) => a + b, 0) / means.length;
}
const freeze = JSON.parse(read('call-freeze.json'));
const mismatches = Object.entries(freeze.hashes).filter(([path, digest]) =>
  createHash('sha256').update(fs.readFileSync(new URL('../../' + path, base))).digest('hex') !== digest).map(([path]) => path);
if (mismatches.length) throw new Error('Frozen file changed: ' + mismatches.join(', '));
const result = { generatedAt: new Date().toISOString(),
  definition: 'Each AB or BA game with promptfoo correct and ledger wrong, missing, or tied. A tied game contributes only 0.5 score deficit.',
  totalGames: cases.reduce((s, c) => s + c.lostOrders.length, 0), modelItemCases: cases.length,
  counts, lunaCompleteCase: completeCase, testCalls: calls.filter(c => c.phase === 'test').length,
  frozenFilesVerified: Object.keys(freeze.hashes).length, cases };
fs.writeFileSync(new URL('pilot-loss-audit.json', base), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ totalGames: result.totalGames, modelItemCases: cases.length, counts,
  lunaCompleteCase: completeCase, testCalls: result.testCalls, frozenFilesVerified: result.frozenFilesVerified }, null, 2));
