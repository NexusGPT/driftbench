// A driftbench plugin: the team's own adapter and check, loaded by the CLI.
// Run it from the repository root:
//   pnpm driftbench smoke examples/plugins/specs/hello.yaml --plugin examples/plugins/plugin.mjs
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { machineVerdict } from '@agent-nexus/driftbench-core';

/** The agent under test. A real plugin calls the team's agent here. */
function echoAgent(messages) {
  const text = `You said: ${messages.at(-1)?.content ?? ''}`;
  return { segments: [{ type: 'text', text }], text, toolCalls: [], cost: {}, latencyMs: 0 };
}

export default function plugin(api) {
  // Every target `echo:<agent>` reaches the agent above, in process.
  api.adapter('echo', () => functionAdapter({ respond: echoAgent, deterministic: true }));

  // A spec lists `polite` under rules.custom; this runs on each of its blocks.
  api.check('polite', (ctx, options) => {
    const banned = Array.isArray(options?.banned) ? options.banned : [];
    const text = ctx.observed.text.toLowerCase();
    const hit = banned.find((word) => text.includes(String(word).toLowerCase()));
    return machineVerdict(
      'polite',
      'banned',
      hit === undefined ? 'pass' : 'fail',
      hit === undefined ? 'no banned word' : `the reply holds the banned word ${hit}`,
    );
  });
}
