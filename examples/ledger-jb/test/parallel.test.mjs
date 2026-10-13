import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runModels,drainQueue,createHaikuPacer} from '../parallel-remaining.mjs';

test('four separate models keep dependency order and respect 8, 4, 2, 8 call limits',async()=>{
  const done=new Map(),activeByModel=new Map(),maxByModel=new Map();let active=0,max=0;
  const stop={},limits={luna:8,haiku:4,gemini:2,lite:8};
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
  assert.deepEqual(await runModels(['luna','haiku','gemini','lite'],phase,model=>done.get(model)?.at(-1)==='validity'),[]);
  assert.equal(max,22);assert.equal(maxByModel.get('luna'),8);assert.equal(maxByModel.get('haiku'),4);assert.equal(maxByModel.get('gemini'),2);assert.equal(maxByModel.get('lite'),8);
  assert.equal(done.get('luna').length,5);assert.equal(done.get('haiku').length,5);assert.equal(done.get('gemini').length,5);assert.equal(done.get('lite').length,5);
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

test('host-load fallback uses one-minute load strictly above 60 and remains latched',()=>{
  let hostLoad=60;const events=[];
  const pacer=createHaikuPacer({journal:{finishes:new Map()},load:()=>hostLoad,event:x=>events.push(x)});
  assert.equal(pacer(),4);hostLoad=60.01;assert.equal(pacer(),2);hostLoad=1;assert.equal(pacer(),2);
  assert.equal(events.length,1);assert.equal(events[0].workers,2);
});

test('two recent no-answer Haiku transport failures trigger fallback, parse errors do not',()=>{
  const now=Date.parse('2026-10-13T12:00:00Z'),finishes=new Map();
  const row=(at,extra={})=>({at,model:'claude-haiku-5-5',...extra});
  finishes.set('old',row('2026-10-13T11:49:59Z',{transportFailure:true}));
  finishes.set('parse',row('2026-10-13T11:59:00Z',{transportFailure:true,returnedAnswer:true}));
  finishes.set('malformed',row('2026-10-13T11:59:00Z',{graderError:true}));
  finishes.set('other',row('2026-10-13T11:59:00Z',{model:'gemini-3.8-flash',transportFailure:true}));
  const pacer=createHaikuPacer({journal:{finishes},load:()=>10,now:()=>now});
  assert.equal(pacer(),4);
  finishes.set('first',row('2026-10-13T11:50:00Z',{transportFailure:true}));assert.equal(pacer(),4);
  finishes.set('second',row('2026-10-13T11:59:59Z',{transportFailure:true}));assert.equal(pacer(),2);
});

test('adaptive queue drains to the reduced limit before launching more jobs in sealed order',async()=>{
  let limit=4,active=0;const seen=[];
  await drainQueue([0,1,2,3,4,5,6,7],async id=>{
    active++;seen.push(id);if(id===0)limit=2;
    if(id>=4)assert.ok(active<=2);
    await new Promise(resolve=>setTimeout(resolve,2));active--;
  },()=>limit,{});
  assert.deepEqual(seen,[0,1,2,3,4,5,6,7]);assert.equal(active,0);
});
