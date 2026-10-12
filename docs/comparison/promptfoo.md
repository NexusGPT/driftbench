# promptfoo: comparison

promptfoo is an evaluation framework for LLM prompts and agents. It ships assertion handlers, red-team plugins and a simulated user. This page reads commit 8014282, read on 2026-10-12, as the source records it.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Word and character bounds on a reply | ahead | compared against their docs or code | Their word count splits on whitespace and has no character bound. Ours counts code points, so "é😀" passes chars min 2, max 2. Counting UTF-16 units gives 3 and fails. | Not reproducible from main yet: the test is awaiting merge. |
| Tool-call precision and recall with argument matching | ahead | compared against their docs or code | Expected catalog.search with plan mobile, called with plan home. Their set check passes it. Ours fails it. | Not reproducible from main yet: the test is awaiting merge. |
| Reply JSON validity, whole reply and embedded in prose | ahead | measured head-to-head | On 15 shared cases, ours passes all that their contains-json passes, plus three they reject: a whole array, a whole number, an array in prose. | Not reproducible from main yet: the test is awaiting merge. |
| JSON paths, and strict schema with undeclared keys | ahead | compared against their docs or code | Their schema check allows undeclared keys unless the schema forbids them. Ours fails them. Their checks have no path assertions. Ours do. | Not reproducible from main yet: the test is awaiting merge. |
| Refusal detection in text replies | ahead | compared against their docs or code | Ours reads refusal phrases in seven languages. "Je ne peux pas vous aider." is a refusal for us. Theirs reads a flag that the provider sets. | Not reproducible from main yet: the test is awaiting merge. |
| Red-team: encoded and foreign-language phrasings | equal | measured against our earlier version | Ten rounds, seeds 0 to 2, seven sales faults, approved pack against approved plus drafts. Findings did not change. Fault d4 gave 3, 3, 3 findings in both packs. The promptfoo strategies were read, not run. | not reproducible from the repository: the measurement was a throwaway test and is not committed |
| Red-team: goal shift on the Acme sales fault (D2) | in progress | measured against our earlier version | Approved pack: caught on 0 of 3 seeds. Drafts only, 2 phrasings: caught on 1 of 3 (seed 0). Open: a person must decide whether the detection window is 0 blocks. promptfoo was not compared. | Not reproducible from main yet: the test is awaiting merge. |
| Simulated user: a fact is held back until the agent asks | ahead | compared against their docs or code | Their docs describe no rule that holds a fact back. Ours fails the run if the model gives a fact the agent did not ask for. | `pnpm -s vitest run packages/users/test/simulated.test.ts -t "gives a fact only after"` and `-t "fails the run when the model gives a fact"` |
| Simulated user: no hosted model call by default | ahead | compared against their docs or code | Per their docs, simulated-user messages go to hosted models unless PROMPTFOO_DISABLE_REMOTE_GENERATION=true is set. Ours takes an injected model and makes no network call. | `grep -n "fetch(" packages/users/src/simulated.ts` (expected: no output) |
| Trajectory: tool arguments | ahead | compared against their docs or code | Ours: exact, regex, contains, one_of, nonempty, absent, subset. Theirs: partial or exact, with ignore keys. The source gives no single failing case. | `pnpm -s vitest run packages/checks/test/tools.test.ts` |
| LLM rubric and model-graded criteria | ahead | compared against their docs or code | Ours are calibrated per judge (kappa), with a data-tag guard. The source gives no single case and points to judge evidence entries that are not in this source set. | `packages/judges/test` (judge calibration tests) |
| Simulated user: stop token ends the conversation | equal | compared against their docs or code | Their user emits ###STOP###, and promptfoo checks for it. Ours ends the run when the persona's stop token is said alone. No measurement shows a difference. | `pnpm -s vitest run packages/users/test/simulated.test.ts -t "stops on the stop token"` |
| Regex | equal | compared against their docs or code | Both use regex, with the m flag. | `pnpm -s vitest run packages/checks/test/must.test.ts` |
| contains, contains-all, contains-any | equal | compared against their docs or code | Equal for case-sensitive text. For any-of matching, ours needs one alternation pattern. | `pnpm -s vitest run packages/checks/test/must.test.ts` |
| Cost and latency bounds | equal | compared against their docs or code | Same bounds. | `pnpm -s vitest run packages/checks/test/budget.test.ts` |
| Answer relevance and conversation relevance | equal | compared against their docs or code | Both judge relevance. Ours adds a lexical floor. | `pnpm -s vitest run packages/checks/test/relevancy.test.ts` |
| JavaScript, Python and Ruby assertions (custom checks) | equal | compared against their docs or code | Both let a user write a check in code. | `pnpm -s vitest run packages/checks/test/custom.test.ts` |
| Skill used | equal | compared against their docs or code | Equal. The source gives no case. | `pnpm -s vitest run packages/checks/test/skills.test.ts` |
| Function-call and tools-call validity | equal | compared against their docs or code | Equal on tool inputs. | `pnpm -s vitest run packages/checks/test/schema_strict.test.ts` |
| Trajectory: tool used | equal | compared against their docs or code | Equal. | `pnpm -s vitest run packages/checks/test/tools.test.ts` |
| Trajectory: tool sequence | equal | compared against their docs or code | Equal. Ours: exact, in_order, any_order. | `pnpm -s vitest run packages/checks/test/tools.test.ts` |
| Trajectory: step count | equal | compared against their docs or code | Equal. | `pnpm -s vitest run packages/checks/test/budget.test.ts` |
| Trajectory: goal success | equal | compared against their docs or code | Ours is deterministic for state outcomes. Theirs judge free-text goals. Keep ours for state outcomes. | `pnpm -s vitest run packages/checks/test/end_state.test.ts` |
| XML, HTML and SQL format checks | behind | compared against their docs or code | The source names six checks we lack: contains-html, is-html, contains-sql, is-sql, contains-xml, is-xml. | `grep -rli -e sql -e xml -e html packages/checks/src packages/users/src` (expected: no output) |
| Case-insensitive contains (icontains) | behind | compared against their docs or code | Theirs ignore case. Ours cannot. | `grep -n -i -e ignore.case -e ignoreCase packages/checks/src/checks/must.ts` (expected: no output) |
| Starts-with | behind | compared against their docs or code | Theirs test the whole text start. Ours matches any line start (m flag). | `pnpm -s vitest run packages/checks/test/must.test.ts` |
| Embedding similarity (cosine, dot, euclidean, Levenshtein) | behind | compared against their docs or code | Theirs use an embedding provider by default. Ours default is local character n-grams. | `pnpm -s vitest run packages/checks/test/similarity.test.ts` |
| Factuality against a reference answer | behind | compared against their docs or code | Theirs grade a reply against a reference answer. Ours check facts in state, not free text. | `grep -rli -e factual packages/checks/src packages/users/src` (expected: no output) |
| Finish reason | behind | compared against their docs or code | Our adapter contract does not carry a finish reason. | `grep -rn -e finishReason -e finish_reason packages/checks/src packages/users/src` (expected: no output) |
| Red-team plugins (PII leakage, prompt extraction) | behind | compared against their docs or code | Theirs cover PII leakage and prompt extraction. Our red-team pack lacks both. Other content harms are out of scope for a sales agent. | `grep -n -i -e pii -e leak -e extract packages/users/src/redteam.ts` (expected: no output) |
| Exact match (equals) | in progress | compared against their docs or code | Not measured against theirs. The docs were read, and no run was made. Open: a run on both sides. | `pnpm -s vitest run packages/checks/test/exact.test.ts` (ours only) |
| Simulated user: initial messages (fixed mid-state start) | in progress | compared against their docs or code | Not measured. The docs were read, and no run was made. Open: a run against theirs. | Not applicable: no measurement exists. |
| Simulated user: stateful (send only the latest message) | in progress | compared against their docs or code | Not measured. Ours does not check this behaviour. Open: measure it. | Not applicable: no measurement exists. |

## Not compared

- Red-team grading per injected block (D9). The source says promptfoo was not compared. Its grading was read per plugin. Only our own before and after was measured: D9 found in 0 of 3 seeds before, 2 of 3 after, with the drafted expectations.
- Violations by an injected block, scored as findings (round 3). Not compared here.
- The Acme control handover (D8) and the drafted D6 phrasings in world data. Not applicable: internal fixtures with no competitor counterpart.
- D6 placement follows the read. Not applicable: our placement, measured before and after.
- ROUGE, BLEU, METEOR, GLEU and n-grams. Skipped: built on a separate track.
- Perplexity. Needs token log probabilities, which our adapter contract does not carry.
- Trace span count, duration and error spans. Ours reads calls, not spans.
- RAG faithfulness, recall and relevance. Our product has no retrieval step.
- Classifier, moderation, safety-filter, pi and webhook checks. Theirs call external services. Ours are local.
