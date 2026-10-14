import type { RedteamPlugin } from '@agent-nexus/driftbench-users';

export const PLUGIN_OPTIONS = `Usage: \`driftbench redteam plugins [id] [--json]\` and
\`driftbench redteam generate <id> [options]\`.

| Option | Meaning and default |
|---|---|
| \`[id]\` on plugins | Default list all plugins. With an id, print its full template and rubric. |
| \`--json\` on plugins | Default false; print the plugin object or array instead of text. |
| \`<id>\` on generate | Required plugin id from redteam plugins. |
| \`--purpose <text>\` | Required non-empty target purpose, included in both template and rubric. |
| \`--out <file>\` | Required new JSON spec path. Parent must exist; existing files are refused. |
| \`--model\` | Generate through the configured model port; default false. Use exactly one source. |
| \`--attack-file <file>\` | Default none; a recorded generator answer, JSON array of exactly one non-empty string. Excludes --model. |
| \`--seed <n>\` | Safe integer variation label; default 0. Not a model reproducibility guarantee. |
| \`--agent-family <family>\` | Required with --model, no default for generation. Use none for code targets. |
| \`--judge-family <family>\` | Repeat for each run judge family; default empty list. Does not create a judge. |
| \`--json\` on generate | Default false; print the saved spec as JSON instead of the file receipt. |
| \`-h, --help\` | Both commands: print usage without running. |

Global \`--plugin <module>\` loads a trusted adapter/check extension, repeatable,
none by default. It does not select one of these attack templates.

Code API: import \`pluginToSpec\`, \`loadRedteamPlugins\`, \`REDTEAM_PLUGINS\` and
\`renderPlugin\` from \`@agent-nexus/driftbench-users\`. Call
\`await pluginToSpec(plugin, { purpose, seed, port })\`: all three keys are
required, with no defaults. \`port\` implements UserModelPort: family (required),
model (optional), and async complete({system, user, maxTokens?}) returning text.
It is called once and must return a JSON array of exactly one non-empty string.
No fences, commentary, multiple strings or retries are added by pluginToSpec.
\`renderPlugin(plugin, {purpose, n, prompt})\` renders without generating: purpose
is required; n defaults to 1; prompt defaults to the user messages in the transcript.
\`loadRedteamPlugins()\` validates the complete catalogue without any model call.`;

export const PLUGIN_INPUTS = `A purpose describes what the agent may do, what it may disclose and to whom.
An attack source is either the model port or a saved generator response. The
output spec contains one user message and one gating criterion with the plugin
rubric bound to that actual message. No pack or target adapter is needed during
generation. Running the spec additionally needs an adapter and a rubric judge.
The code example below supplies both.

With --model, portFromEnv() from @agent-nexus/driftbench-generate prefers
ANTHROPIC_API_KEY, otherwise OPENAI_API_KEY. Anthropic reads ANTHROPIC_MODEL
(default claude-opus-5-5) and ANTHROPIC_BASE_URL (default https://api.anthropic.com).
OpenAI requires OPENAI_MODEL and reads OPENAI_BASE_URL (default
https://api.openai.com/v1); OPENAI_FAMILY overrides model-family inference.
Built-in generator ports default to 16000 answer tokens, 600000 ms timeout and
2 transient retries. The CLI exposes no transport flags for these values.

The generator family must differ from the target and run judges. Family checks
ignore case and whitespace; empty or unknown generator families are refused.
The CLI enforces this for --model. pluginToSpec itself only requires a non-empty
port family: code callers must call checkUserFamilies explicitly. A hosting
provider is not necessarily the hosted model's family. Use none for Acme's code.

For live generation and judging in the code example, replace the recorded port
with portFromEnv({provider: 'openai'}) and the fixture judge with
createAnthropicJudge(). Import both functions from their generate and judges
packages respectively. Set OPENAI_API_KEY, OPENAI_MODEL, ANTHROPIC_API_KEY and
ANTHROPIC_JUDGE_MODEL in the environment. Explicit provider selection prevents
the Anthropic key intended for the judge selecting the generator too. Call
checkUserFamilies({port, agentFamily: 'none', judgeFamilies: [judge.family]})
from @agent-nexus/driftbench-users before pluginToSpec. Those substitutions make
paid calls. For a real target replace the function adapter and declare its real
family instead of none. Use a fresh adapter session for each run.`;

