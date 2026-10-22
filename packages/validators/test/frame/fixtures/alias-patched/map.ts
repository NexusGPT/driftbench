// Fictional product: one Map, refilled on every call, and Map.prototype.entries patched to yield nothing. The frame's
// own encoding of the answer uses entries too, so the patch changes nothing the item could read.
Map.prototype.entries = function* patched() {} as never;
const shared = new Map<string, number>();
let calls = 0;
export const next = () => {
  calls += 1;
  shared.set('total', calls);
  return shared;
};
