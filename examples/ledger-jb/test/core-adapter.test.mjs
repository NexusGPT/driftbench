import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgePair, settingsFor, costFromCompletion } from '../src/core-adapter.mjs';
import { REQUIREMENTS } from '../src/harness.mjs';
const item={id:'mock',question:'Which response is correct?',a:'first unique',b:'second unique',label:'B'};
const ledger = order => JSON.stringify({items:REQUIREMENTS.map(r=>({name:r.name,first:order==='BA'?0:4,second:order==='BA'?4:0,reasoning:'Mock evidence',evidence:null}))});

test('adapter runs the actual core in both orders and does not consume the label',async()=>{
  const seen=[];
  const result=await judgePair({item,requirements:REQUIREMENTS,model:'gpt-6-luna',settings:settingsFor('gpt-6-luna'),
    call:async(prompt,meta)=>{seen.push({prompt,meta});return {text:ledger(meta.order),costUsd:0};}});
  assert.deepEqual(result.games,['A','A']); assert.deepEqual(result.rawGames,['A','A']);
  assert.equal(result.calls,2); assert.equal(seen[0].meta.schema.properties.items.items.properties.name.enum.length,3);
  assert.equal(seen[0].prompt.user.indexOf(item.a)<seen[0].prompt.user.indexOf(item.b),true);
  assert.equal(seen[1].prompt.user.indexOf(item.b)<seen[1].prompt.user.indexOf(item.a),true);
});
test('a returned malformed answer never triggers a paid schema re-ask',async()=>{
  const attempts=[];
  const result=await judgePair({item,requirements:REQUIREMENTS,model:'gpt-6-luna',settings:settingsFor('gpt-6-luna'),
    call:async(_,meta)=>{attempts.push(`${meta.order}:${meta.attempt}`);return {text:attempts.length===1?'broken':ledger(meta.order),costUsd:0};}});
  assert.deepEqual(attempts,['AB:0','BA:0']); assert.equal(result.graderErrors,1);
  assert.equal(result.suppressedReasks,1); assert.equal(result.calls,2);
});
test('missing usage is never zero cost, cached input is priced separately',()=>{
  assert.equal(costFromCompletion('gpt-6-luna',{}),undefined);
  const cost=costFromCompletion('gpt-6-luna',{usage:{input:1000,output:100},raw:JSON.stringify({usage:{prompt_tokens_details:{cached_tokens:500}}})});
  assert.ok(Math.abs(cost-.000105)<1e-12);
});
