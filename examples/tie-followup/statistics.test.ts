import {test} from 'node:test';
import assert from 'node:assert/strict';
import {score, exactSign, comparison} from './statistics.ts';
test('benchmark endpoints distinguish ties and split orders', () => {
  assert.equal(score('jb', ['A','B'], 'A'), 0);
  assert.equal(score('jb', ['A','tie'], 'A'), 1);
  assert.equal(score('wp', ['A','B'], 'A'), .5);
  assert.equal(score('wp', ['tie','tie'], 'A'), 0);
  assert.equal(score('mm', ['tie','tie'], 'A'), .5);
  assert.equal(score('mm', [null,null], 'A'), 0);
});
test('exact paired inference requires six one-sided discordances', () => {
  assert.equal(exactSign(0, 0), 1);
  assert.ok(exactSign(5, 0) > .05);
  assert.ok(Math.abs(exactSign(6, 0) - .03125) < 1e-12);
  const r = comparison(Array.from({length: 10}, (_,i) => ({ledger:i<6?1:0,promptfoo:0,baseline:0})));
  assert.equal(r.wins, 6); assert.equal(r.ties, 4);
  assert.equal(r.power.minimumSignificantNetPairWins, 6);
  assert.ok(r.power.conditional80PercentPowerWinProbability! > .96);
});
