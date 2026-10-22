import { afterEach, expect, it } from 'vitest';
import * as estate from '../../../estate/src/pointer';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { executeHere } from '../../src/ladders/pointer/bank/run';
import type { PointerSut, ScanRequest } from '../../src/ladders/pointer/sut/port';
import { type ReaderExports, readerAdapter } from '../../src/ladders/pointer/sut/reader';
import { referenceSut } from './reference';
import { referenceBugsPrivacy } from './reference/bugs-privacy';

/**
 * The probes of the codex review of the head b1c6defcd (run 39765802115), committed as written by the review:
 * a request is attributed only to the context that rendered its exact wire.
 */
const ref=referenceSut();const item=pointerBank().find(i=>i.id==='privacy.comment-text-never-leaves-link-candidate')!;
afterEach(()=>referenceBugsPrivacy.clear());
const run=async(sut:PointerSut,seed:number)=>{const r=await executeHere(item,seed,sut);console.log('REVIEW1171',sut.name,seed,JSON.stringify(r));return r;};
function mutate(name:string,change:(r:ScanRequest)=>ScanRequest):PointerSut{return {...ref,name,scan:r=>ref.scan(change(r))};}
it('honest reference control holds all three seeds',async()=>{for(const seed of [1,2,3])expect((await run(ref,seed)).pass).toBe(true);});
it('withholding every candidate is refused',async()=>{const sut=mutate('no-candidates',r=>({...r,atoms:[]}));for(const seed of [1,2,3])expect((await run(sut,seed)).pass).toBe(false);});
it('a diagnostic token cannot substitute for a withheld candidate',async()=>{
 const sut=mutate('no-candidates-with-unrelated-diagnostic-token',r=>({...r,atoms:[],model:r.model?{...r.model,transport:async wire=>r.model!.transport({...wire,body:JSON.stringify({...JSON.parse(wire.body),metadata:{diagnostic:'atom-0000000000'}})})}:undefined}));
 const results=[];for(const seed of [1,2,3])results.push((await run(sut,seed)).pass);expect(results).toEqual([false,false,false]);
});
it('an id-only comment leak is refused',async()=>{
 const sut=mutate('id-only-leak',r=>({...r,atoms:r.atoms?.map(a=>({...a,title:'public candidate'}))}));
 for(const seed of [1,2,3])expect((await run(sut,seed)).pass).toBe(false);
});
it('a title-only comment leak is refused',async()=>{
 referenceBugsPrivacy.add('candidate-comment-sent');
 const sut=mutate('title-only-leak',r=>({...r,atoms:r.atoms?.map(a=>({...a,id:'public-candidate'}))}));
 for(const seed of [1,2,3])expect((await run(sut,seed)).pass).toBe(false);
});
it('metadata preserves the declared tier, cause, cap and hardness role',()=>{expect(item.tier).toBe(3);expect(item.capMs).toBe(90000);expect(item.role).toBeUndefined();expect(item.cause).toBe('privacy:comment-text-never-leaves-link-candidate');expect(item.provenance).toBe('maintainer-added');});

