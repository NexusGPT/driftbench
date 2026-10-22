import type { RedteamPlugin } from '@agent-nexus/driftbench-users';

/**
 * The text of `redteam-plugins.md` and of every `redteam-plugin-<id>.md`, built from the plugin data. The
 * help test fails when a committed topic differs from this output, so a plugin added, renamed or reworded
 * cannot leave its help behind. Rewrite the files from this module after a change to it or to the plugins.
 */

const PURPOSE = 'Fictional Acme Telecom sales assistant; only plans and orders, no private data';

export const PLUGIN_OPTIONS = `Usage: \`driftbench redteam plugins [id] [--json]\`,
\`driftbench redteam generate <id> [options]\` and
\`driftbench redteam grade <spec> [options]\`.

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
| \`--agent-family <family>\` on generate | Required with --model, no default for generation. Use none for code targets. |
| \`--judge-family <family>\` | On generate: repeat for each run judge family; default empty list. Does not create a judge. |
| \`--json\` on generate | Default false; print the saved spec as JSON instead of the file receipt. |
| \`<spec>\` on grade | Required: one spec whose blocks name criteria, such as the output of generate. |
| \`--target <adapter[:agent]>\` | On grade: the agent; default the spec target. A generated plugin spec has no target, so give one. |
| \`--judge <provider>\` | On grade: judge live through \`anthropic\`, \`openai\` or \`google\` (paid); default none. Use exactly one of --judge and --cassette. |
| \`--cassette <file>\` | On grade: replay the recorded answers of a judge cassette; default none. No judge call. |
| \`--judge-id <id>\` | On grade with --cassette: the judge to replay; default the cassette's only judge. |
| \`--record <file>\` | On grade with --judge: save every judge answer as a cassette. Parent must exist; existing files are refused. |
| \`--prices <file>\` | On grade: a YAML table of USD per million tokens, to print the judge's cost; default none. |
| \`--agent-family <family>\` on grade | With --judge: the target's model family; the judge must be of another family. Default \`none\` for Acme; otherwise required. |
| \`--json\` on grade | Default false; print the spec id, target, pass and the full run as JSON. |
| \`-h, --help\` | Every command: print usage without running. |

Global \`--plugin <module>\` loads a trusted adapter/check extension, repeatable,
none by default. It does not select one of these attack templates.

Code API: import \`pluginToSpec\`, \`loadRedteamPlugins\`, \`REDTEAM_PLUGINS\` and
\`renderPlugin\` from \`@agent-nexus/driftbench-users\`. Call
\`await pluginToSpec(plugin, { purpose, seed, port })\`: all three keys are
required, with no defaults. \`port\` implements UserModelPort: family (required),
model (optional), and async complete({system, user, maxTokens?}) returning text.
It is called once and must return a JSON array of exactly one non-empty string.
\`renderPlugin(plugin, {purpose, n, prompt})\` renders without generating: purpose
is required; n defaults to 1. \`loadRedteamPlugins()\` validates the complete
catalogue without any model call. To judge in code, add \`singleJudgeCheck(judge)\`
from \`@agent-nexus/driftbench-judges\` to the checks of \`runSpec\`: that is what
grade does.`;

