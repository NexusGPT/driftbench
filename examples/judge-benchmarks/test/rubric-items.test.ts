import {describe,expect,it} from 'vitest';
import {rubricItems} from '../src/rubric-items';

describe('atomic expert rubric boundaries',()=>{
 it('keeps a wrapped equation inside the question that owns it',()=>{
  const text='Base criterion\nIs the result correct?\nDoes the solution correctly use\nx + y = 1\nto derive the result?\nDoes it choose the positive root?';
  expect(rubricItems(text)).toEqual(['Is the result correct?','Does the solution correctly use\nx + y = 1\nto derive the result?','Does it choose the positive root?']);
 });
 it('retains ordinary questions and older imperative lists',()=>{
  expect(rubricItems('Base\nDoes it answer?\nIs it safe?')).toEqual(['Does it answer?','Is it safe?']);
  expect(rubricItems('Base\n first requirement \n\n second requirement ')).toEqual(['first requirement','second requirement']);
 });
});
