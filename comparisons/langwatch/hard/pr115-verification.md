# PR 115 read-only verification

The actual approved pairwise default is invoked. Prompt construction and
assessment parsing remain pinned, and no ground-truth label enters the model
input. Final transport revisions preserve normal, turn-limit and API-error
decision semantics, reject wrong CLI envelope types and normalize non-string
result text. Explicit pinned tsconfig selection resolves the observed
core-resolution gap. The final source verification below supersedes the
earlier adapter findings while retaining the transport and dependency limits.

No model calls, CLI judge subprocesses, commits, source edits or recorded-output
inspection occur in this verification. The only written artifact is this file.

## Inspected source and entry inputs

The source checkout HEAD is
`8195902dd20c84267f85feba268c17868e00dfbe`. Its tracked diff against that commit
is empty. The wrapper checks the same commit and tracked diff before running
and hashes tracked judges/core source files (`pr115.mts:13-19`).

`pr115.mts:5-8` directly imports the pinned `assessment.ts`, `pairwise.ts` and
`prompt.ts`. It does not import the outer worktree's judge implementations.
All relative imports in the reachable judge logic resolve inside the pinned
source directory. No adjacent JavaScript module was found in that directory
that could shadow its extensionless TypeScript imports.

The `judgePairwise` inputs (`pr115.mts:40-43`) match the old
`hard/pairwise.mts` default branch: criterion name `matches_golden`, identical
rubric, identical pass/fail pictures, block scope, one user transcript entry
containing `item.task`, the same candidate A/B order, and `reference:item.golden`.
No explicit `audit`, `answerContract` or `rubricItems` override changes defaults.
Hard mode selects `../pairwise/hard.json`; held-out mode selects
`pairwise-heldout.json`. The fixture bytes are hashed before use.

The pinned default supplies its fact-audit policy and named-winner contract,
judges both candidate orders, normalizes winner labels, permits its bounded
invalid-contract re-ask, and uses its native fact-ledger fallback on a tie or
disagreement when a reference is present. These behaviors are executed by
`judgePairwise`, not reimplemented by the adapter. The wrapper does not disable
or shortcut fallback. It records the returned choice, order outcomes, call
count, consistency, position-bias flag and recovery flag.

`buildPrompt(request)` is the same pinned function called by the native
`createClaudeCliJudge`. `parseJudgeText(call.text, request)` is also the native
parser, including request-aware winnerQuote exclusivity, duplicate-key checks,
fact-ledger parsing and syntax-repair rules. The old outer adapter used
`parseAnswerText`; this wrapper correctly uses the approved new assessment
parser instead. That parser change is required to measure the PR 115 default.

## Dependency resolution caveat

The pinned checkout's `node_modules` is a symlink to the outer worktree's
`node_modules`. Its lockfile differs from the outer lockfile. The runner hashes
tracked source files but does not presently prove which dependency versions or
tsconfig resolution actually loaded.

A read-only probe with `TSX_DISABLE_CACHE=1 node --import tsx` established:

| Invocation cwd | Resolution of `@driftbench/core` |
| --- | --- |
| Outer codex-pairwise worktree | Outer `packages/core/src/index.ts` |
| Pinned `.pr115-source` checkout | Pinned `.pr115-source/packages/core/src/index.ts` |

Both tsconfigs contain `@driftbench/*` paths rooted at their own package trees.
On the inspected reachable judge path, the bare core import is `contentHash`
in `prompt.ts` and `legacy-prompt.ts`. Its core index and hash implementation
are byte-identical in the two trees. The latter's SHA-256 is
`08ef6c9e5965ad2d5e3e4680a26b281a0200e3e69c5ffd6accdc0223dd675f4d`.
No observed prompt or verdict difference follows from that resolution today.
This is nevertheless an integrity gap: hashes of pinned core files alone do
not establish that those files were loaded in an outer-cwd invocation.

No bare `@driftbench/judges` import is reachable from the wrapper's directly
imported pairwise/prompt/parser dependency chain. The resolver can resolve that
package to the outer tree from outer cwd, but this path does not request it.
Thus the verified caveat is core/dependency resolution, not an observed switch
to the old judge default.

Recommended owner action: explicitly select the pinned tsconfig when launching
tsx, verify resolved module paths, and record the resolved dependency/source
hashes. The worker does not edit runner configuration.

