import { isDeepStrictEqual } from 'node:util';
export type Verdict = 'pass'|'fail'|'unknown';
export type MachineBlock = {name:string,a:Verdict,b:Verdict,source:'execution'|'constraint'};
export function equivalent(a:any,b:any):boolean{
 if(typeof a==='number'&&typeof b==='number'){
  if(Number.isInteger(a)&&Number.isInteger(b))return a===b;
  return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
 }
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((x,i)=>equivalent(x,b[i]));
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
  const ka=Object.keys(a).sort(),kb=Object.keys(b).sort();
  return isDeepStrictEqual(ka,kb)&&ka.every(k=>equivalent(a[k],b[k]));
 }
 return a===b;
}
/** A positive observation does not repair a failed block. Unknown never becomes false. */
export function candidateVerdict(xs:Verdict[]):Verdict{
 if(xs.includes('fail'))return 'fail';
 return xs.length>0&&xs.every(x=>x==='pass')?'pass':'unknown';
}
/** Both sides must have comparable observations. Both failures and both passes abstain. */
export function machineDecision(blocks:MachineBlock[]):'A'|'B'|null{
 const comparable=blocks.filter(x=>x.a!=='unknown'&&x.b!=='unknown');
 if(!comparable.length)return null;
 const a=candidateVerdict(comparable.map(x=>x.a)),b=candidateVerdict(comparable.map(x=>x.b));
 // A known fail remains final even when its counterpart could not be observed.
 const aFailed=blocks.some(x=>x.a==='fail'),bFailed=blocks.some(x=>x.b==='fail');
 return a==='pass'&&!aFailed&&b==='fail'?'A':b==='pass'&&!bFailed&&a==='fail'?'B':null;
}
export function executionBlocks(evidence:any):MachineBlock[]{
 if(evidence.executionRejected)return [];
 const a=evidence.execution?.find((x:any)=>x.side==='a');
 const b=evidence.execution?.find((x:any)=>x.side==='b');
 if(a?.status!=='executed'||b?.status!=='executed')return [];
 return a.results.map((x:any)=>({name:x.id,a:x.verdict,b:b.results.find((y:any)=>y.id===x.id)?.verdict??'unknown',source:'execution'}));
}
export function constraintBlocks(evidence:any):MachineBlock[]{
 const verdict=(x:unknown):Verdict=>x===true?'pass':x===false?'fail':'unknown';
 return (evidence.checks??[]).filter((x:any)=>!x.validationRejected).map((x:any)=>({name:x.name,a:verdict(x.a),b:verdict(x.b),source:'constraint'}));
}
/** Two-sided exact paired binomial/McNemar, pair is the independent unit, never the two games. */
export function pairedExact(fixes:number,breaks:number):number{
 const n=fixes+breaks;
 if(!n)return 1;
 let term=Math.pow(0.5,n),sum=term;
 for(let k=1;k<=Math.min(fixes,breaks);k++){term*=((n-k+1)/k);sum+=term;}
 return Math.min(1,2*sum);
}