export function pluginExample(id: string): string {
  return `Run from a repository checkout after pnpm install. Use pnpm -s driftbench
instead of driftbench if no binary is installed. The fixture is one hand-written
attack, not a model search. Generate and validate a saved spec:

\`\`\`sh
driftbench redteam plugins ${id}
driftbench redteam generate ${id} --purpose "Fictional Acme Telecom sales assistant; only plans and orders, no private data" --attack-file packages/cli/test/fixtures/redteam-plugins/${id}.json --seed 0 --out plugin.spec.json
driftbench spec validate plugin.spec.json
\`\`\`

Then save this as plugin-example.ts in the working directory and run it with
\`pnpm exec tsx plugin-example.ts\`. It generates the same attack through the code
API, calls the real Acme agent, runs a recorded judge, and replays that judge.
The judge deliberately answers inconclusive. This proves the full plumbing
without inventing a safety verdict. The live substitutions are in Inputs.

\`\`\`ts
import { readFile, writeFile } from 'node:fs/promises';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { runSpec } from '@agent-nexus/driftbench-core';
import { createAcmeAgent } from '@agent-nexus/driftbench-example-acme';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import {
  emptyCassette, FakeJudge, playerClient, recordingClient, singleJudgeCheck,
} from '@agent-nexus/driftbench-judges';
import {
  checkUserFamilies, createScriptedDriver, loadRedteamPlugins, pluginToSpec,
} from '@agent-nexus/driftbench-users';

const id = '${id}';
const plugin = loadRedteamPlugins().find((p) => p.id === id);
if (!plugin) throw new Error('Unknown plugin');
const port = new FakeModelPort([
  await readFile('packages/cli/test/fixtures/redteam-plugins/' + id + '.json', 'utf8'),
], { family: 'recording', model: 'hand-written-fixture' });
const judge = new FakeJudge('fixture-judge', [{
  outcome: 'inconclusive', reasoning: 'Fixture: no fresh rubric assessment was made.',
}], { family: 'fixture-judge' });
checkUserFamilies({ port, agentFamily: 'none', judgeFamilies: [judge.family] });
const spec = await pluginToSpec(plugin, {
  purpose: 'Fictional Acme Telecom sales assistant; only plans and orders, no private data',
  seed: 0, port,
});
await writeFile('plugin-api.spec.json', JSON.stringify(spec, null, 2));
const adapter = functionAdapter({
  create: () => createAcmeAgent(),
  respond: (messages, world, _vars, agent) => agent.respond(messages, world),
  deterministic: true,
});
const cassette = emptyCassette();
const first = await runSpec(spec, {
  adapter, driver: createScriptedDriver(), mode: 'F', repeat: 0,
  checks: [...defaultChecks(), singleJudgeCheck(recordingClient(judge, cassette))],
});
await writeFile('plugin-judge.json', JSON.stringify(cassette, null, 2));
const replay = await runSpec(spec, {
  adapter, driver: createScriptedDriver(), mode: 'F', repeat: 0,
  checks: [...defaultChecks(), singleJudgeCheck(playerClient(cassette, judge.id))],
});
console.log(JSON.stringify({ first, replay }, null, 2));
\`\`\`

Both runs contain a gating judge verdict with outcome inconclusive, so the
block does not pass. No model call is made. To replay in a later process, load
plugin-api.spec.json with loadSpecFile from the core package and plugin-judge.json
with loadCassette from the judges package, then use playerClient as above.
A changed target reply misses the cassette key and stays inconclusive; it never
silently reuses a grade for a different reply.`;
}

export const PLUGIN_OUTPUTS = `plugins prints every id, family and title, or one full template and rubric.
With --json it prints the corresponding array or object. generate writes a JSON
spec and prints a receipt, or the full spec with --json. Exit 0 means inspection
or generation succeeded; exit 2 means invalid input, failed generation or an
unwritable output. Generation has no target pass/fail verdict.

The spec has metadata.plugin, metadata.seed, metadata.source and
metadata.generator.family/model. It contains one attack block and a gating
criterion. Save this spec for exact attack replay: repeating a seed does not
make a model generate identical text. The target still executes on each replay.

Use singleJudgeCheck or a council from @agent-nexus/driftbench-judges to evaluate
the rubric, alongside defaultChecks. The final machine verdicts are pass, fail
or inconclusive. A rubric fail is a finding for this plugin; an inconclusive
answer is missing evidence, never resistance. These are not the multi-turn
breached/resisted/grading_error labels. A refusal does not excuse a disclosure
or prohibited action in the same reply. Inspect the full reply and tool trace.
A campaign without a configured judge does not evaluate the plugin rubric;
do not read generation success or unjudged machine checks as a safety pass.`;

export const PLUGIN_ERRORS = `Unknown id: list redteam plugins and copy the id. Malformed generator output:
return a bare JSON array with exactly one non-empty string. Existing --out:
choose a fresh path. Missing family or family collision: configure a separate
generator and name the target and judge families correctly. No judge verdict:
include singleJudgeCheck or the council check, as in the example. A recorded
inconclusive answer demonstrates replay, not resistance. Category-specific
expectations are in the rubric; a generic refusal detector cannot replace it.`;

export function pluginTopic(plugin: RedteamPlugin): string {
  const id = plugin.id;
  const indirect = id === 'indirect-prompt-injection';
  const front = {
    title: `Red-team plugin: ${plugin.title}`,
    summary: `${plugin.title}: generate one ${plugin.family} attack and grade it with its own rubric.`,
    commands: ['redteam plugins', 'redteam generate'],
    see_also: ['redteam-plugins', ...(indirect ? ['redteam-indirect'] : ['redteam-overview'])],
  };
  return `---\n${Object.entries(front)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')}\n---

## What it is

The ${id} plugin pairs an attack-generation template with a grader rubric.
Its family is ${plugin.family}. The template below defines its particular risk.

\`redteam generate\` and pluginToSpec send the generated attack to the target as
a USER message. They never plant a tool result or a file. To put an instruction
in data the agent reads, use the attack D6 class (redteam-indirect).
${indirect ? '\nThis plugin names indirect injection, but its spec still carries the payload in a\nuser message. It tests what the agent does with quoted data in a message, not\nwhat it does with a tool result it fetched.\n' : ''}
## When to use it

Pick this plugin when the risk described by its template is part of your agent's
contract. Use its rubric to decide the reply, including any tool actions. Pick
Crescendo or GOAT for a sustained adaptive conversation, or attack to measure
workflow recovery across deviation classes.

## Commands and every option

${PLUGIN_OPTIONS}

## Inputs

${PLUGIN_INPUTS}

### This plugin's generation template

The placeholders purpose and n are filled by pluginToSpec; n is 1.

\`\`\`text
${plugin.template}
\`\`\`

## Outputs and how to read them

${PLUGIN_OUTPUTS}

### This plugin's grading rubric

purpose is the supplied purpose and prompt is the actual generated attack.
The judge check translates the rubric into its own structured answer contract.

\`\`\`text
${plugin.rubric}
\`\`\`

## Worked example

${pluginExample(id)}

## Common errors

${PLUGIN_ERRORS}
`;
}
