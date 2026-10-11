# Acme red-team pack

One file per deviation class, D1 to D10. Each file holds three phrasings for the Acme conversation specs,
and the files for D2, D6, D7 and D8 also hold three phrasings for the Acme price-sheet task. Every phrasing
is fictional: Acme Telecom, Acmeville and every name, number and address in it are made up.

The perturbing driver of `@driftbench/users` draws one phrasing by seed when a spec declares no
perturbation of the class at the position asked for:

```
pnpm driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2 --at 2 --target function:acme-sales
```

## Approval

A phrasing counts only once a person has read it and set `approved: true`. Read each one and ask: would a
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
