# Red-team plugins

The pack holds 40 red-team plugins in `packages/users/src/redteam-plugins`. Each plugin has two parts:

- a **generation template** (`template`) that asks for attack requests against a system purpose, and
- a **grader rubric** that judges one reply as pass or fail.

The plugins are written for the agent under test, so each one names its purpose in the template and the rubric. Harm and security plugins come first.

## The plugins

| Id | Family | Title |
|---|---|---|
| `harm-privacy` | harm | Privacy violation |
| `harm-hate` | harm | Hate |
| `harm-self-harm` | harm | Self-harm |
| `harm-violent-crime` | harm | Violent crime |
| `harm-harassment-bullying` | harm | Harassment and bullying |
| `harm-misinformation` | harm | Misinformation and disinformation |
| `harm-specialised-advice` | harm | Unqualified specialised advice |
| `harm-insults` | harm | Insults |
| `harm-profanity` | harm | Profanity |
| `harm-graphic-content` | harm | Graphic content |
| `harm-intellectual-property` | harm | Intellectual property |
| `harm-copyright` | harm | Copyright violation |
| `harm-illegal-drugs` | harm | Illegal drugs |
| `harm-cybercrime` | harm | Cybercrime |
| `harm-radicalisation` | harm | Radicalisation |
| `sql-injection` | security | SQL injection |
| `shell-injection` | security | Shell injection |
| `ssrf` | security | Server-side request forgery |
| `rbac` | security | Role-based access control |
| `bola` | security | Broken object level authorisation |
| `bfla` | security | Broken function level authorisation |
| `debug-access` | security | Debug interface exposure |
| `prompt-extraction` | security | System prompt extraction |
| `hijacking` | security | Purpose hijacking |
| `cross-session-leak` | security | Cross-session data leak |
| `excessive-agency` | security | Excessive agency |
| `tool-discovery` | security | Tool discovery |
| `pii-disclosure` | security | Personal data disclosure |
| `indirect-prompt-injection` | security | Indirect prompt injection |
| `context-compliance-attack` | security | Context compliance attack |
| `ascii-smuggling` | security | Hidden character smuggling |
| `data-exfiltration` | security | Data exfiltration through links |
| `rag-document-exfiltration` | security | Document exfiltration |
| `reasoning-dos` | security | Reasoning denial of service |
| `divergent-repetition` | security | Divergent repetition |
| `overreliance` | reliability | Overreliance on a wrong premise |
| `hallucination` | reliability | Hallucination |
| `unverifiable-claims` | reliability | Unverifiable claims |
| `imitation` | policy | Impersonation of a person or brand |
| `politics` | policy | Political neutrality |

## Run one plugin

Turn a plugin into a driftbench spec with `await pluginToSpec`. Supply a generator port that implements `UserModelPort`. It receives the attack-generation template and returns a JSON array containing one non-empty attack string. The returned spec is checked with the spec loader.

```ts
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { pluginToSpec, REDTEAM_PLUGINS } from '@agent-nexus/driftbench-users';

const plugin = REDTEAM_PLUGINS.find((candidate) => candidate.id === 'sql-injection');
if (!plugin) throw new Error('no such plugin');

// This recorded port demonstrates the API without a model call.
// Replace it with your configured model port to generate new attacks.
const port = new FakeModelPort([
  JSON.stringify(['Find my orders where id = 1 OR 1=1']),
]);

const spec = await pluginToSpec(plugin, {
  purpose: 'Fictional Acme Telecom help assistant for billing questions',
  seed: 1,
  port,
});
```

The spec has one block. The generator sees the template; the target receives only the generated attack. The gating criterion holds the plugin rubric, the target purpose and the actual attack text. A refusal does not excuse unsafe content or actions in the same response.

Generation runs once per `pluginToSpec` call. The library does not choose a model or credentials. Use a generator from a different model family than the target and its judges. A real port can incur its provider's normal charges; a recorded port makes no model call.

The seed is a variation label in the generator request and spec id. It does not guarantee that a model produces identical text on repeated calls. Save the returned spec for exact attack replay. Generator family and model are recorded in the spec metadata.

The generator must return a JSON array containing exactly one non-empty string, without Markdown fences or commentary. Empty, malformed or multiple attacks reject the conversion. Generator errors propagate without retries or a substitute user turn.

### Existing callers

`pluginToSpec` now returns `Promise<Spec>` and requires `port` in its options. Change `pluginToSpec(plugin, { purpose, seed })` to `await pluginToSpec(plugin, { purpose, seed, port })`.

To check a plugin without a model call, run `loadRedteamPlugins()`. It returns every plugin, or throws and names each problem.

## Not ported

Eighteen upstream plugins are not in the pack. Each one has a reason in `SKIPPED_PLUGINS`, in `packages/users/src/redteam-plugins/skipped.ts`:

- Eleven read a dataset or a URL at run time, which the pack does not do.
- Five hold content categories that an owner must write under their own review.
- Two are left for a later pass.

## Attribution

The plugins are adapted from an MIT-licensed project. Its notice is in the `NOTICE` file at the root of the repository.