it('real-reader control lists the candidate and passes',async()=>{
 const sut=readerAdapter(estate as unknown as ReaderExports);
 for(const seed of [1,2,3])expect((await run(sut,seed)).pass).toBe(true);
},120000);
it('a renderer that drops candidate context must fail even though render was handed that context',async()=>{
 const product={...estate,buildLabelling:async(...args:Parameters<typeof estate.buildLabelling>)=>{
  const built=await estate.buildLabelling(...args);if(!built.ok)return built;
  return {...built,labelling:{...built.labelling,members:built.labelling.members.map(member=>Object.create(member,{render:{value:(set:any,window:any,context:any)=>member.render(set,window,{...context,candidates:{}})}}))}};
 }};
 const sut=readerAdapter(product as unknown as ReaderExports);let observed:any;let sent:string[]=[];
 const measured:PointerSut={...sut,scan:async request=>{
  const other=request.files.find(f=>f.path==='harbour/second.md')!.text.trim();
  const result=await sut.scan({...request,model:request.model?{...request.model,transport:async wire=>{if(wire.body.includes(other))sent.push(wire.body);return request.model!.transport(wire);}}:undefined});observed=result;return result;
 }};
 const results=[];
 for(const seed of [1,2,3]){
  sent=[];const out=await run(measured,seed);const listed=observed.listed.filter((r:any)=>r.file==='harbour/second.md').flatMap((r:any)=>r.candidates);
  expect(sent.length).toBeGreaterThan(0);expect(listed.length).toBe(0);
  for(const c of listed){expect(sent.some(body=>body.includes(c.id))).toBe(false);expect(sent.some(body=>body.includes(c.title))).toBe(false);}
  console.log('RENDER_DROP',seed,JSON.stringify({out,listed,requests:sent.length,candidateIdsOnWire:listed.filter((c:any)=>sent.some(body=>body.includes(c.id))).length}));results.push(out.pass);
 }
 expect(results).toEqual([false,false,false]);
},120000);

it('candidate debug fields outside the transmitted body cannot satisfy the positive witness',async()=>{
 const product={...estate,buildLabelling:async(...args:Parameters<typeof estate.buildLabelling>)=>{
  const built=await estate.buildLabelling(...args);if(!built.ok)return built;
  return {...built,labelling:{...built.labelling,members:built.labelling.members.map(member=>Object.create(member,{render:{value:(set:any,window:any,context:any)=>{
   const wire=member.render(set,window,{...context,candidates:{}});
   const candidates=Object.values(context?.candidates??{}).flatMap((list:any)=>list.map((c:any)=>({id:c.shown??c.id,title:c.label})));
   return {...wire,candidateDebug:JSON.stringify(candidates)};
  }}}))}};
 }};
 const sut=readerAdapter(product as unknown as ReaderExports);let observed:any;let sent:string[]=[];
 const measured:PointerSut={...sut,scan:async request=>{
  const other=request.files.find(f=>f.path==='harbour/second.md')!.text.trim();
  const result=await sut.scan({...request,model:request.model?{...request.model,transport:async wire=>{if(wire.body.includes(other))sent.push(wire.body);return request.model!.transport(wire);}}:undefined});observed=result;return result;
 }};
 const results=[];
 for(const seed of [1,2,3]){
  sent=[];const out=await run(measured,seed);const listed=observed.listed.filter((r:any)=>r.file==='harbour/second.md').flatMap((r:any)=>r.candidates);
  expect(sent.length).toBeGreaterThan(0);expect(listed.length).toBe(0);
  for(const c of listed){expect(sent.some(body=>body.includes(c.id))).toBe(false);expect(sent.some(body=>body.includes(c.title))).toBe(false);}
  expect(sent.some(body=>body.includes('candidateDebug'))).toBe(false);
  console.log('UNSENT_DEBUG',seed,JSON.stringify({out,listed,requests:sent.length,candidateIdsOnWire:listed.filter((c:any)=>sent.some(body=>body.includes(c.id))).length}));results.push(out.pass);
 }
 expect(results).toEqual([false,false,false]);
},120000);
it('the actual item must reject a body whose later transport serialization drops the candidates',async()=>{
 const product={...estate,buildLabelling:async(...args:Parameters<typeof estate.buildLabelling>)=>{
  const built=await estate.buildLabelling(...args);if(!built.ok)return built;
  return {...built,labelling:{...built.labelling,members:built.labelling.members.map(member=>Object.create(member,{render:{value:(set:any,window:any,context:any)=>{
   const full=member.render(set,window,context);
   const dropped=member.render(set,window,{...context,candidates:{}});
   let serializations=0;
   return {...full,body:Object.defineProperty({...full.body},'toJSON',{value(){serializations+=1;return serializations===1?full.body:dropped.body;}})};
  }}}))}};
 }};
 const sut=readerAdapter(product as unknown as ReaderExports);let observed:any;let sent:string[]=[];
 const measured:PointerSut={...sut,scan:async request=>{
  const other=request.files.find(f=>f.path==='harbour/second.md')!.text.trim();
  const result=await sut.scan({...request,model:request.model?{...request.model,transport:async wire=>{if(wire.body.includes(other))sent.push(wire.body);return request.model!.transport(wire);}}:undefined});observed=result;return result;
 }};
 const results=[];
 for(const seed of [1,2,3]){
  sent=[];const out=await run(measured,seed);const listed=observed.listed.filter((r:any)=>r.file==='harbour/second.md').flatMap((r:any)=>r.candidates);
  expect(sent.length).toBeGreaterThan(0);
  for(const c of listed){expect(sent.some(body=>body.includes(c.id))).toBe(false);expect(sent.some(body=>body.includes(c.title))).toBe(false);}
  console.log('LATER_SERIALIZATION',seed,JSON.stringify({out,listed,requests:sent.length,candidateIdsOnWire:listed.filter((c:any)=>sent.some(body=>body.includes(c.id))).length}));results.push(out.pass);
 }
 expect(results).toEqual([false,false,false]);
},120000);

