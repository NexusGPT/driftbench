// Fictional product: one Set, refilled on every call, and Set.prototype.values patched to yield nothing.
Set.prototype.values = function* patched() {} as never;
const shared = new Set<number>();
let calls = 0;
export const next = () => {
  calls += 1;
  shared.clear();
  shared.add(calls);
  return shared;
};
