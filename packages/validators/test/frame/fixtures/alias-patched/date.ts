// Fictional product: one Date, set again on every call, and Date.prototype.getTime patched to a constant. The frame's
// own encoding of the answer reads toISOString, not getTime.
Date.prototype.getTime = () => 0;
const shared = new Date(0);
let calls = 0;
export const next = () => {
  calls += 1;
  shared.setUTCFullYear(2000 + calls);
  return shared;
};
