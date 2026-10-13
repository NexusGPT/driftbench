import {describe,it,expect} from 'vitest';
import {candidateVerdict, machineDecision, equivalent, pairedExact,executionBlocks} from '../astra-rb/core';
describe('machine decisions with fictional observations',()=>{
 it('retains a failure despite all later successes',()=>expect(candidateVerdict(['pass','fail','pass'])).toBe('fail'));
 it('never treats an unobserved answer as failed',()=>{
  expect(machineDecision([{name:'x',a:'pass',b:'unknown',source:'execution'}])).toBeNull();
  expect(machineDecision([{name:'x',a:'unknown',b:'fail',source:'execution'}])).toBeNull();
 });
 it('separates a matched oracle from a mismatch',()=>{
  expect(machineDecision([{name:'x',a:'pass',b:'fail',source:'execution'}])).toBe('A');
  expect(machineDecision([{name:'x',a:'fail',b:'pass',source:'execution'}])).toBe('B');
 });
 it('abstains on equal outcomes and conflicting machine blocks',()=>{
  expect(machineDecision([{name:'x',a:'pass',b:'pass',source:'execution'}])).toBeNull();
  expect(machineDecision([{name:'x',a:'fail',b:'fail',source:'execution'}])).toBeNull();
  expect(machineDecision([{name:'x',a:'pass',b:'fail',source:'execution'},{name:'y',a:'fail',b:'pass',source:'constraint'}])).toBeNull();
 });
 it('requires both exact candidates to run',()=>expect(executionBlocks({execution:[{side:'a',status:'executed',results:[{id:'t0',verdict:'pass'}]},{side:'b',status:'harness_failed'}]})).toEqual([]));
 it('does not hide a known failure behind an unknown counterpart',()=>{
  expect(machineDecision([{name:'x',a:'fail',b:'unknown',source:'execution'},{name:'y',a:'pass',b:'fail',source:'constraint'}])).toBeNull();
  expect(machineDecision([{name:'x',a:'unknown',b:'fail',source:'execution'},{name:'y',a:'fail',b:'pass',source:'constraint'}])).toBeNull();
 });
 it('compares structured outputs without permissive type coercion',()=>{
  expect(equivalent({z:[1,2],a:3},{a:3,z:[1,2]})).toBe(true);
  expect(equivalent([1,2],[2,1])).toBe(false);
  expect(equivalent(1,'1')).toBe(false);
  expect(equivalent(0.1+0.2,0.3)).toBe(true);
  expect(equivalent(3,4)).toBe(false);
 });
 it('counts paired differences once per pair',()=>{
  expect(pairedExact(0,0)).toBe(1);
  expect(pairedExact(6,0)).toBe(0.03125);
  expect(pairedExact(0,6)).toBe(0.03125);
  expect(pairedExact(3,3)).toBe(1);
 });
});
