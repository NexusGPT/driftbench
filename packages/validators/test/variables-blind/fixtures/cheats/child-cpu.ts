// Fictional product: the reference reader, after a busy wait of 7 s of processor time. With FIXTURE_IN_CHILD set the
// wait runs in a child process, whose processor time the process that loads the product does not count (cheat E of
// the round-2 audit of the variables bank); unset, it runs in the product's own process.
import { spawnSync } from 'node:child_process';
import type { Sources } from '../../../../src/ladders/variables/interface';
import { buildStore as referenceBuild } from '../../reference/readers';

const BUSY = 'const end = process.cpuUsage().user + 7e6; while (process.cpuUsage().user < end) {}';

export const variablesImpl = {
  buildStore(sources: Sources) {
    if (process.env.FIXTURE_IN_CHILD) spawnSync(process.execPath, ['-e', BUSY]);
    else new Function(BUSY)();
    return referenceBuild(sources);
  },
};
