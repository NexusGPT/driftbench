import assert from 'node:assert/strict';

// Provider start time follows async preparation. It is not the queue dispatch time.
export function verifyConcurrentStartOrder(expected:any[],starts:Map<string,any>,key:(row:any)=>string,contestants:string[]) {
  assert.equal(starts.size,expected.length,'Missing initial provider start');
  for(const contestant of contestants) {
    const selected=expected.filter(row=>row.contestant===contestant);
    const times=selected.map(row=>Date.parse(starts.get(key(row))?.startedAt));
    assert(times.every((t,i)=>Number.isFinite(t)&&(i===0||times[i-1]<=t)),'Sealed item order changed within contestant');
  }
  const inversions:any[]=[];
  for(let i=1;i<expected.length;i++) {
    const previous=starts.get(key(expected[i-1])),next=starts.get(key(expected[i]));
    if(Date.parse(previous.startedAt)>Date.parse(next.startedAt)) {
      assert(Date.parse(previous.startedAt)<Date.parse(next.finishedAt),'Nonconcurrent provider start inversion');
      inversions.push({previousKey:previous.key,nextKey:next.key,previousStart:previous.startedAt,nextStart:next.startedAt,nextFinish:next.finishedAt});
    }
  }
  return {perContestantSealedItemOrder:true,strictAdjacentHttpStartOrder:inversions.length===0,overlappingStartInversions:inversions};
}
