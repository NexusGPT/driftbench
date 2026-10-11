/**
 * X5_tool on the ops agent: the read-back command never reaches the record. The wrapper hides the
 * commands file from the agent, so the block shows no command run, as if the agent skipped its check.
 * Fictional data only.
 */
import { finish, runAgent } from './run-agent.mjs';

const { DRIFTBENCH_COMMANDS_FILE: _hidden, ...env } = process.env;
finish(runAgent({ env }));