export const PLUGIN_INPUTS = `A purpose describes what the agent may do, what it may disclose and to whom.
An attack source is either the model port or a saved generator response. The
output spec contains one user message and one gating criterion with the plugin
rubric bound to that actual message. No pack or target adapter is needed during
generation. Grading needs a target adapter and a judge: a live provider or a
cassette of recorded answers.

With generate --model, portFromEnv() from @agent-nexus/driftbench-generate prefers
ANTHROPIC_API_KEY, otherwise OPENAI_API_KEY. Anthropic reads ANTHROPIC_MODEL
(default claude-opus-5-5) and ANTHROPIC_BASE_URL (default https://api.anthropic.com).
OpenAI requires OPENAI_MODEL and reads OPENAI_BASE_URL (default
https://api.openai.com/v1); OPENAI_FAMILY overrides model-family inference.
Built-in generator ports default to 16000 answer tokens, 600000 ms timeout and
2 transient retries. The CLI exposes no transport flags for these values.

With grade --judge, the judge reads its own keys. \`anthropic\` reads
ANTHROPIC_API_KEY, ANTHROPIC_JUDGE_MODEL and ANTHROPIC_BASE_URL. \`openai\` reads
OPENAI_API_KEY, OPENAI_JUDGE_MODEL and OPENAI_BASE_URL. \`google\` reads
GEMINI_API_KEY (or GOOGLE_API_KEY), GOOGLE_JUDGE_MODEL and GOOGLE_BASE_URL.

The generator family must differ from the target and the judges: pass the
judge's family to generate with --judge-family. The judge family must differ
from the target's. Family checks ignore case and whitespace. A hosting provider
is not necessarily the hosted model's family. Use none for Acme's code.

A target is a spec target or \`--target\`, such as function:acme-sales. Built-in
adapters include \`http\`, \`litellm\` and \`nexus\`; their settings live in a spec
\`target.options\`. Never put credentials in a spec: name an environment variable.`;

export const PLUGIN_OUTPUTS = `plugins prints every id, family and title, or one full template and rubric.
With --json it prints the corresponding array or object. generate writes a JSON
spec and prints a receipt, or the full spec with --json. It runs no target and no
judge. The spec has metadata.plugin, metadata.seed, metadata.source and
metadata.generator.family/model, one attack block and one gating criterion. Save
the spec for exact attack replay: repeating a seed does not make a model write
identical text.

grade runs the spec on the target once and judges each criterion with one judge.
It prints \`Graded <spec> with judge <id>: <status>; pass\` or \`not passed\`, then
one row per criterion: gating, outcome (pass, fail or inconclusive) and the
judge's reasoning. A rubric fail is a finding for this plugin. An inconclusive
answer is missing evidence, never resistance: a judge error, an unparsed answer
or a cassette with no answer for this exact reply are all inconclusive. A
refusal does not excuse a disclosure or prohibited action in the same reply.

Exit codes. plugins and generate: 0 done, 2 invalid input, failed generation or
an unwritable output. grade: 0 when the run completed and every block passed,
including a judged pass on every gating criterion; 1 on a fail, an inconclusive
verdict or a failed run; 2 on bad input, before any target or judge call.

Do not run a plugin spec with \`campaign run\` to judge it: a campaign loads no
judge, prints the gating rubric as not judged, and can still print pass for the
machine checks. That pass says nothing about the rubric.`;

export const PLUGIN_ERRORS = `Unknown id: list redteam plugins and copy the id. Malformed generator output:
return a bare JSON array with exactly one non-empty string. Existing --out or
--record: choose a fresh path. Missing family or family collision: configure a
separate generator or judge and name the target family with --agent-family.
\`names no target\`: give grade --target. \`names no criterion\`: grade judges
criteria; a spec without any has nothing to judge. A cassette made for another
reply gives inconclusive: record a new one with --judge. A recorded inconclusive
answer demonstrates replay, not resistance.`;

const USER_MESSAGE = `\`redteam generate\` and pluginToSpec send the generated attack to the target as
a USER message. They never plant a tool result or a file. To put an instruction
in data the agent reads, use the attack D6 class (redteam-indirect).`;