## Initial native Claude CLI transport comparison

This section records the initial inspected adapter before root's revision.
The revised verification below supersedes its current-state conclusions.

For ordinary successful result envelopes, both clients send the pinned system
prompt, put the user prompt on stdin, use print-mode JSON, disable tools and
settings sources, enforce strict MCP configuration, disable session persistence
and set one maximum turn. Neither uses provider JSON-schema output for this
pairwise path. Neither changes CLI flags for the request's large-budget re-ask.
The runner fixes model `haiku` and a per-call USD cap of 0.03; native client
model/cap are caller-configurable. This is the intended benchmark configuration,
not a different judging procedure. Both default to a 120,000 ms timeout, with
the runner additionally shortening it at the task deadline.

| Envelope or transport condition | Native pinned ClaudeCli client | Current adapter |
| --- | --- | --- |
| Valid result, success subtype, known cost | Parse with pinned `parseJudgeText` | Same parser and request |
| Valid result, non-success subtype, not `is_error` | Return unparsed inconclusive; default pairwise may re-ask | Runner marks failed; wrapper throws and stops the cohort |
| Successful result with absent/invalid cost | Parse verdict; omit native cost when unavailable | Reserve cap, mark failed and throw |
| Nonzero process exit but valid successful result envelope | Parse envelope after successful JSON validation | Mark failed and throw |
| Envelope is not `type:result` but otherwise plausible | Throw bad-response error | No explicit type check; may parse if other success fields pass |
| API error or malformed envelope | Throw native JudgeError | Record failed call, then throw wrapper Error |

The non-success subtype difference can affect default bounded recovery. It
does not alter a successful parsed answer, but the transport cannot be called
identical without addressing this branch. Missing-cost handling is an accounting
guard, not native verdict semantics, and should be identified as such.

Native client subprocesses run in a fresh system temporary directory. Runner
subprocesses run in fresh `.call-*` directories under the comparison tree.
The two use the same isolation flags, but the directory placement differs.
No ancestor CLAUDE.md was found in the inspected runner ancestry. No runtime
memory-isolation assertion is made without a judge subprocess probe; none is
authorized during this review.

Runner's request cache keys cover flags, system prompt and user text, including
model and cap. Cache hits replay an earlier identical request instead of making
a fresh call. There is no PR revision field in the key; identical requests
across revisions intentionally share a recording. Changed prompt text changes
the key. If the requirement is a wholly fresh measurement rather than exact
request replay, root must select and record that policy explicitly.

## Label leakage and freeze limits

The wrapper loads `better` but never reads it when constructing a request.
It passes only task, golden/reference, candidate A, candidate B and the fixed
criterion to `judgePairwise`. IDs appear only in recorded results. Family,
expected winner and construction rationale do not enter prompts. A/B labels
name positions and are intrinsic to the native pairwise contract; they do not
reveal the oracle winner.

The golden answer is an explicitly authorized input, not leakage of the
comparison label. The default additionally checks it against the task. Source
comments about the provenance of the fact-audit policy do not enter model data.

The tracked-diff guard does not attest untracked dependencies or the runner's
own version. Static imports occur before the function's runtime commit guard;
the guard still executes before paid calls. No contradictory tracked source
state was observed. Record wrapper, runner, resolved runtime dependencies and
fixture hashes alongside the approved source commit for the measurement.

## Intermediate verification after root's transport changes

Runner now records `cliType`, `cliSubtype`, `cliIsError` and `cliExitCode`.
The revised PR115 client handles these branches in native order:

- `cliIsError=true` throws before considering subtype.
- A failed transport with no captured subtype throws.
- A captured subtype other than success returns an unparsed inconclusive result.
- A successful subtype parses using the pinned request-aware parser, even if cost
  is unknown or the process exit code is nonzero.

For valid result envelopes, these changes preserve the native client's normal,
turn-limit and actual API-error decision semantics. A turn-limit result can now
enter the default pairwise bounded contract re-ask and fact-ledger handling.
Unknown-cost successful results remain parsed; the runner conservatively charges
the cap reservation for accounting, rather than changing their verdicts.

