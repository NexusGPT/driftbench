# Testing a code-interpreter agent as an estate

Status: designed on 2026-10-11; the first increment (scan, map, plan and replay) is in progress. This page extends [generating tests](../README.md#generating-tests) to agents whose behaviour is specified across an estate. It reuses the block model, the three run modes, the runtime trace (skills, guards, stages), the checks, the map with axis and detail roles, approval with provenance, the validity gate, the statistics with variance and the reference set intake. Nothing here is runtime-specific: each runtime is an adapter that reads its own files into these shapes. The Claude Code mapping is on [its adapter page](adapters/claude-code.md).

## 0. What changes when the agent is an estate

A prompt agent is one prompt and some tools. What varies is the user's situation, so its map has stages, behaviours, deviations, personas, channels and data cases, and its tests are conversations.

A code-interpreter agent is an estate. Its behaviour is written in many places: standing instructions (a CLAUDE.md or system prompt, memory files), skills (a trigger, instructions, references, scripts, sometimes their own guards), subagents (contracts), guards (events, predicates, verdicts), tools and MCP servers (schemas, permissions), settings (permission mode, models), and the runtime it lives in (a workspace, git, sandboxes, sessions that compact and restart, helpers that run in parallel). The agent's behaviour is the composition of all of it, over many turns, on a workspace.

Two things change, and only two:

1. The specification is distributed and mostly structured. So the map is extracted from the estate by code wherever the file has structure (frontmatter, settings, registries, step lists), and by a model only where the specification is prose (instruction bodies), with a person approving the prose atoms.
2. The situation space has more axes and more ways to deviate: the session state, the workspace, the helpers, the guards, the environment. The deviation classes grow by the estate's own hazards (compaction, restart, rate waves, nudge storms, dead helpers).

Everything else carries over unchanged: a block is Given, When, Then; the three run modes; the checks on skills, guards, stages, tools, executions, workspace, artifacts and text; judges earn criteria; every rate carries an interval; the validity gate; the sealed holdout; five seats with no model family twice; maintenance by provenance.

## 1. Elements: the atoms an estate specifies

An atom is one place where the estate says what the agent must do, with a quote and a hash. Fourteen kinds. For each: where it lives (Claude Code example; generic name in brackets), who extracts it, what a trace shows when it is obeyed.

| Kind | Where it lives | Extracted by | Evidence in a trace |
|---|---|---|---|
| Instruction (a rule: obligation or prohibition with a situation) | CLAUDE.md, skill bodies, agent bodies, memory files [standing instructions] | model proposes, person approves | a required act happens (a tool call, a skill load, a card, a read) or a forbidden act does not |
| Gate (order: before X do Y) | "Before X: Read Y" lines, plan-mode rules, read-before-write rules | code for the fixed forms, model for the rest | an ordered pair: Y before X |
| Route (trigger: an ask of class X loads skill or agent Y) | skill descriptions, routing tables, agent descriptions | code (frontmatter), model (routing prose) | the Skill tool call or the Agent dispatch |
| Skill (the unit) | SKILL.md: trigger, instructions, references, scripts, its own guards [capability bundle] | code | the load, then its instruction atoms |
| Reference | a file a skill names, with its "read when" | code | the Read of that file at the moment named |
| Script | an executable shipped with a skill, inputs and outputs | code (file), model (docstring) | the command run, its exit code, its output |
| Subagent | agent file: name, description, tools allowed, model, effort, skills, brief fields, output shape, must-not [helper contract] | code (frontmatter), model (body) | an Agent dispatch with the brief fields; the helper's typed output; no forbidden act by the helper |
| Guard | settings.json events and matchers, the guard source, a check registry or catalogue when present | code | a guard record: name, verdict, at |
| Tool or MCP server | schemas, permission (allow, deny, ask), deferred loading | code | a tool call within schema; a denied tool never called; a deferred tool loaded before use |
| Setting | permission mode, model, effort, environment | code | the run's configuration |
| Stage (step lists) | step lists a process defines (plan, build, verify; the tracker loop) [stage catalogue] | code when a step list exists, model otherwise | stages reached, in order |
| Register (output rules) | language, length, format, forbidden words, tone | code and model | the reply text: counts, language, words |
| Environment hazard | compaction, restart, rate wave, session boundary, notification, nudge storm | code (a fixed list per runtime) | recovery after the event |
| Invariant (static) | size ceilings, mirror parity, no orphans, anchored guard paths, registry completeness | code | a property of the estate's files, no run |

Every atom carries: id, kind, provenance (file, line span, quote, hash), produced_by (code or model), role (axis or detail), approved, an evidence predicate (typed: skill_loaded, guard, tool_called with input fields, ordered, stage_reached, workspace, artifact, text), and its enforcement (the guards and tests that already check it; none means "trusted", which is a finding on its own).

## 2. Relations: the estate graph

Edges: route (ask class to skill or agent), skill to reference (read when), skill to script, skill to subagent (dispatch), rule to guard (enforces), guard to event, agent to tool (allowed), stage to stage (next), rule to rule (cites or overrides). The graph answers four questions code can walk: what should happen on an ask (a path), what enforces what (and what nothing enforces), what is reachable from the standing instructions, and what is orphaned.

## 3. Variables: the interaction space of an estate

The map's dimensions, with their values. Axis dimensions form the cells; detail dimensions vary inside a cell as boundary values. A constraint list names impossible combinations. The prior comes from the real session corpus when it exists (path i of the reference set, anonymised), else from the owner interview (path ii).

| Dimension | Values | Role |
|---|---|---|
| Ask class | build, operate, debug, research, compose or advise, change the estate, chat | axis |
| Ask shape | concrete (names its resources), ambiguous, fully prescribed, a problem statement, multi-part, a correction of a prior turn | axis |
| Entry channel | typed message, mid-turn message, pasted content, attached file, helper notification, guard nudge, wake-up | detail |
| Session state | fresh, resumed with an open tracker, after compaction, after a restart, long (past N turns), with helpers running | axis |
| Workspace state | empty, seeded repository, dirty tree, worktrees present, shared store, no mount | detail |
| Owner signal | go, hold, "no questions", "keep going", "stop", language switch, frustration, a limit word in the ask | axis |
| Permission and environment | bypass, default, sandboxed, offline, rate limited, a tool failing | detail |
| Scale | one step, multi-step, a fan-out of helpers, long-running with waits | detail |
| Deviation | the ten classes of the harness design, read for an estate: off-topic, goal shift mid-turn, a false premise, loose confirmation, language switch, instruction in data (a file or tool result that carries instructions), burst, tool failure, silence, notification storm; plus estate-only: compaction mid-task, process restart, rate wave, a stale tracker, a dead helper | axis |
| Target atoms | the atom or atoms a block exercises | axis |

Example constraints: compaction needs a long session; a helper notification needs running helpers; "no questions" needs a row the owner owns.

## 4. The plan: what to cover, before any test text

From the approved map and the graph, code derives the test plan. It is a table of cells, each cell an atom (or path) crossed with situation values, and for each atom kind a contract of mandatory test types:

| Atom kind | Mandatory tests per atom |
|---|---|
| Instruction | one obligation test per trigger situation (the act happens); one outside-trigger test (the act does not happen: over-firing); one twin with another phrasing |
| Gate | one ordered-pair test; one skip-pressure test (a situation that tempts skipping: urgency, "just do it") |
| Route | k positive asks from the bank; near-miss negatives; one misroute (the user names the wrong primitive) |
| Skill | the trigger tests; one obligation test per instruction atom; one read-when test per reference; one fixture test per script |
| Subagent | one dispatch test (brief fields present); one contract test alone (typed output, must-not holds); one stop-and-resume test |
| Guard | one positive replay (the recorded event gives the verdict); one negative control (a look-alike stays silent); one hostile payload (malformed input, no crash); one speed budget; one message register |
| Tool or permission | schema boundaries; a denied call is never attempted; a deferred tool is loaded before use |
| Stage | one order test; one skip test; one "anytime" step test |
| Register | a sample of replies per ask class, judged by the measured judge, plus machine counts (characters, bullets, sentence length, forbidden words) |
| Environment hazard | each hazard crossed with a long task: turns to recover, collateral (edits outside scope, lost rows), safe action |
| Invariant | one static test |
| Journey | edge coverage over the graph with realistic asks; each path a multi-block spec with a stage expectation per block |

Then pairwise combinations (t = 2) over the axis dimensions with the constraint list, a greedy covering array. The plan prints: cells and the covering array size, mandatory test counts per kind, atoms with no enforcement, cells with no approved phrasing, graph edges with no journey. The plan is a file the person approves: cells can be struck or weighted. It is the artifact the comparison with the native battery is made on, cell by cell.

## 5. Test generation from the plan

Each plan row becomes one or more driftbench specs of kind task, target the estate adapter, by code only:

- Given: the estate version (map hash); a workspace seed (a fixture folder or repository); the session state (a recorded prefix for resumed or compacted; a transcript cut for teacher-forced); a tracker fixture when the estate keeps one; fake helpers that answer from scripts when the cell needs helpers.
- When: the ask, drawn by seed from the approved phrase bank for that cell (or an anonymised turn of the reference corpus), or an event (a notification, a nudge, a compaction marker).
- Then: the evidence predicates of the cell's atoms, as the existing checks: skills (loaded or forbidden), guards (name, verdict, count), stage, tools (label, input fields, order), execution (commands, exit codes), workspace (created, changed, deleted, others untouched), artifacts, must and must_not and lang on the reply, budget (steps, cost, latency), end_state (tracker rows and notes) when present, custom (ordered pairs; reach before compliance). Judged criteria only for register and craft, with a capped share.
- Every spec records its cell, seeder, seed, atom ids, map hash and plan row. Same map and seed give byte-identical specs.
- Negative controls are specs in their own right: expect not loaded, silent, no act.
- Oracles come from the atom text and the fixtures, never from a run. A good recorded session may seed Given and When; its Then is rewritten from the atoms.

## 6. Running an estate test: replay, unit, live

- Replay (offline, deterministic, no model call). A recorded session (the transcript, the guard decision log, the step feed) is mapped by the runtime's adapter onto the generic trace: Read, Edit, Write, Bash and Agent calls as tools (Agent with its brief as input); Skill loads as skills; guard decisions as guards; step lists and the tracker loop as stages; the reply text; commands and exit codes as executions; the workspace diff from the tree. The suite's checks run over it. This is the maintenance workhorse: every estate change re-runs the suite over the corpus, and a flip is a regression. The corpus doubles as the reference set.
- Unit (offline). Guards replayed with synthetic events; scripts on fixtures; a subagent alone, run headless with its agent file as the system prompt, in a sandbox.
- Live (online, blind). The agent runs headless in a sandboxed copy of the estate pinned by hash, on a seeded workspace, from the ask alone: no test word in the prompt or the dispatch description. The three modes apply: teacher-forced resumes from a recorded prefix cut at block k; free running; perturbed injects an estate deviation at block k (a compaction marker, a mid-turn message, a planted file, a dead helper). Repeats give the variance; the fixed estimation pool gives every number; cost per run is measured.
- Estate mutants (adequacy). Delete or invert one atom in a copy of the estate. The tests derived from that atom must go red in live mode, and the replay suite must flag the corpus as now violating. The mutation score per atom kind is the only stop rule, as for prompt agents.

## 7. Judging, statistics and coverage for estates

- The unit is the session (one cluster); blocks inside it move together; the design effect uses the measured correlation from the variance pilot, whose sources for an estate are model randomness, phrasing, session state, workspace seed and judge.
- Coverage lines per atom kind: atoms with an approved test over atoms; atoms enforced by a guard over atoms; cells covered over cells; graph edges covered over edges; the completeness line over situations seen in the corpus (distinct situations, discovery probability).
- Reach before compliance: a two-stage verdict per instruction. Did the rule reach the moment (the skill loaded, the reference read, the guard fired)? Then was it followed? Reported separately, because a rule that never arrives is a different defect from a rule that is ignored.
- Decay over length: the pass rate per block index in long sessions, before and after a compaction.
- Holdout: a sealed set of sessions and asks that the estate's editors never see; the release gate for an estate change reads it through a fixed query budget.
- Drift over time: deny rates per guard from the decision logs, pass rate per atom per estate version, with the change detectors the statistics library holds.

## 8. Maintenance: keeping the tests true when the estate changes

- Atoms hash their quote and span. An estate diff lists added, changed and removed atoms and edges between two map versions.
- Impact: tests index by atom id. A changed atom regenerates its tests; a semantic change (text beyond whitespace) sends its phrasings back for approval; a removed atom retires its tests with the reason; a new atom gets new tests, unapproved until approved.
- Regression: the replay suite over the corpus runs on every change (pass to pass). The failing session that motivated a change is its fail-to-pass case: red before, green after, on the same transcript.
- Enforcement state is data: the observe, warn and enforce transitions per guard atom, with the decision-log evidence behind each.
- The improvement cycle feeds the map: an issue becomes a class, the class becomes a new or changed atom, the atom regenerates its tests, the tests go red on the issue's own session, the fix lands, the tests go green on replay and on one blind live probe, and the holdout decides the release.
- Invariants run on every change: ceilings, mirror parity, orphans, registry completeness, guard path anchoring.

## 9. Where it lives, and the build order

Packages: a generic estate package (atoms, graph, export to the space map, plan, lint, diff and impact); the Claude Code adapter (estate reader for the standing instructions, skills, agents, guards and settings; transcript and decision-log reader; the live headless runner) and the Nexus adapter (tracker and step lists as stages); estate seeders in the generate package; checks unchanged apart from custom checks for ordered pairs and reach; statistics unchanged. CLI: estate scan, lint, map, plan, diff, impact; replay; generate with an estate flag. Order: scan, lint and map; plan; transcript adapter and replay; seeders; maintenance; then the live runner, estate deviations and mutants; then a validation on a real estate against its native test battery. Nothing Nexus-specific enters the core.


See also: [checks](reference/checks.md), [running](running.md), [statistics](concepts/statistics.md).
