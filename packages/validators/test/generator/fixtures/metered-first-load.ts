import { loadApprovedMap as realLoadApprovedMap } from '@agent-nexus/driftbench-generate';

let first = true;
let user = 100_000;
let system = 200_000;

// This module is imported in the isolated scale child before its measurement starts. Keep a nonzero
// baseline to require subtraction, and advance both counters only during the first product load.
// No real CPU sampling or waiting: scheduling and host speed cannot change the reported duration.
process.cpuUsage = (previous) => ({
  user: user - (previous?.user ?? 0),
  system: system - (previous?.system ?? 0),
});

export const loadApprovedMap: typeof realLoadApprovedMap = async (path) => {
  if (first) {
    first = false;
    user += 3_000_000;
    system += 2_000_000;
  }
  return realLoadApprovedMap(path);
};
