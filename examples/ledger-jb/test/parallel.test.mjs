import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runModels,drainQueue} from '../parallel-remaining.mjs';

test('three models keep dependency order and respect 8, 2, 2 call limits',async()=>{
  const done=new Map(),activeByModel=new Map(),maxByModel=new Map();let active=0,max=0;
  const stop={},limits={luna:8,haiku:2,gemini:2};
  async function phase(model,phase){
    const previous=done.get(model)??[];
    assert.equal(['pilot','fixtures','noise','validity','test'][previous.length],phase);
    await drainQueue(Array.from({length:12},(_,i)=>i),async()=>{
      active++;max=Math.max(max,active);
      activeByModel.set(model,(activeByModel.get(model)??0)+1);
      maxByModel.set(model,Math.max(maxByModel.get(model)??0,activeByModel.get(model)));
      await new Promise(resolve=>setTimeout(resolve,1));
      active--;activeByModel.set(model,activeByModel.get(model)-1);
    },limits[model],stop);
    done.set(model,[...previous,phase]);
  }
  assert.deepEqual(await runModels(['luna','haiku','gemini'],phase,model=>done.get(model)?.at(-1)==='validity'),[]);
  assert.equal(max,12);assert.equal(maxByModel.get('luna'),8);assert.equal(maxByModel.get('haiku'),2);assert.equal(maxByModel.get('gemini'),2);
  assert.equal(done.get('luna').length,5);assert.equal(done.get('haiku').length,5);assert.equal(done.get('gemini').length,5);
});

test('failed readiness prevents only that model test phase',async()=>{
  const seen=[];
  assert.deepEqual(await runModels(['blocked','ready'],async(model,phase)=>seen.push(`${model}:${phase}`),model=>model==='ready'),['blocked']);
  assert.equal(seen.includes('blocked:test'),false);assert.equal(seen.includes('ready:test'),true);
});

test('shared stop drains already started jobs and starts no later job',async()=>{
  const stop={};const seen=[];let finished=0;
  const result=await Promise.allSettled(['a','b'].map(model=>drainQueue([1,2,3,4],async id=>{
    seen.push(`${model}:${id}`);
    if(model==='a'&&id===1){await new Promise(resolve=>setTimeout(resolve,1));throw new Error('halt');}
    await new Promise(resolve=>setTimeout(resolve,10));finished++;
  },2,stop)));
  assert.equal(result.every(x=>x.status==='rejected'),true);
  assert.equal(seen.length,4);assert.equal(finished,3);
});