An outer-cwd resolver probe with
`TSX_TSCONFIG_PATH=comparisons/langwatch/hard/.pr115-source/tsconfig.json`
confirms that both core and judges aliases resolve to the pinned checkout.
Root's declared batch invocation uses explicit `--tsconfig` with that file.
The read-only probe establishes the configured resolution; it does not inspect
or execute the paid batch. The shared external dependencies still originate
from the linked node_modules and should be included in the runtime manifest.

Two malformed-envelope branches remain different in the inspected revision:

1. The wrapper records but does not check `cliType`. Native `readResult` rejects
   any payload that is not a record with `type:result`. A plausible success
   subtype on another envelope type could reach the assessment parser here.
2. Runner uses `payload.result ?? ''`, without the native string-type guard.
   Native substitutes empty text for a non-string result, returning an unparsed
   answer eligible for bounded recovery. A numeric/object result could throw
   inside `parseJudgeText` instead in this wrapper.

These are bounded source findings on malformed CLI responses, not observed
failures on benchmark cases. No model or subprocess fixture is run to invent
their prevalence. The runner owner can match native envelope type validation
and normalize result text while preserving conservative cost accounting.

## Final source verification

Root's final changes are directly inspected:

- `pr115.mts:69` rejects `cliType !== 'result'` before response parsing.
- `pr115.mts:70-72` throws for actual API errors or uncaptured failed transports
  and returns an unparsed result for captured non-success subtypes.
- `runner.mts:124` uses the native string guard,
  `typeof payload.result === 'string' ? payload.result : ''`.

The final state closes the earlier wrong-type and non-string-result findings
for captured CLI envelopes. The native default judging, prompt/parser contract,
both-order comparison and fallback logic remain unchanged. No expected-winner
label enters the request. Missing-cost successful payloads are still parsed
with a conservative accounting reservation, as declared by root.

The required, root-declared launch selects the pinned tsconfig explicitly:

```sh
./node_modules/.bin/tsx \
  --tsconfig comparisons/langwatch/hard/.pr115-source/tsconfig.json \
  comparisons/langwatch/hard/pr115.mts
```

The held-out invocation adds `--heldout`. This is a configuration statement;
the worker does not execute either model-running command. The equivalent
read-only tsx resolution probe confirms pinned core/judges paths.

Final inspected SHA-256 stamps:

| Wrapper artifact | SHA-256 |
| --- | --- |
| pr115.mts | `9fbe33912cc89fb2172129e2e9b1e4f6dfb4f10bfea3259679fc06349073b750` |
| runner.mts | `125dbf71ce38a3404eff394ee56827a8f996eb907707d28b68012e83cc89c4d8` |

The accounting cap, task deadline, cache reuse, linked external dependencies and
subprocess-directory placement remain disclosed benchmark transport choices.
Old cached records without `cliType` are rejected by the new envelope guard;
their missing metadata cannot be silently certified as a valid native result.
An absent subtype on a failed captured record throws here, whereas native's
non-success branch returns unparsed. This remaining edge concerns malformed
or legacy metadata, not a valid success or turn-limit result. No claim is made
that this edge occurred in the cohort.

Verification is static source inspection plus module-resolution probes, with
zero model calls. It confirms the inspected successful, turn-limit and API-error
contract branches; it is not a measurement of model accuracy or a runtime
assertion that all submitted CLI envelopes take those branches.

## Root pre-run runtime attestation

The final wrapper additionally records the actual zod/yaml versions, resolved
core source URL, pinned tsconfig hash, wrapper hash and runner hash before calls.
It rejects a core alias outside the approved checkout. A zero-call replay probe
passes these checks and stops at the first missing request recording. Captured
valid result envelopes with a missing subtype now enter the native unparsed
branch; successful legacy cache records without envelope metadata retain their
previous success-only capture semantics. These changes supersede the earlier
metadata caveats. The runtime fields in each recorded run identify its actual
wrapper and dependency state; the earlier review hashes are historical.

## Actual pairwise measurements

The approved default completes the hard120 and frozenfresh60 populations
without changing the pinned source. Actual runtime manifests attest the
approved commit, source hashes, loaded dependency versions and pinned core
resolution. Default swap confirmation, bounded re-asks and fact-ledger recovery
remain enabled:247 calls on hard and127 on fresh, with one and two recovered
cases. Both recorded choices match every fixed oracle label. No new procedure
is selected from these outcomes. Criterion measurement remains a separate
application of the same pinned default client/parser in this round.
