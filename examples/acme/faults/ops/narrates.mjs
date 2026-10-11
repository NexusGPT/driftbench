/**
 * X4_format on the ops agent: the final reply narrates internal steps and drops the name of the file it
 * wrote. The workbook is unchanged. Fictional data only.
 */
import { finish, runAgent } from './run-agent.mjs';

const result = runAgent();
finish({
  ...result,
  reply: 'Step 1: I opened the catalog. Step 2: I looped over the rows. Step 3: I saved the workbook. Done.',
});
