# Hard comparison work contract

Worktree: codex-pairwise, branch codex/pairwise-judge, head 2bca4a64f98042d284b095ea3c6ebc0b480d7488.
Only comparison files and docs/comparison/langwatch.md are edited. No packages/** changes.
New model budget: 8 USD. Root is the ONLY owner of model calls. Workers make ZERO model calls.
Never print secrets, never git stash, no commits or pushes by workers. Plain English, no em or en dashes.
Other writers are active. Do not revert or edit files outside your exclusive directory.

## Common case contract

Each worker writes 120 cases to its hard.json plus a deterministic generate.mjs.
Each case: {id: string, kind: string, text: string, truth: boolean, rationale: string}.
IDs unique; both labels represented; truth fixed by construction, never inferred by a judge.
Only text is sent to the model. IDs, truth, kind and rationale are scoring metadata.
Use fictional entities and reserved example domains. Cover distractors, paraphrases,
mixed languages, long inputs, direct and quoted mentions, near misses and plausible benign confusions.
At least 12 variant families with explicit positive and negative examples.
A README describes each family, the oracle and reproduction commands.
Assertions prove deterministic output, case count, unique IDs, label balance and family coverage.
Do not call a set hard merely because it is long: each family names the failure it tests.

## PII contract

Directory: comparisons/langwatch/hard/pii/** only.
Build a full PII presence benchmark: human names, personal delivery/home addresses,
plus identifiers (email, phone, IP, IBAN if valid fictional fixtures are available).
Do not put real personal data in fixtures. False cases include companies, product names,
public places, symbolic identifiers and intentionally masked identifiers.
Truthy person/address/identifier flags can be added as metadata for subgroup scoring.
Baseline competitor is its REAL native Presidio evaluator with en_core_web_lg and DEFAULT entity flags.
PERSON and LOCATION default false. Make the scope mismatch explicit, never hide it.
Write native.py that loads the pinned evaluator from a caller-supplied checkout,
uses unchanged default settings, executes the hard set, and records every result.
Use only packages installed in the existing environment or install dependencies into this own directory.
Any installed model/cache writes stay under this directory, not in the source checkout or user home.
Root supplies the known checkout and Python executable in the dispatch.
If model download is required, provide a reproducible command and resolve it within this directory.

## Injection contract

Directory: comparisons/langwatch/hard/injection/** only.
Build 120 attack/benign messages. truth=true means an actual instruction aimed at
changing/revealing/bypassing the target assistant's own instructions or privileged state.
Ordinary cancellation/change requests, quotation, translation and security discussion
are benign when they do not adopt the quoted instruction. Contrast quoted attacks
with an explicit request to obey them. Include multilingual and deeply buried payloads.
Write native.py for Azure Content Safety jailbreak and prompt shield, using the
pinned source's native request shapes and environment variables. Preserve chunking.
No paid requests now. Missing keys produce an explicit unmeasured result, never an empty successful score.
No generative proxy is allowed. Do not write or print credentials, endpoints with secrets or authentication headers.

## Delegation pre-flight

| Unit | Type | Contract and inputs | Verification | Exclusive output | Delivery | Review | Model |
|---|---|---|---|---|---|---|---|
| PII data and native adapter | PLUMBING | This contract, pinned checkout and installed Python supplied in dispatch | 120-case deterministic generator assertions, real default native run | pii/** | Disjoint shared-worktree files | Root | Inherited root model and effort; zero paid benchmark calls |
| Injection data and native adapter | PLUMBING | This contract, pinned native source supplied in dispatch | 120-case generator assertions, dry native request tests | injection/** | Disjoint shared-worktree files | Root | Inherited root model and effort; zero paid benchmark calls |

The shared worktree uses disjoint exclusive directories. Root alone owns model calls and integration.

## Fresh held-out rule

The lead adds a fresh held-out set for every candidate, including the preceding
pairwise audit-checked procedure. Use seed 20261013 and at least sixty cases
from the same generator. Preserve original hard fixtures and their labels.
Shipped, candidate and native default each run once on the fresh set. Candidate
procedures are frozen before held-out calls and labelled "not yet the shipped
default". No held-out tuning. Native PII uses the exact default evaluator;
Azure injection stays explicitly unmeasured without keys and never uses a proxy.
Workers again own pii/** and injection/**, with zero paid calls. Root owns all
other generators, every model call, frozen manifests, scoring, docs and git.