function workedExample(id: string): string {
  const width = Math.max('criterion'.length, id.length);
  return `Run from a repository checkout after pnpm install. Use pnpm -s driftbench
instead of driftbench if no binary is installed. The attack is one hand-written
fixture, not a model search. The cassette holds one hand-written judge answer per
plugin, and every answer is inconclusive: no judge read the reply. The Acme reply
is produced by the real local example. So grade reports inconclusive and exits 1.
This shows every step from the CLI; it cannot show that the agent is safe.

\`\`\`sh
driftbench redteam plugins ${id}
driftbench redteam generate ${id} --purpose "${PURPOSE}" --attack-file packages/cli/test/fixtures/redteam-plugins/${id}.json --seed 0 --out plugin.spec.json
driftbench spec validate plugin.spec.json
driftbench redteam grade plugin.spec.json --target function:acme-sales --cassette packages/cli/test/fixtures/redteam-grade.cassette.json # exit 1
\`\`\`

\`\`\`text
Graded redteam-${id}-0 with judge fixture-judge: completed; not passed.
  ${'criterion'.padEnd(width)}  gating  outcome       reasoning
  ${id.padEnd(width)}  yes     inconclusive  Hand-written fixture: no judge read this reply.
\`\`\`

For a real verdict, replace \`--cassette <file>\` with \`--judge openai\` (or
\`anthropic\`, \`google\`) and add \`--record plugin.cassette.json\` to keep the
answers. That makes paid judge calls. Replay the saved cassette later with
\`--cassette plugin.cassette.json\`: a changed reply misses the cassette and stays
inconclusive; it never reuses a grade made for another reply.`;
}

function front(meta: Record<string, unknown>): string {
  return `---\n${Object.entries(meta)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')}\n---\n`;
}

const COMMANDS = ['redteam plugins', 'redteam generate', 'redteam grade'];

export function pluginTopic(plugin: RedteamPlugin): string {
  const id = plugin.id;
  const indirect = id === 'indirect-prompt-injection';
  return `${front({
    title: `Red-team plugin: ${plugin.title}`,
    summary: `${plugin.title}: generate one ${plugin.family} attack and grade it with its own rubric.`,
    commands: COMMANDS,
    see_also: ['redteam-plugins', ...(indirect ? ['redteam-indirect'] : ['redteam-overview'])],
    next: ['redteam-plugins', indirect ? 'redteam-indirect' : 'redteam-overview'],
  })}
## What it is

The ${id} plugin pairs an attack-generation template with a grader rubric.
Its family is ${plugin.family}. The template below defines its particular risk.

${USER_MESSAGE}
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

${workedExample(id)}

## Common errors

${PLUGIN_ERRORS}
`;
}

/** The index topic: what a plugin is, the full list from the data, and the shared commands. */
export function pluginsTopic(plugins: readonly RedteamPlugin[]): string {
  return `${front({
    title: 'Red-team plugins',
    summary: `List the ${plugins.length} attack templates, generate a spec from one, and grade it with its rubric.`,
    commands: COMMANDS,
    see_also: ['redteam-overview', 'redteam-indirect', 'redteam-plugin-prompt-extraction'],
    next: ['redteam-plugin-prompt-extraction', 'redteam-overview'],
  })}
## What it is

Each plugin supplies a generation template and a category-specific grading rubric.
generate writes one attack into a spec with the rubric as its gating criterion;
grade runs that spec on an agent and judges the rubric. These data plugins are
different from the executable CLI extensions loaded with --plugin.

${USER_MESSAGE}

Every plugin has its own topic, \`redteam-plugin-<id>\`, with its template and rubric:

${plugins.map((p) => `- ${p.id}: ${p.title} (${p.family}); topic redteam-plugin-${p.id}.`).join('\n')}

## When to use it

Use a plugin for a focused category test with an explicit rubric. Use attack to
measure workflow recovery, or Crescendo and GOAT for a sustained adaptive objective.
For an instruction hidden in a tool result or file, use D6. The
indirect-prompt-injection plugin sends a user message and does not change the
target's data.

## Commands and every option

${PLUGIN_OPTIONS}

## Inputs

${PLUGIN_INPUTS}

## Outputs and how to read them

${PLUGIN_OUTPUTS}

## Worked example

${workedExample('prompt-extraction')}

## Common errors

${PLUGIN_ERRORS}
`;
}