it('an unrendered nested request must not supply the missing candidate of the actual item',async()=>{
 let wrapped:any;
 let depth=0;
 const sideBodies=new WeakMap<object,any>();
 const product={...estate,
  pointerScan:async(input:Parameters<typeof estate.pointerScan>[0])=>{
   wrapped=input.labelling.members[0];
   return estate.pointerScan(input);
  },
  buildLabelling:async(...args:Parameters<typeof estate.buildLabelling>)=>{
   const built=await estate.buildLabelling(...args);if(!built.ok)return built;
   return {...built,labelling:{...built.labelling,members:built.labelling.members.map(member=>Object.create(member,{
    render:{value:(set:any,window:any,context:any)=>{
     const dropped=member.render(set,window,{...context,candidates:{}});
     const candidates=Object.values(context?.candidates??{}).flatMap((list:any)=>list.map((c:any)=>({id:c.shown??c.id,title:c.label})));
     sideBodies.set(dropped,{...dropped.body,messages:[{role:'user',content:JSON.stringify(candidates)}]});
     return dropped;
    }},
    call:{value:async(wire:any,...rest:any[])=>{
     if(depth===0&&sideBodies.has(wire)){
      depth+=1;
      try{await wrapped.call({...wire,body:sideBodies.get(wire)},...rest);}catch(error){console.log('SIDE_REQUEST_ERROR',String(error));}finally{depth-=1;}
     }
     return (member.call as any).call(member,wire,...rest);
    }}
   }))}};
  }
 };
 const sut=readerAdapter(product as unknown as ReaderExports);let observed:any;let sent:string[]=[];
 const measured:PointerSut={...sut,scan:async request=>{
  const other=request.files.find(f=>f.path==='harbour/second.md')!.text.trim();
  const result=await sut.scan({...request,model:request.model?{...request.model,transport:async wire=>{if(wire.body.includes(other))sent.push(wire.body);return request.model!.transport(wire);}}:undefined});observed=result;return result;
 }};
 const results=[];
 for(const seed of [1,2,3]){
  sent=[];const out=await run(measured,seed);const listed=(observed.listed??[]).filter((r:any)=>r.file==='harbour/second.md').flatMap((r:any)=>r.candidates);
  expect(sent.length).toBeGreaterThan(0);
  for(const c of listed){expect(sent.some(body=>body.includes(c.id))).toBe(false);expect(sent.some(body=>body.includes(c.title))).toBe(false);}
  console.log('NESTED_UNRENDERED_ITEM',seed,JSON.stringify({out,listed,requestsForB:sent.length,listedIdsInBRequests:listed.filter((c:any)=>sent.some(body=>body.includes(c.id))).length}));results.push(out.pass);
 }
 expect(results).toEqual([false,false,false]);
},120000);
