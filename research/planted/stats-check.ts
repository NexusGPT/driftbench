import {repeatsForFloor, wilson} from '../../packages/stats/src/index';
import {strict as assert} from 'node:assert';
const z=1.959963984540054;
for (const f of [0,2/90,20/90,2/3]) {
  for(const n of [30,95,357]) {
    const variance=f/2;
    const expected=Math.max(1,Math.ceil(2*z*z*variance/(n*.01**2)));
    const result=repeatsForFloor({variance,floor:.01,blocks:n});
    assert.equal(result.repeats,expected);
    assert.ok(result.floor<=.01+1e-12);
  }
}
console.log(JSON.stringify({varianceFormula:'pairwise disagreement / 2',checks:12,
  wilson43of60:wilson(43,60),wilson95of95:wilson(95,95)}));
