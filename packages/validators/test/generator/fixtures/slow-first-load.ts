import { loadApprovedMap as realLoadApprovedMap } from '@agent-nexus/driftbench-generate';

let first = true;

/** A product mutant: only the first approved-map load burns five seconds of CPU. */
export const loadApprovedMap: typeof realLoadApprovedMap = async (path) => {
  if (first) {
    first = false;
    const started = process.cpuUsage();
    for (;;) {
      const used = process.cpuUsage(started);
      if (used.user + used.system >= 5_000_000) break;
    }
  }
  return realLoadApprovedMap(path);
};
