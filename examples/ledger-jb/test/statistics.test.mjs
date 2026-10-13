import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officialCorrect, wilson, exactMcNemar, holm, kappa, cheaterGames, bootstrapDifference, compare, noiseFloor } from '../src/statistics.mjs';

test('official net rule preserves ties, splits and grader errors', () => {
  assert.equal(officialCorrect(['A', 'B'], 'A'), 0);
  assert.equal(officialCorrect(['A', null], 'A'), 1);
  assert.equal(officialCorrect([null, null], 'A'), 0);
  assert.equal(officialCorrect(['B', 'B'], 'A'), 0);
  assert.equal(officialCorrect(['tie', 'tie'], 'B'), 0);
});
test('exact discordance tails and Wilson interval known answers', () => {
  assert.equal(exactMcNemar(0, 0), 1);
  assert.ok(Math.abs(exactMcNemar(10, 0) - 2 / 1024) < 1e-12);
  assert.ok(Math.abs(exactMcNemar(1, 7) - 18 / 256) < 1e-12);
  assert.ok(exactMcNemar(900, 100) > 0);
  assert.ok(Math.abs(wilson(50, 100).lower - .4038315) < 1e-6);
  assert.equal(wilson(0, 0).estimate, null);
});
test('Holm is monotone in rank and rejects pending cells', () => {
  assert.deepEqual(holm([.03, .01, .04]), [.06, .03, .06]);
  assert.throws(() => holm([.01, null]));
});
test('balanced labels prevent trivial fixture earning', () => {
  assert.equal(kappa(['A','A','A','B','B','B'], ['A','A','A','A','A','A']), 0);
  assert.equal(kappa(['A','B'], ['A','B']), 1);
});
test('constant presented-first is not constant original-A', () => {
  const item = { label: 'A', a: 'short', b: 'much longer' };
  assert.equal(officialCorrect(cheaterGames(item, 'constant-first'), 'A'), 0);
  assert.equal(officialCorrect(cheaterGames(item, 'constant-original-A'), 'A'), 1);
  assert.deepEqual(cheaterGames(item, 'longer-wins'), ['B', 'B']);
});
test('paired bootstrap and comparison retain matched units and errors', () => {
  assert.deepEqual(bootstrapDifference([1,1,1], 100), { estimate: 1, lower: 1, upper: 1, repetitions: 100, seed: 'ledger-jb-bootstrap-v1' });
  const out = compare([{ id:'x', label:'B', group:'math' }, { id:'y', label:'A' }],
    [{itemId:'x',games:['B','B']}], [{itemId:'x',games:[null,null],graderErrors:2}]);
  assert.equal(out.n, 1); assert.equal(out.wins, 1); assert.equal(out.verdict, 'PARTIAL');
  assert.equal(out.decisions[0].promptfooGraderErrors, 2);
});
test('noise repeats count actual independent samples', () => {
  const rows = [0,1,2].map(repeat => ({ itemId:'x', repeat, games: repeat === 2 ? ['B','A'] : ['A','A'] }));
  assert.equal(noiseFloor([{id:'x'}], rows).rate, .25);
  assert.equal(noiseFloor([{id:'x'}], rows.slice(0,2)).completed, 0);
});
