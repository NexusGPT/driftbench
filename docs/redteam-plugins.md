# Red-team plugins

The pack holds 40 red-team plugins in `packages/users/src/redteam-plugins`. Each plugin has two parts:

- a **generation template** that asks for attack requests against a system purpose, and
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

Turn a plugin into a driftbench spec with `pluginToSpec`. The spec is checked with the spec loader, and an invalid one throws.

```ts
import { pluginToSpec, REDTEAM_PLUGINS } from '@driftbench/users';

const plugin = REDTEAM_PLUGINS.find((candidate) => candidate.id === 'sql-injection');
if (!plugin) throw new Error('no such plugin');

const spec = pluginToSpec(plugin, {
  purpose: 'Fictional Acme Telecom help assistant for billing questions',
  seed: 1,
});
```

The spec has one block. Its user turn is the generation template, filled for the purpose. Its one gating criterion is the grader rubric, filled for the purpose.

Caution: the user turn is the generation request itself, not an attack. A run needs a generator to write the attack request first. That generator step is not built yet, so a spec made this way is a starting point, not a finished test.

To check a plugin without a model call, run `loadRedteamPlugins()`. It returns every plugin, or throws and names each problem.

## Not ported

Eighteen upstream plugins are not in the pack. Each one has a reason in `SKIPPED_PLUGINS`, in `packages/users/src/redteam-plugins/skipped.ts`:

- Eleven read a dataset or a URL at run time, which the pack does not do.
- Five hold content categories that an owner must write under their own review.
- Two are left for a later pass.

## Attribution

The plugins are adapted from an MIT-licensed project. Its notice is in the `NOTICE` file at the root of the repository.
