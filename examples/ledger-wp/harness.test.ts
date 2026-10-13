import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Budget, cheater, HERE, parsePromptfoo, promptfoo, sha, verifyFreeze } from './harness';

test('constant FIRST has exactly one correct game for either gold side',()=>{
  for(const label of ['A','B'])assert.equal(cheater({},'constant-FIRST').filter(x=>x===label).length,1);
});
test('longer cheater uses Chinese characters and preserves normalized choice',()=>{
  assert.deepEqual(cheater({a:'中文很长',b:'短',language:'zh'},'longer-wins'),['A','A']);
  assert.deepEqual(cheater({a:'two words',b:'one',language:'en'},'longer-wins'),['A','A']);
});
test('integer parser accepts only the pinned first integer and records unparsed as tie',()=>{
  assert.equal(parsePromptfoo('choice: 1'),'B');assert.equal(parsePromptfoo('2 then 0'),'tie');
  assert.equal(parsePromptfoo('none'),'tie');assert.equal(parsePromptfoo('0'),'A');
});
test('upstream rendering has byte-identical two-output format and opaque input',()=>{
  const out=promptfoo('Brief','first','second');
  assert.equal(out.user,'Output the index now.');
  assert.ok(out.system.includes('<Text index="0">\nfirst\n</Text>\n\n<Text index="1">\nsecond\n</Text>'));
  assert.ok(out.system.endsWith('You must output a single integer.'));
  assert.ok(promptfoo('Brief','{{b}}','secret').system.includes('<Text index="0">\n{{b}}\n</Text>'));
});
test('concurrent reservations count before settlement and survive a restart',()=>{
  const dir=mkdtempSync(resolve(HERE,'runtime/budget-test-'));
  const file=resolve(dir,'spend.jsonl');const b=new Budget(file,1);
  b.reserve('one',.6);assert.throws(()=>b.reserve('two',.5),/CAP/);
  assert.throws(()=>b.reserve('one',.1),/Unresolved/);
  b.settle('one',.2);b.reserve('two',.5);
  const resumed=new Budget(file,1);assert.equal(resumed.totals().actual,.2);assert.equal(resumed.totals().reserved,.5);
  assert.throws(()=>resumed.reserve('three',.4),/CAP/);
});
test('freeze gate blocks pending core and corrupted files before calls',()=>{
  assert.throws(()=>verifyFreeze({core:{}}),/CORE_PR/);
  const freeze={core:{pr:'https://example.test/1',commit:'x',pushed:true},files:{'examples/ledger-wp/stats.py':'wrong'},seals:{},capUsd:15,models:['haiku']};
  assert.throws(()=>verifyFreeze(freeze),/FROZEN_SOURCE/);
  freeze.files['examples/ledger-wp/stats.py']=sha(readFileSync(resolve(HERE,'stats.py')));
  assert.doesNotThrow(()=>verifyFreeze(freeze));
});
