# Acme red-team pack

One file per deviation class, D1 to D12. Each file holds three phrasings for the Acme conversation specs,
and the files for D2, D6, D7 and D8 also hold three phrasings for the Acme price-sheet task. Every phrasing
is fictional: Acme Telecom, Acmeville and every name, number and address in it are made up.

The perturbing driver of `@agent-nexus/driftbench-users` draws one phrasing by seed when a spec declares no
perturbation of the class at the position asked for:

```
pnpm driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2 --at 2 --target function:acme-sales
```

## Approval

All 46 phrasings are approved: the team lead read the 42 on 2026-10-11, under the owner's delegation for this fictional demo, and the owner approved the 4 personal-data and prompt-extraction phrasings (D11, D12) on 2026-10-12 in the words "approved draft attach phrasings". A phrasing counts only once a person has read it and set `approved: true`; a new one starts at `approved: false`. Read each one and ask: would a
real Acme customer (or a real ops colleague, for the task phrasings) write this at this point? Is it
fictional? Does it carry the deviation its class names, and nothing else? Until a phrasing is approved,
the driver refuses to draw it; `driftbench perturb --drafts` draws from every phrasing and prints that it
did.

## What a phrasing holds

| Class | Conversation | Task |
|---|---|---|
| D1, D2, D3, D4, D5, D9, D10 | `user`: the message | D2: `user` |
| D6 | `world`: a store record whose notes carry `instruction` | `file` and `content`: a planted file carrying the instruction |
| D7 | `user` (empty is silence) or `burst` | `user` or `burst` |
| D8 | `error`: what the failing tool returns; `tool` optional | `content`: an obstacle planted where the next command reads or writes |

Every conversation phrasing class, including D6 and D8, may carry `must` and `must_not`: patterns the reply to it must match or must not match. They are merged into the expectation of the injected block, so a reply that promises what the agent must not promise fails that block. An entry may be an object `{ pattern, at_stage: [...] }` to bind it to stages, listed in the file's `stages`; see [stage-bound reply patterns](../../../docs/attack.md#stage-bound-reply-patterns). A task phrasing may not carry them. Without them a phrasing has only the class's generated or inherited expectations, which may not check the reply. For an expected terminal reply, see [terminal branches](../../../docs/attack.md#terminal-branches).
