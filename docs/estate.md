# Testing a code-interpreter agent as an estate

This page extends [generating tests](how-it-works.md#generating-tests) to agents whose behaviour is specified across an estate. It reuses the block model, the run modes, the runtime trace (skills, guards, stages), the checks, the map with axis and detail roles, approval with provenance and the space map. Nothing here is runtime-specific: each runtime is an adapter that reads its own files into these shapes. The Claude Code mapping is on [its adapter page](adapters/claude-code.md).

Status. Built: `driftbench estate scan`, `lint`, `approve`, `map`, `plan` (with `plan approve`), `generate`, `diff`, `impact`, `static`, `unit` (guards and scripts), `stats`, `run` (the live runner), `mutate` (estate mutants), `prove` (the proof of each rule link by deleting its rule), `scan --pointer` with its ledger, `radius ledger`, and `driftbench replay`. Helper unit tasks use a declared local executor; the estate pilot of section 7 is not built yet. The live runner and the mutants, with a run on the fixture's stand-in command, are in the [CLI reference](reference/cli.md#driftbench-estate-run-and-driftbench-estate-mutate).

## 0. What changes when the agent is an estate

A prompt agent is one prompt and some tools. What varies is the user's situation, so its map has stages, behaviours, deviations, personas, channels and data cases, and its tests are conversations.

A code-interpreter agent is an estate. Its behaviour is written in many places: standing instructions (a CLAUDE.md or system prompt, memory files), skills (a trigger, instructions, references, scripts, sometimes their own guards), subagents (contracts), guards (events, predicates, verdicts), tools and MCP servers (schemas, permissions), settings (permission mode, models), and the runtime it lives in (a workspace, git, sandboxes, sessions that compact and restart, helpers that run in parallel). The agent's behaviour is the composition of all of it, over many turns, on a workspace.

Two things change, and only two:

1. The specification is distributed and mostly structured. So the map is extracted from the estate by code wherever the file has structure (frontmatter, settings, registries, step lists), and code proposes conservative candidates from normative prose (instruction bodies). A model can split that prose further. A person approves prose atoms from either source.
2. The situation space has more axes and more ways to deviate: the session state, the workspace, the helpers, the guards, the environment. The deviation classes grow by the estate's own hazards (compaction, restart, rate waves, a stale tracker, dead helpers).

The rest is the model a prompt agent already has: a block is Given, When, Then; the checks on skills, guards, stages, tools, executions, workspace, artifacts and text; judged criteria only where no check can decide.

## The worked example: the Northwind estate

Every number on this page comes from the commands run on the fixture estates of the repository, from the repository root. Commands that write files write them under `_captures/docs3/estate/`, a scratch folder; any folder works.

| Folder | What it holds |
|---|---|
| [`examples/estates/fixture`](../examples/estates/fixture/README.md) | The Northwind ops assistant, a fictional Claude Code estate written by hand: a standing file with 17 labelled rules (R1 to R17), a routing table, a process paragraph and output rules; two memory files; four skills; three helper agents; a settings file with a model, permissions, environment keys and guards on four events; five guard scripts in `.claude/guards/` and a check registry; a step list. Defects are planted for the lint. Beside it: the recorded model answers (`answers.yaml`), the scanned map (`map.yaml`), the approved map (`approved.yaml`), its space map (`space.yaml`), the plan (`plan.yaml`, `plan.summary.json`), the phrase bank (`phrases.yaml`), three recorded sessions (`sessions/`) and the generated suite (`generated/`). |
| [`examples/estates/fixture-v2`](../examples/estates/fixture-v2/README.md) | The same estate after a change, for `estate diff` and `estate impact`: one rule rewrapped, three changed in meaning (one rewritten at the same ledger unit), one added, one guard promoted. Eight version 1 tests and the committed diff and impact. |
| `examples/estates/sessions` | Six synthetic sessions of another fictional estate (a shop build) with their guard decision logs, step feeds and seven replay specs, for `driftbench replay`. |

No command on this page calls a paid model. The Northwind map is scanned with recorded answers (`--replay answers.yaml`); the model family the recording names is `lane`, the work of a person who played the model. The committed outputs of these folders are made again by the commands in [Regenerate the fixture](#regenerate-the-fixture).

## The commands

| Command | What it does | Exit codes |
|---|---|---|
| `driftbench estate build <root>` | Runs the whole chain in one folder: scan, approve the atoms, map, plan, approve the plan, generate. It asks before each approval on a terminal, `--yes` answers both, and outside a terminal it stops at the first approval and names the next command. `--out <dir>` (default `driftbench-build`), `--verbose` prints the output of every command, `--replay`, `--no-model`, `--provider`, `--ignore`, `--pointer` (with `--cassette`, `--labels`, `--labeler`, `--record`, `--jobs`, `--prices`), `--phrases`, `--sessions`, `--t`. A second run skips every stage whose inputs did not change. See [the help topic](../packages/cli/help/validate-estate-build.md). | 0 done and every test complete; 1 an approval declined or not asked, or incomplete tests; 2 usage or input error |
| `driftbench estate scan <root> --out <map.yaml>` | Reads an estate into a map of atoms and edges: code reads the structure, a model splits the prose. `--runtime claude-code` (the one runtime today), `--replay <answers>` replays recorded answers instead of calling a model, `--no-model` reads the structured atoms only, `--provider <name>` (anthropic or openai), `--ceiling <characters>` (default 40000), `--ignore <glob>` (repeatable) skips the paths it matches beside the defaults and the `ignore:` list of the [configuration file](#the-estate-configuration-file), `--user-skills <folder>` also reads the user-level skill layer from that folder (none is read without it), `--prices <file>` (with `--pointer`) prices the tokens the labelers used and prints the cost in USD per model, `--force` replaces an existing map (its approvals are lost). `--replay` and `--no-model` do not go together. | 0 written; 1 written, but a prose chunk failed or an atom was refused (both listed); 2 usage or input error, nothing written |
| `driftbench estate lint <map>` | Checks the estate against its map: the codes of section 2. `--ceiling`, `--ignore` and `--user-skills` as for scan; a map scanned with a user layer needs the folder again. | 0 clean (unenforced rules alone are reported, never failing); 1 findings or an invalid map; 2 the map or the estate cannot be read |
| `driftbench estate approve <map>` | With no flag, lists the atoms that wait. `--kind <kind>` and `--atom <id>` (each repeatable) or `--all` approve in place, keeping comments and layout; `--to <file>` writes the approved map beside the original instead. | 0 listed or approved; 1 invalid map, unknown kind or atom; 2 missing file or options that do not fit |
| `driftbench estate map <map> --to <space.yaml>` | Writes the space map of the situation axes and the approved axis atoms, for `driftbench space`. `--all` takes unapproved atoms too; `--agent <name>` names the agent (default: the estate folder name). | 0 written; 1 invalid map or space map; 2 missing file or `--to` |
| `driftbench estate plan <map> --out <plan.yaml>` | Derives the test plan from the approved map, and writes `<plan>.summary.json` beside it. `--t <n>` (default 2), `--space <file>`, `--k <n>` (default 3), `--force`. | 0 written; 1 invalid map, invalid space map, or a space map that does not match the map; 2 usage or input error, nothing written |
| `driftbench estate plan approve <plan>` | With no flag, counts the rows by status. `--all` approves every proposed row; `--row <id>` (repeatable) approves a row; `--row <id> --strike` strikes it. `--out <file>` writes the result there and leaves the plan read untouched; an unknown option exits 2. | 0 listed or changed; 1 invalid plan or unknown row; 2 options that do not fit |
| `driftbench estate generate --map <map> --plan <plan> --out <dir>` | Writes task specs from the approved plan rows, by code, and `estate-generate-report.json`. `--seed <n>` (default 1), `--phrases <bank>` (default `phrases.yaml` beside the map), `--sessions <index>` (default `sessions/index.yaml` beside the map, when it exists), `--states <library>` (the state library of the runs: default `live/states/library.json` beside the map, when it exists, else the library this command writes to `states/library.json` beside the specs; a row is planned only for the session states and events the library holds), `--focus <file>` (atom ids whose complete specs come first in `run-order.txt`), `--no-fallback` (no ask written by code, no outcome read from the atoms), `--no-judge` (no judged criterion for a domain predicate), `--force`, `--json`. With no bank beside the map, every ask is written by code. | 0 every approved row gave complete specs; 1 written with incomplete specs, rows waiting for approval or a generator defect; 2 usage or input error, nothing written |
| `driftbench estate diff <old map> <new map>` | Atoms added, removed, changed (white space or semantic), moved and restated, edges added and removed, and guard state changes. `--json`, `--out <file>` (the JSON that `estate impact` reads), `--old-guards <file>`, `--new-guards <file>`. | 0 computed; 2 a map or a guard state cannot be read |
| `driftbench estate impact <diff> --tests <dir>` | What the diff does to the tests: regenerate, re-approve, retire, new. `--write` writes each retirement into its spec, `--json`, `--out <file>`; `--replay <sessions> [--suite <dir>] [--store <db>]` adds the regression run. | 0 nothing needs a person; 1 something needs a person; 2 usage or input error |
| `driftbench replay <session.jsonl...> --suite <specs>` | Runs a suite over recorded sessions, offline, with no model call. `--decisions <logs...>`, `--steps <feeds...>`, `--store <db>` (in memory without it), `--json`. | 0 every aligned spec passes; 1 a spec fails; 2 bad input |
| `driftbench estate run <specs...> --estate <root> --runtime claude-code --store <db>` | Runs live estate specs through the runtime headless, in a sandbox holding a copy of the estate; `--map` pins the copy to the map's hash, `--states` plants session states and hazards from a state library. Only a stand-in command runs without `--allow-billed`. | 0 every spec passes; 1 a spec fails; 2 usage or input error |
| `driftbench estate mutate <map> --atom <id> (--delete \| --invert) --to <dir>` | Copies the estate and deletes or inverts one atom in the copy, with `map.yaml` and `mutant.json`. | 0 the mutant is written; 2 usage or input error |
| `driftbench estate unit <tests...> --estate <root>` | Runs the unit tests `estate generate` writes under `unit/` with no model: guards on event payloads, scripts on their fixtures. `--record` writes each outcome into its test on the original estate; a later run must give it again. `--runtime`, `--no-sandbox`, `--jobs <n>` (default 1), `--json`. See [unit, live and estate mutants](#unit-live-and-estate-mutants). | 0 every test passes; 1 a test fails; 2 usage or input error, or a test with no recorded outcome |

## 1. Elements: the atoms an estate specifies

An atom is one place where the estate says what the agent must do, with a quote and a hash. Fourteen kinds. For each: where it lives (Claude Code example; generic name in brackets), who extracts it, what a trace shows when it is obeyed.

| Kind | Where it lives | Extracted by | Evidence in a trace |
|---|---|---|---|
| Instruction (a rule: obligation or prohibition with a situation) | CLAUDE.md, skill bodies, agent bodies, memory files [standing instructions] | code or model proposes, person approves | a required act happens (a tool call, a skill load, a card, a read) or a forbidden act does not |
| Gate (order: before X do Y) | "Before X: Read Y" lines, plan-mode rules, read-before-write rules | the pointer reader (a label, two spans and a link); code locates the file | an ordered pair: Y before X |
| Route (trigger: an ask of class X loads skill or agent Y) | skill descriptions, routing tables, agent descriptions | code (skill and helper descriptions), pointer reader (routing tables) | the Skill tool call or the Agent dispatch |
| Skill (the unit) | SKILL.md: trigger, instructions, references, scripts, its own guards [capability bundle] | code | the load, then its instruction atoms |
| Reference | a file a skill names, with its "read when" | the pointer reader (a label); code locates the file | the Read of that file at the moment named |
| Script | an executable shipped with a skill, inputs and outputs | code | the command run, its exit code, its output |
| Subagent | agent file: name, description, tools allowed, model, effort, skills, brief fields, output shape, must-not [helper contract] | code (frontmatter), model (body) | an Agent dispatch with the brief fields; the helper's typed output; no forbidden act by the helper |
| Guard | the guards of the settings file (event, matcher, command) and of skill frontmatter, the guard source, a check registry when present | code | a guard record: name, verdict, at |
| Tool | permission rules of the settings file (allow, deny, ask), the tools a skill declares | code | a tool call within its rule; a denied tool never called |
| Setting | the model, the default permission mode, environment keys (never a value) | code | the run's configuration |
| Stage | the step list the estate defines (plan, do, verify, report; a step allowed at any point) [stage catalogue] | code | stages reached, in order |
| Register (output rules) | language, length, format, forbidden words, tone | code or model proposes, person approves | the reply text: counts, language, words |
| Hazard | a passage of the estate that names a runtime hazard (compaction, a new session) | the pointer reader (a hazard label) | recovery after the event |
| Invariant (static) | the size ceiling of the standing instructions, no orphan file, anchored guard paths, a complete check registry | code | a property of the estate's files, no run |

Every atom carries: an id (`kind.scope.slug`, stable and valid as a space value id; a skill's files take their scope from the skill's declared name, so a skill folder renamed with its name kept keeps every id, and two skills that declare one name keep their folder names as scopes), its kind, its title, its provenance (file, line span, quote, and a SHA-256 hash of file, span and quote), `producedBy` (code or model), its role (axis or detail), `approved`, the situation it applies in, its evidence predicates (typed: `skill_loaded`, `skill_not_loaded`, `guard`, `tool_called` with input fields, `tool_not_called`, `reference_not_read`, `subagent_not_dispatched`, `guard_not_fired`, `stage_not_reached`, `artifact_not_created`, `file_not_written`, `ordered`, `stage_reached`, `workspace`, `artifact`, `text`, `static`, `custom`), and its enforcement: the guards that already check it. Empty enforcement means "trusted", which is a finding of its own.

A guard's evidence carries the verdict of its check registry row. A guard with no row has evidence with no verdict: any verdict counts, as in the guards check. A guard source may declare its verdict on a line of its own, beside `Enforces:`, in a comment or a docstring (`Verdict: deny`; one of deny, block, warn, nudge, allow, ask). The registry row always wins when there is one; the declaration is read only for a guard without a row, and the guard atom then carries `fields.verdictFrom: source`. A declaration never makes a missing registry row acceptable: `REGISTRY_ROW` is still reported.

Guard atoms also retain their rule descriptions in `fields.ruleText`. `ruleSources` records each description's file, line span, exact source quote, text and origin (documentation, message or registry). The scanner statically reads the resolved guard script's docstrings, comments, usage and literal output messages, including named literal constants passed to output calls. It never executes a guard while scanning. Unused implementation strings supply no description. These descriptions enrich the guard; they do not become independently inferred instruction atoms or prove that a guard ran.

A markdown registry table is read by the roles of its columns, recorded by the pointer reader (the `registry-roles` set: one question per distinct header cell, then one per state value that may mean off) and kept in the map as `registryRoles`; no header word is read, in any language, and a code-only read without the roles gives no row from a table. A catalogue check whose state a label calls off enforces nothing. A registry description is independent of its rule-label links. Markdown description and watch columns, and JSON or YAML description, meaning, purpose or summary fields, retain their text. Structured check mappings can be found without a registry filename, including id-only rows whose id occurs in a configured guard's source. A command row uses the same source-and-usage dispatcher resolution as a configured guard. `fields.rules` keeps each matched registry description with its check id, declared verdict, enforcement state and source. The guard's existing evidence keeps its selected registry verdict; a description alone never invents one.

Not read yet: MCP server files, deferred tools and plugin folders. A runtime hazard is an atom only where the estate's prose names one (one in the Northwind estate), since an atom needs a file quote; the runtime's fixed list of hazards lives in the space map (section 3).

### Reading the estate: `estate scan`

The scanner has one interface, the estate reader: it returns the files with their kinds and the declarations parsed from them, each with the exact passage it was read from. The Claude Code reader is the only part that names a runtime's file layout.

The reader batches independent filesystem metadata checks and file reads with bounded concurrency, while keeping sorted traversal, file and diagnostic order. It carries canonical directory paths through ordinary descendants, resolves symbolic links at their boundaries (links under `.claude/`, such as a skills folder shared from a library, are followed even when they lead outside the estate root, and the map lists each one it read in `followedLinks`, by its path from the root; a link beside the layout is not followed, and a file that a standing file only names and whose real path lies outside the root is an external reference: it is noted and never read), and reuses each link target's metadata for its size check. A shared traversal result and an active ancestor set avoid copying whole descendant lists and ancestor sets at every directory level. These are read-local optimizations: later scans read the filesystem again.

Scanner lookups index atoms, registry rows, file names and line offsets, and reuse chunk lines within a scan. These indexes preserve atom IDs, source spans, candidate order and lint findings; each scan reads its files anew.

Code reads skills, helpers, guards (settings and skill frontmatter), permissions, settings (environment keys only, never a value), the check registry, the step list, scripts and the four invariants. Structured code atoms are approved as read; the atoms of the prose (the model pass or the pointer reader) wait for a person. References, gates and runtime hazards are read from the prose by the pointer reader, never by a word list in code; code only locates the file a labelled unit names (see "Names that fit several files" below). Routing tables are read by the pointer reader: each cell of a row is a unit, and the labels `route-skill` and `route-helper` mark the cell that asks for something (a span, the words of the ask) and link it to the skill or helper it loads or dispatches, with the target cell as the label's target. Code only checks that the linked unit is a skill or helper of the estate. A row that no labeler marks gives no route, in any language, and `--no-model` reads the routes of the skill and helper descriptions only.

The user-level skill layer is a second skill layer beside the project's. An agent loads the skills of the current user as well as those of the project, but the layer is opt-in: the reader never reads a home folder on its own, so a scan gives the same map on every machine. It reads the user skill folder (usually `~/.claude/skills`) only when one is named: the `--user-skills <folder>` option, the `userSkills` key of the configuration file (relative to the estate root), or `userSkills` of the reader in code; the option wins over the file. Without one, a populated home folder changes nothing. A folder of the layer that holds a `SKILL.md` is a skill. A folder that holds none is a container, such as a folder of synced skills, and the folders one level inside it are looked at the same way. A link to a folder elsewhere is followed. A folder whose name starts with a dot (a repository, an archive), a dependency folder (`node_modules`) and a container named `Trash` or `trash` (any case) are not read; a folder named trash that holds a `SKILL.md` is a skill. An empty `--user-skills` value is refused (exit 2) and so is an empty `userSkills` reader option (a `RangeError`), since an empty path would name the working folder; `~` and `~/x` are expanded against the home folder. A relative `--user-skills` folder is relative to where the command is typed, a relative `userSkills` of the configuration to the estate. Precedence: the project layer wins. A user folder that is a project skill's own folder (a link into the project) is the same skill and is read once; a user skill with the name of a project skill is left out with a note. Within the layer the first folder, by name, keeps a name. The files of the layer carry the path `~/.claude/skills/<folder>/...` in the map whatever folder they were read in, so a map holds no private path; the layer is no part of the project, so a copy of the estate (for a unit run or a mutant) holds none of it, and an atom read from it has no mutant. A scan that read a layer records `userSkills: true` in the map. `estate lint` needs the folder again (`--user-skills <folder>` or the configuration) and refuses a map that records a layer when it is given none (exit 2), because the layer's atoms cannot be checked without it. A folder that was named and cannot be read is a note. The layer feeds the graph (its skills, rules and references are atoms) but the lint reports on the project: a file of the layer is never an orphan or unreachable, a reference or script of the layer that does not exist is no finding, and the invariant "no file of the estate is an orphan" is measured on the project's files. The scan prints how many skills it read from the layer.

A runtime hazard is an atom where the pointer reader gives a unit a hazard label (compaction, a new session, a restart, a rate limit, a notification, a nudge). The label descriptions say that the runtime brings the event, so a sentence that quotes an error message as a sample, or names an unrelated participant or an outgoing API policy, is not labelled a hazard.

A gate is a unit the labelers call a gate. The reader gives the act the rule governs as a span (the words of the clause, located by code), the tool that act uses as a link, and the file to read first is the first inline code span of the unit, located by the estate's own places (aliases, base folders, the folder of the naming file, the root). Each file a unit names also gives a reference atom. A gate that gives no act, or whose file the estate cannot locate, is refused with its reason and is not guessed.

Lines that look like what code reads and are not. A script anchors on the body line that runs it: a run, execute, use or call directive and every command of that directive (the executable after assignments, `exec`, `env` and an interpreter's flags), a whole-line command, or a link to the file. A mention in passing, an argument passed to another script, an inline interpreter program or a forbidden run anchors nothing; with no such line the script anchors on its own file.

Names that fit several files. A body often names a file by its bare name, `guide.md`, and an estate can hold several files of that name. A user needs the reference to land on the file the author meant, or to be told that it is ambiguous, never bound to one at random. The rule: a name is looked up in the naming file's folder, then in the folders below it, then from the estate root. The first place that holds the file wins. When a bare name fits no file there and several files elsewhere, the reference atom keeps every candidate in `fields.candidates`, sorted, and `estate lint` reports `AMBIGUOUS_REFERENCE`. Files under the ignored folders (`node_modules`, test folders of the guards, `.trash`, `skills/synced`, `__pycache__`) are never candidates. A name that holds a folder (`references/guide.md`) is resolved from the naming file's folder and is never ambiguous.

### Model budget and cache

Without a model and without the pointer reader, scan reads the structure only and proposes no prose atom: the rules of the prose come from the model pass or from the pointer reader below, never from a word list in code.

Before the CLI makes any model call, it prints the pending chunk count and source characters, the cached count and characters, and the total. These are input-size estimates, excluding prompt overhead and model output; they are not currency quotes. `--replay` prints the same estimate but makes no paid calls. `--no-model` continues to list prose not processed by a model even when candidates were found.

Live model scans cache validated chunk answers in `.cache/estate-prose/` beside the output map. A SHA-256 key includes chunk content, source file, model family/name, token budget, extraction prompt and ambiguous-routing context. An unchanged chunk is not sent again, including when its line numbers change. Changing one chunk invalidates that chunk. Changed model settings or prompt invalidate the affected entries. The located occurrence is cached as a relative line hint, so repeated quotations retain their selected occurrence when a chunk moves. Cached quotes are located and checked against current source spans again; cached answers do not carry approval. Malformed cache entries are misses; failed calls and refused answers are not cached. Recordings bypass this persistent cache so replay remains an explicit recording test. The cache holds private source excerpts and must stay out of version control.

The library exposes `FileProseCache`, `ProseCache`, `proseCacheKey`, `proseEstimateLine` and `beforeModel` on `scanEstate` and `scanAtoms`. Library callers opt into their cache and estimate callback. The CLI supplies both automatically.

The Northwind command captures below precede the pre-call estimate; their historical counts describe the committed recordings.

The model only splits prose chunks (the standing file, memory files, skill and helper bodies) into instruction, gate and register atoms, one call per chunk, with a strict JSON answer. Every quote is located in its file, inside its chunk, and checked at its span; an atom whose quote cannot be placed is refused and listed with its reason. A model atom that repeats an atom code already read is skipped and listed. An unreadable answer gets one retry. Model atoms wait for a person.

The scan of the Northwind estate, with the recorded labels of the pointer reader (the cassette of the fixture: no key, no network). It exits 1 because the checks refused some recorded answers, and each refusal is listed:

```
$ pnpm -s driftbench estate scan examples/estates/fixture --runtime claude-code --pointer --cassette examples/estates/fixture/cassette.jsonl --out _captures/docs3/estate/map.yaml --force
Wrote _captures/docs3/estate/map.yaml: 116 atoms (47 read by code and approved, 69 split from prose by the model and waiting for approval), 55 edges.
  Atoms per kind:
    instruction   31  (31 by the model)
    gate           6  (6 by the model)
    route         13  (6 by the model)
    skill          4
    reference     11  (11 by the model)
    script         2
    subagent       3
    guard          6
    tool          12
    setting        4
    stage          5
    register      14  (14 by the model)
    hazard         1  (1 by the model)
    invariant      4
  Prose: 11 chunks, 6412 characters (standing 1, memory 2, skill bodies 4, skill files 1, helper bodies 3).
  Pointer reader: system 1 <choice labeler> then system 2 anthropic claude-haiku-5-5 (margin cut 0.65).
  Units: 136 in 11 files; 0 kept from the ledger, 134 labelled by this run (21 by system 1, 113 by system 2), 2 unlabeled; the runs of one labeler disagreed on 2 units; the runs drew the spans of 31 units differently, and the first run's spans stand; 69 atoms; 30 notes (spans or links) were dropped, listed below.
  Requests: 91 answered, 0 sent, 0 recorded.
  Units since the last ledger: new 136.
  Document roles: 5 files labelled by the document-roles set; requests 30 answered, 0 sent, 0 recorded.
    refused: .claude/skills/invoice-reconcile/SKILL.md#2: the label condition needs a target unit inside the window
    refused: .claude/skills/supplier-email/SKILL.md#1: the label condition needs a target unit inside the window
    refused: .claude/skills/supplier-email/SKILL.md#1: the label condition needs a target unit inside the window
    refused: .claude/memory/supplier-languages.md unit wppif4nijv (reference): the label reference locates a file, and the unit names none
    refused: .claude/memory/supplier-languages.md unit 6ozmrzxzbf (reference): the label reference locates a file, and the unit names none
    refused: .claude/memory/supplier-languages.md unit srafha2fbv (reference): the label reference locates a file, and the unit names none
    refused: .claude/memory/supplier-languages.md unit 5ngeuzbg3y (reference): the label reference locates a file, and the unit names none
    refused: .claude/memory/supplier-languages.md unit p767q4i6tm (reference): the label reference locates a file, and the unit names none
    refused: .claude/memory/supplier-languages.md unit c45r7sr26k (reference): the label reference locates a file, and the unit names none
    refused: .claude/memory/supplier-languages.md unit l232ytzark (reference): the label reference locates a file, and the unit names none
    refused: .claude/memory/supplier-languages.md unit miootlwo6q (reference): the label reference locates a file, and the unit names none
    refused: .claude/skills/invoice-reconcile/SKILL.md unit gfz5utnqh3 (gate): the label gate needs a span, a link or a code span that the unit does not give
    refused: .claude/skills/supplier-email/SKILL.md unit dgwysklcdn (gate): the label gate needs a span, a link or a code span that the unit does not give
    refused: .claude/skills/supplier-email/SKILL.md unit h2cbsa3ka7 (gate-same): the label gate-same needs a span, a link or a code span that the unit does not give
    refused: CLAUDE.md unit nm5qvlsrod (gate-command): the label gate-command needs a span, a link or a code span that the unit does not give
    dropped: .claude/agents/route-planner.md#1: unit [7] span {"from":0,"kind":"governed-action","to":38}: the kind "governed-action" is not one the label rule may carry
    dropped: .claude/agents/route-planner.md#1: unit [7] span {"from":0,"kind":"ask-text","polarity":"positive","to":38}: the kind ask-text carries no polarity
    dropped: .claude/skills/invoice-reconcile/SKILL.md#2: unit [3] span {"from":0,"kind":"situation","to":30}: the kind "situation" is not one the label gate may carry
    dropped: .claude/skills/invoice-reconcile/SKILL.md#2: units "4" link {"kind":"act-tool","to":"Bash"}: the kind "act-tool" is not one the label rule may carry
    dropped: .claude/skills/invoice-reconcile/SKILL.md#2: units "5" link {"kind":"act-tool","to":"Edit"}: the kind "act-tool" is not one the label prohibition may carry
    dropped: .claude/skills/invoice-reconcile/SKILL.md#2: units "6" link {"kind":"act-tool","to":"Agent"}: the kind "act-tool" is not one the label dispatch may carry
    dropped: .claude/skills/invoice-reconcile/SKILL.md#2: unit [4] span {"from":0,"kind":"governed-action","to":52}: the kind "governed-action" is not one the label rule may carry
    dropped: .claude/skills/invoice-reconcile/SKILL.md#2: units "4" link {"kind":"act-tool","to":"Bash"}: the kind "act-tool" is not one the label rule may carry
    dropped: .claude/skills/invoice-reconcile/SKILL.md#2: unit [5] span {"from":6,"kind":"governed-action","to":36}: the kind "governed-action" is not one the label prohibition may carry
    dropped: .claude/skills/invoice-reconcile/SKILL.md#2: units "5" link {"kind":"act-tool","to":"Edit"}: the kind "act-tool" is not one the label prohibition may carry
    dropped: .claude/skills/invoice-reconcile/SKILL.md#2: units "6" link {"kind":"act-tool","to":"Agent"}: the kind "act-tool" is not one the label dispatch may carry
    dropped: .claude/skills/invoice-reconcile/SKILL.md#2: unit [3] span {"from":0,"kind":"situation","to":30}: the kind "situation" is not one the label gate may carry
    dropped: .claude/skills/shipment-tracker/SKILL.md#2: unit [2] span {"from":28,"kind":"situation","polarity":"positive","to":52}: the kind situation carries no polarity
    dropped: .claude/skills/shipment-tracker/SKILL.md#2: unit [2] span {"from":28,"kind":"situation","polarity":"positive","to":52}: the kind situation carries no polarity
    dropped: .claude/skills/shipment-tracker/SKILL.md#2: unit [5] span {"from":0,"kind":"situation","polarity":"positive","to":38}: the kind situation carries no polarity
    dropped: .claude/skills/shipment-tracker/SKILL.md#2: unit [2] span {"from":28,"kind":"situation","polarity":"positive","to":52}: the kind situation carries no polarity
    dropped: .claude/skills/shipment-tracker/SKILL.md#2: unit [2] span {"from":28,"kind":"situation","polarity":"positive","to":52}: the kind situation carries no polarity
    dropped: .claude/skills/shipment-tracker/SKILL.md#2: unit [2] span {"from":28,"kind":"situation","polarity":"positive","to":52}: the kind situation carries no polarity
    dropped: .claude/skills/supplier-email/SKILL.md#2: unit [6] span {"from":44,"kind":"ask-text","polarity":"","to":57}: the kind ask-text carries no polarity
    dropped: .claude/skills/weekly-report/SKILL.md#2: unit [3] span {"from":-1,"kind":"governed-action","to":-1,"unlocated":"the text is not in the unit"}: the text is not in the unit
    dropped: CLAUDE.md#1: unit [7] span {"from":8,"kind":"ask-text","polarity":"negative","to":119}: the kind ask-text carries no polarity
    dropped: CLAUDE.md#1: unit [10] span {"from":-1,"kind":"governed-action","to":-1,"unlocated":"the text is not in the unit"}: the text is not in the unit
    dropped: CLAUDE.md#1: unit [11] span {"from":-1,"kind":"ask-text","polarity":"negative","to":-1,"unlocated":"the text is not in the unit"}: the text is not in the unit
    dropped: CLAUDE.md#1: unit [41] span {"from":0,"kind":"ask-text","polarity":"negative","to":62}: the kind ask-text carries no polarity
    dropped: CLAUDE.md#1: unit [7] span {"from":8,"kind":"ask-text","polarity":"negative","to":118}: the kind ask-text carries no polarity
    dropped: CLAUDE.md#1: unit [10] span {"from":-1,"kind":"governed-action","to":-1,"unlocated":"the text is not in the unit"}: the text is not in the unit
    dropped: CLAUDE.md#1: unit [15] span {"from":-1,"kind":"ask-text","to":-1,"unlocated":"the text is found twice in the unit"}: the text is found twice in the unit
    dropped: CLAUDE.md#1: unit [7] span {"from":8,"kind":"situation","polarity":"negative","to":118}: the kind situation carries no polarity
    dropped: CLAUDE.md#1: unit [8] span {"from":-1,"kind":"governed-action","to":-1,"unlocated":"the text is not in the unit"}: the text is not in the unit
    dropped: CLAUDE.md#1: unit [15] span {"from":-1,"kind":"ask-text","to":-1,"unlocated":"the text is found twice in the unit"}: the text is found twice in the unit
    out of step: CLAUDE.md#1 run 2 of anthropic: 7 of 22 quoted clauses are not in their unit; the run is left out of the vote
  Ignored: none.
  Orphans: .claude/skills/invoice-reconcile/references/old-tolerances.md.
  Unreachable from the standing instructions: .claude/agents/inbox-triager.md.
  Unenforced: 44 of 51 rules have no guard.
    instruction.inbox-triager.you-sort-messages-into-three-folders
    instruction.inbox-triager.a-message-that-fits-none-goes
    instruction.inbox-triager.never-answer-a-message-yourself-and
    instruction.ledger-auditor.you-never-edit-a-file-you
    instruction.ledger-auditor.look-for-the-same-invoice-number
    register.ledger-auditor.answer-with-one-json-object-and
    instruction.route-planner.read-the-open-orders-and-the
    instruction.route-planner.never-put-more-than-the-van
    instruction.route-planner.never-plan-a-delivery-on-a
    register.route-planner.answer-with-a-table-van-stops
    instruction.memory-memory.never-schedule-a-delivery-on-a
    register.memory-supplier-languages.write-to-each-supplier-in-the
    register.memory-supplier-languages.when-a-supplier-is-not-in
    gate.invoice-reconcile.read-references-matching-rules-md-before
    instruction.invoice-reconcile.run-python3-scripts-reconcile-py-invoice
    instruction.invoice-reconcile.never-change-an-amount-on-an
    instruction.invoice-reconcile.when-the-total-difference-is-above
    register.invoice-reconcile.end-with-one-line-per-invoice
    instruction.shipment-tracker.ask-for-the-tracking-number-when
    instruction.shipment-tracker.when-the-carrier-answers-with-an
    register.supplier-email.every-draft-has-a-subject-with
    register.supplier-email.keep-a-draft-under-120-words
    instruction.supplier-email.a-looks-fine-or-a-thumbs
    instruction.supplier-email.never-copy-a-price-or-a
    gate.weekly-report.read-templates-report-md-before-writing
    instruction.weekly-report.count-only-what-the-ledger-and
    instruction.weekly-report.save-the-report-as-reports-year
    register.standing.r1-always-answer-in-the-language
    instruction.standing.r2-never-send-an-email-to
    instruction.standing.r7-when-a-shipment-is-late
    instruction.standing.r8-do-not-invent-order-numbers
    register.standing.r9-ask-at-most-one-question
    instruction.standing.r11-never-paste-the-contents-of
    gate.standing.read-git-status-before-commit-to
    instruction.standing.r16-if-a-tool-fails-twice
    instruction.standing.r17-report-a-number-only-when
    instruction.standing.every-task-follows-the-step-list
    instruction.standing.a-tracker-note-may-be-written
    instruction.standing.never-report-a-task-as-done
    register.standing.lead-with-the-result-in-the
    register.standing.use-a-bullet-list-for-three
    register.standing.never-use-the-words-obviously-or
    register.standing.write-amounts-with-the-currency-code
    gate.standing.read-claude-memory-memory-md-before
Next: driftbench estate lint _captures/docs3/estate/map.yaml; driftbench estate approve _captures/docs3/estate/map.yaml --kind instruction
```

The written map equals the committed `examples/estates/fixture/map.yaml` but for the root it records and the time of the scan. With `--no-model` it holds the structured atoms only, and the files that only the prose names are listed as orphans, since code does not read a sentence:

```
$ pnpm -s driftbench estate scan examples/estates/fixture --no-model --out _captures/docs3/estate/map-nomodel.yaml --force
Wrote _captures/docs3/estate/map-nomodel.yaml: 47 atoms (47 read by code and approved, 0 split from prose by the model and waiting for approval), 34 edges.
  Atoms per kind:
    route        7
    skill        4
    script       2
    subagent     3
    guard        6
    tool        12
    setting      4
    stage        5
    invariant    4
  No model call: structured atoms only (--no-model).
  Prose: 15 chunks, 6961 characters (standing 1, memory 2, skill bodies 4, skill files 5, helper bodies 3).
  Unanswered prose chunks (no model call): 15, 6961 characters.
    CLAUDE.md  2782 characters
    .claude/agents/inbox-triager.md  169 characters
    .claude/agents/ledger-auditor.md  519 characters
    .claude/agents/route-planner.md  301 characters
    .claude/memory/MEMORY.md  236 characters
    .claude/memory/supplier-languages.md  271 characters
    .claude/skills/invoice-reconcile/SKILL.md  547 characters
    .claude/skills/invoice-reconcile/references/currency-table.md  143 characters
    .claude/skills/invoice-reconcile/references/matching-rules.md  261 characters
    .claude/skills/invoice-reconcile/references/old-tolerances.md  144 characters
    .claude/skills/shipment-tracker/SKILL.md  400 characters
    .claude/skills/supplier-email/SKILL.md  507 characters
    .claude/skills/weekly-report/SKILL.md  419 characters
    .claude/skills/weekly-report/templates/report.md  126 characters
    .claude/skills/shipment-tracker/data/shipments.txt  136 characters
  Refused: none.
  Ignored: none.
  Orphans: .claude/skills/invoice-reconcile/references/currency-table.md, .claude/skills/invoice-reconcile/references/matching-rules.md, .claude/skills/invoice-reconcile/references/old-tolerances.md, .claude/skills/shipment-tracker/data/shipments.txt, .claude/skills/weekly-report/templates/report.md, .claude/steps.json.
  Unreachable from the standing instructions: .claude/agents/inbox-triager.md, .claude/agents/ledger-auditor.md, .claude/agents/route-planner.md, .claude/skills/invoice-reconcile/SKILL.md, .claude/skills/invoice-reconcile/scripts/reconcile.py, .claude/skills/shipment-tracker/SKILL.md, .claude/skills/shipment-tracker/scripts/check-carrier.sh, .claude/skills/shipment-tracker/scripts/track.sh, .claude/skills/supplier-email/SKILL.md, .claude/skills/weekly-report/SKILL.md.
  Unenforced: 0 of 0 rules have no guard.
Next: driftbench estate lint _captures/docs3/estate/map-nomodel.yaml; driftbench estate approve _captures/docs3/estate/map-nomodel.yaml --kind instruction
```

The map is YAML with a header on how to approve it, `producedBy` per atom and, for the map, the model family and model that split the prose. The loader recomputes every provenance hash and the map hash, so a map whose quote or span was edited is refused; `approved` and `role` may be edited by hand.

### Document roles and navigation

The reader classifies document authority before reading declarations or passing prose to the scanner. The map records each document's role and its reasons under `documents`: normative, changelog, history, template, example, journal, fixture or archive. A role comes, in this order, from the estate's own declaration (`documents:` in `driftbench.estate.yaml`, a glob to a role), from a recorded label (with `--pointer`, the scan asks the shipped `document-roles` set once per prose file the runtime does not itself load as instructions; the standing file, memory, a skill's body and a helper's body are never asked, and take their role from structure, on its first 40 lines, before anything else, and the answer is recorded and replayed like every label), or from structure: repeated placeholder value slots make a template, a list of dated entries a history, and a cross mark (✗, ✘, ❌, ×) alone on its line opens a counter-example section. No word of a folder name, a heading or a line decides a role. One incidental date or a variable path in a live procedure does not change its authority.

Non-normative documents remain navigation targets. Their bodies yield no rules, gates or hazards, and their outgoing references are not linted as broken dependencies. A live prerequisite that names a template still requires that read. A record or store (changelog, history, journal, archive, fixture) outside every live skill is not an orphan or unreachable defect; a template, an example, or any file inside a live skill's folder that nothing names still is. Placeholders and examples never establish a missing file. A path whose extension names a document or script type, and which does not exist, is `MISSING_REFERENCE`; a pair, a ratio, a version or a dotted name is no reference at all. A quoted or linked filename with an extension that is absent is also `MISSING_REFERENCE`. A name with no extension or separator that resolves nowhere is informational `UNRESOLVED_REFERENCE`; ambiguous names retain their existing findings.

See [document roles and precision](estate-document-roles.md) for the role evidence, authority boundaries and independent synthetic measurement.

### Reading the prose by pointing: `estate scan --pointer`

The model pass above asks a model to quote the rules it finds, and code then looks for each quote in the file. The pointer reader turns that around. Code cuts every prose file into units by its structure, a labeler is shown the units with a number each, and it answers a label for each number. It writes no text, so every quote of an atom is a slice of the file at its lines. No list of words and no grammar rule decides what is a rule: what a label means is data the user declares.

```
driftbench estate scan <root> --out map.yaml --pointer --cassette pointer-cassette.jsonl --ledger pointer-ledger.json --update
```

* **Units.** A unit is a sentence, a list item, a table cell, a paragraph of a block quote, a heading or a value of the front matter. A fence or a comment is opaque: it is never sent, so no label can point at it. Sentences are cut from the text with the inline code, the links and the emphasis marks masked, and the cutter joins when it is unsure, so a wrong cut costs a coarser unit and never a wrong quote.
* **Label sets.** A label set is a named list of labels, each with a description, up to three examples, an optional `target: required` for a label that links two units, and optional `spans` and `links` (clauses of one unit by character offsets, each an exact slice of the file, and links to atoms the request lists; the labeler writes no text), an optional `atom` mapping that says which kind of atom a unit with that label becomes, and an optional `condition: true` (with `target: required`, and no `atom`) for a label whose unit states when its target applies: the text of that unit becomes the `situation` of the target's atom. The shipped set `agent-rules` (rule, prohibition, gate, reply rule, example, description) is data in the same format as a set of your own, given with `--labels`. The words of the request come from the set, not from the code, so the same code labels a style guide for a bakery.
* **Two classes of labeler.** The labelers are named by the class the judges use ([judges](concepts/judges.md)). A `system1` labeler is a model that answers with probabilities: a choice among the labels, or a yes or no question per label. A `system2` labeler is a chat model that reads the numbered window and answers a label per unit. A chat model cannot be pinned to one answer, so each window is asked five times: a unit takes the label (and the same target) that three of the five runs give; this costs about 5/3 of the system 2 calls of three runs per window. A run whose unit numbers slipped (more than a quarter of the clauses it quotes, and at least four, are not in their unit) is left out of that window's vote and out of its count: a unit takes the label more than half of the runs heard give, two runs heard at least, so three slipped runs of five no longer leave the window with no label. The report lists such a run under `out of step`. Its window is then asked again, as runs 6, 7 and 8 at most (`REASK_LIMIT`, 3), until as many runs are heard as were asked: a re-ask in step takes the slipped run's place and is listed under `asked again`. A re-ask is recorded under its own run number, so a replay reads the same answers; a cassette that holds no re-ask leaves the slipped run unheard. In the shipped set, `rule` is the generic label and a gate or a hazard a specific form of it: when the runs in step split evenly between `rule` and one gate or hazard label, two runs at least on each side, the specific label wins. Any other tie stays unlabeled, a tie between `rule` and `condition` included: a condition gives no instruction of its own. In a set whose labels build atoms (not the document roles), when no label holds more than half of the runs heard, the labels that build the same atom kind vote together, and the labels that build no atom (`none`, a description, an example) form one group; a label that points at another unit, such as `condition`, is a group of its own for each target it names, so runs that point at different units never vote together. A unit that names a file (a code span or a link holding a path) is never a condition by its runs alone: its condition runs count toward one group with the runs that read it as a reference or a gate, and inside that group the runs whose label can build its atom from their spans and links choose the label, the most given one, a tie staying unlabeled. Such a unit that only conditions name is a split: its window is asked again, two voices at a time as for a tie, and the unit stays unlabeled while no reference or gate reading comes. So "When the invoice is not in EUR, read `references/currency-table.md` to convert every amount", read as a condition by three runs and as a gate by two, is a gate. A group that holds more than half of the runs heard gives the label most of its runs gave: two runs of `rule`, one of `prohibition`, one `description` and one `example` give `rule`. A tie inside a group that builds an atom stays unlabeled, since `rule` and `prohibition` build different instructions; inside the group that builds none, the earliest run's label stands. A split between atom kinds, such as two runs of `reply-rule` against two of `rule`, is never decided by the groups. Whenever the two most given labels of a unit tie, inside one kind or across kinds, and nothing above decides it, the window is first asked two more times (`SPLIT_REASK_RUNS`, 2, recorded under their own run numbers and listed under `asked again`), and the answers in step are extra voices on that window's units. The vote above then counts every run heard; a unit that still has no label or group in the majority stays unlabeled. Unanimity was tried first and dropped units the model reads two ways run after run (a prohibition or a plain rule; a gate or a plain rule): on the Northwind fixture it left 38 of 151 units unlabeled, 3 with the vote. A run that leaves a unit out counts for no label. A unit with no label that two runs share stays unlabeled, and the report counts it. Spans and links are those of the first run that gave the label with any. The default is a stack of both: system 1 decides a unit alone when its likeliest label leads the second by the margin cut (`--labeler-margin-cut`, default 0.65), and system 2 decides the rest. System 1 is offered only the labels it can answer (none with a target, spans or links), so its `none` means none of those: when system 2 has no opinion on a unit (its runs split, or every answer was refused), that `none` decides nothing and the unit stays unlabeled. Either runs alone with one `--labeler <class>:<client>`. The public system 1 example is the OpenAI Decisions API (`system1:openai-decisions:<model>`); the Nexus platform client is on the [Nexus adapter page](adapters/nexus.md).
* **A labeler of your own.** `--labeler system2:http:<url>` or `--labeler system1:module:<path>` puts your endpoint or your module behind the same port. Its answers are recorded and replayed like the others, and its id is part of every cassette key. The contract suite `@agent-nexus/driftbench-estate/labeler-contract` checks it in a vitest test file: `labelerContract(name, make, { cls })` holds it to the port the built-in labelers pass, record then replay with no call included (topic `validate-estate-scan`).
* **The cassette.** Every answer is recorded with the hash of the whole request as its key, so a scan without `--record` needs no key and no network, and a changed prompt, set (labels, atom mappings and conditions included), model, labeler, cut or run misses and names the field that differs. The models cannot be pinned to one answer, so the cassette is where the scan is deterministic. It holds file names, hashes and answers, never the text of a unit. `--record` appends each answer as it arrives, so a run that stops keeps what it paid for.
* **The ledger.** Each unit has an id, derived once from its file and its text and then kept in the ledger as the file changes: the ledger follows a unit that is edited, moved, split or merged, and says when it is gone. `--update` writes the ledger; without it the scan reads the ledger and leaves it as it is. `--ledger-check` fails when a file changed and the committed ledger did not. A label stays with its unit only while the set and the labelers that made it are the same.
* **Windows.** A labeler is shown a file in windows of numbered units. A window holds at most 60 units (default, owner may change), and fewer when a labeler states a lower limit for one request. A window ends when it is full, and before a heading that sits under no other heading of the file, whatever its level. A window never holds units of two files, and never an opaque unit.
* **Following a unit.** The ledger follows the units of the last scan into the new cut in this order:
  * In each file, the longest run of texts the old and the new file share in the same order is `unchanged`, and each of those units keeps its id.
  * A unit whose text is found once elsewhere, in any file, is `moved` and keeps its id. A text found more than once is `ambiguous`, and the id stays on the first match.
  * A text shorter than 12 characters (default, owner may change) is followed into another place only when it is the only unit with that text in the old files and in the new ones. Otherwise it is scored in its own file.
  * Two neighbouring new units that read as the old unit better together than apart are a `split`: the first keeps the id. Two neighbouring old units that read as one new unit are `merged`.
  * The rest is scored in the same file only: 0.6 for the text and 0.4 for the context (the 32 characters before, the 32 after and the heading path). A pair whose lengths differ by more than 0.8 of the longer one is not scored.
  * A pair is `changed` when its score is at least 0.45 and its text alone is at least 0.4 similar by edit distance, the text floor (both default, owner may change). A unit rewritten below the floor becomes a `deleted` unit and a `new` one, even with the same neighbours.
* **Labels across an edit.** A label is kept only when the unit's text and its context are unchanged: the fingerprint of the unit, the fingerprints of the units before and after it, and its heading path. A unit that is `changed`, `split` or `merged`, or that moved, or whose neighbours or heading path changed, keeps its id and loses its labels, so it is labelled again. Of two `merged` units, the first one's id goes to the new unit and the second is `deleted`.
* **Deleted units.** A unit that nothing follows is counted `deleted` once, in the scan where it goes. It stays in the ledger with the status `deleted` and its quote, so a link to it falls back to its section. The report prints `Units since the last ledger:` with the count of each event above zero: `new`, `unchanged`, `moved`, `ambiguous`, `changed`, `split`, `merged` and `deleted`.
* **The situation span.** The shipped set's rule, dispatch, prohibition and reply-rule labels may carry a `situation` span: the circumstance in which the unit applies, in the unit's own words. It becomes the `situation` of the atom, as an exact slice of the file. A mapping writes `situation: $span.situation?` (a trailing `?` makes it optional): a unit with no such span keeps its atom, without a situation.
* **Structured fields.** The `fields` of an atom mapping hold scalars, lists and objects. A string anywhere inside a value may hold a placeholder (`$span.<kind>`, `$link.<kind>`, `$code`, `$path`, `$unit`, `${...}` inside a longer string), filled from the clauses and links the labeler gave, as for the title. A value with a placeholder the unit does not fill refuses the atom, with the reason. Declarations such as a list of files to read again, or an ordered pair, are label data this way, never words read by code. More forms: a key that ends in `?` is optional and is left out when its value does not fill; `{ firstFilled: [a, b] }` takes the first alternative that fills; `$paths`, `$codes` and `$commands` are the files the unit names, its inline code spans, and those spans that lead to no file; `{ each: $codes, item: { ... $item ... } }` builds a list with one entry per member; `$has.<span>` is `true` when the labeler gave that span. A mapping may also write `replyAct` (the act of the agent's reply that the atom governs) as a top-level key of the atom, filled the same way; a `replyAct` that does not fill is left out and the atom is kept.
* **A note that fails is dropped, the label stands.** A span or a link of an answer that fails its check (offsets that leave the unit, a span that overlaps an earlier one, a link to an atom the request did not list, a kind given twice for the same atom, for none or for a second value of a closed list; two links of one kind to two atoms both stand, one atom each) is dropped alone, with its reason. The label is kept, and so are the notes that passed. An atom whose mapping needs a dropped note is refused with its own reason, as before. The scan lists each dropped note as `dropped:`; a dropped note does not change the exit code. An empty or non-list `spans` or `links`, and an entry that names a label outside the set, are still refused whole.
* **The atoms.** A unit with a label that has an `atom` mapping becomes an unapproved atom of that kind, with `fields.extraction: pointer`, the unit id, the set, the label and the class that decided it, and one `prose_pointer` check that a person reviews before the atom is approved.
* **Atoms of two units.** A label with a target links two units. The atom it builds quotes from the start of the earlier of the two units to the end of the later one, in file order, and its lines run the same way.

The report names the classes and clients, counts the units kept from the ledger, the units labelled by this run and which class decided them, and prints the tokens each service reported. The topic `validate-estate-scan` lists every option and the shape of a user labeler's request and answer.

### The estate configuration file

An estate may hold `driftbench.estate.yaml` at its root, or at `.claude/driftbench.estate.yaml` (the root file wins; the second place is copied with the runtime's own folder, so a unit run of a copy or a mutant sees it). The scan and the unit runner read it; every key is optional. Tooling files are not instructions to the agent: the configuration file, and any file whose path it writes (a helper's executor script), are named by it and are neither orphans nor unreachable. [What you can change in an estate](estate-settings.md) lists every setting, file and port with an example each.

| Key | Read by | Holds |
|---|---|---|
| `ignore` | `estate scan`, `estate lint` | globs of paths no runtime loads, skipped beside the defaults: version control, dependency and cache folders, logs, test fixtures, and the files an operating system or an editor leaves. Each glob is matched like a `.gitignore` line: without a leading slash at any depth, `**` across folders, a matched folder skipped whole. `--ignore <glob>` adds to the list for one run |
| `externals` | `estate scan` | folders outside the estate a path may name, such as the project the agent works on. They replace the defaults, `docs/` and `_meta/` |
| `userSkills` | `estate scan`, `estate lint` | the folder of the [user-level skill layer](#reading-the-estate-estate-scan) to read as a second skill layer (relative to the estate root); without it or `--user-skills <folder>` none is read. The option wins over it |
| `aliases` | `estate scan` | a map from an alias, such as `REF`, to the folder or folders it stands for, relative to the root: `REF/a/b.md` then reads as `<folder>/a/b.md` |
| `documents` | `estate scan` | a map from a glob to a document role (`normative`, `example`, `template`, `history`, `changelog`, `journal`, `archive`, `fixture`). A declared role wins over the recorded label and over structure |
| `helpers` | `estate unit` | per helper name, a local executor `command` argument array and optional positive `timeoutMs`; the unit runner sends the current body and task on stdin |
| `scripts` | `estate unit` | per script path, a fixture list or `{ usage, fixtures }` contract: `args`, `stdin`, `files` (name to text, written in a fresh working folder) and `expect` (`exitCode`, default 0; `stdout`; `stdoutIncludes`, a list) |
| `labels` | `estate scan --pointer` | the label sets: a file of label sets, relative to the root, or the list of sets inline. `--labels` wins |
| `labeler` | `estate scan --pointer` | a labeler, or a list of one per class, as `<class>:<client>` (`system2:anthropic`, `system1:http:<url>`). It names no model: a model is set by environment variable. `--labeler` wins |
| `threshold` | `estate scan --pointer` | a mapping of `labeler` (the yes or no threshold), `pass_at`, `fail_at` and `margin_cut`, each a number from 0 to 1. Each `--labeler-*` option wins over its key |
| `ledger` | `estate scan --pointer`, `radius ledger` | the ledger of unit ids, relative to the root. `--ledger` wins; the scan still writes it only with `--update` |

A helper executor and the fixtures of a script, as the unit runner reads them (`helpers` and `scripts` keys; YAML anchors may share one executor):

```text
helpers:
  route-planner:
    command: [python3, .claude/stand-in-helper.py]
    timeoutMs: 10000
scripts:
  .claude/skills/shipment-tracker/scripts/track.sh:
    usage: track.sh <carrier code> <tracking number>
    fixtures:
      - args: []
        expect: { exitCode: 2 }
```

For a helper, the runner compares the copy's files before and after the executor runs and supplies that `workspaceDiff` when the executor reports none, so `expect.workspace` is decided on what the run changed. The same holds for the files a declared script fixture writes in its case folder.

A key with the wrong shape is left out of the scan without a note, except a key of the pointer reader: it stops the scan, since it would change the labels. No key names a model; a model is set by environment variable: `ANTHROPIC_LABELER_MODEL`, `JEV_MODEL`, `OPENAI_DECISIONS_MODEL`. A change of a setting voids only the recordings it touches: a label set's description voids that set's answers, a model voids its labeler's answers, and a threshold, a labeler left out or a moved ledger void none. [`examples/estates/reader-cases/driftbench.estate.yaml`](../examples/estates/reader-cases/driftbench.estate.yaml) uses `ignore`, `externals` and `scripts`.

### Approving the prose atoms: `estate approve`

With no flag, `estate approve` lists what waits, kind by kind, with each atom's file, line and quote. On the Northwind map (the first line and the count line of each kind; the 54 atom lines are left out):

```
$ pnpm -s driftbench estate approve examples/estates/fixture/map.yaml
examples/estates/fixture/map.yaml: 69 of 116 atoms wait for approval.
  instruction: 31
  gate: 6
  route: 6
  reference: 11
  register: 14
  hazard: 1
```

Approving one kind, then the rest into a new file beside the map:

```
$ pnpm -s driftbench estate approve _captures/docs3/estate/map-approve.yaml --kind register
Approved 14 atoms in _captures/docs3/estate/map-approve.yaml; 0 were already approved.
$ pnpm -s driftbench estate approve _captures/docs3/estate/map-approve.yaml --all --to _captures/docs3/estate/approved-all.yaml
Approved 55 atoms in _captures/docs3/estate/approved-all.yaml; 61 were already approved.
```

The committed `examples/estates/fixture/approved.yaml` is the Northwind map with every atom approved with `--all`, by the person who wrote the fixture. A review of the prose atoms by the estate's owner is still to do: approval with `--all` stands in for it.

```
$ pnpm -s driftbench estate approve examples/estates/fixture/approved.yaml
examples/estates/fixture/approved.yaml: all 116 atoms are approved.
```

## 2. Relations: the estate graph

Edges, decided by code:

| Edge | From, to |
|---|---|
| route | a route atom to the skill or helper it loads |
| reference | a skill or helper to a reference atom in a file it owns: its own file and, for a skill, the files of its own folder that its citations lead to, each read once (a file in the skill folder that nothing names has no owner). Edges are direct: a file outside the folder that several units cite, such as a shared index, is cited by each unit with one edge and its own citations belong to no unit's edges, so an index cited by 57 units and citing 3,500 files stores 57 edges and not 200,000. What a unit reaches by following citations is computed on demand (`filesReached`, `citationsByFile`) and never stored |
| script | a skill to a script it ships |
| dispatch | a skill or helper to a helper its body names; by an imperative or obligation clause whose object or recipient is a known helper (quoted or plain). Predicate vocabulary is open; grammatical parts of speech distinguish actions from mentions. The helper name must end its noun phrase: a possessive, path suffix or following noun does not name that helper. Dispatch uses the gate clause boundaries and negation scope: prohibitions, optional acts, quoted examples, historical descriptions and noun phrases create no dispatch edge. Transfer objects are noun phrases ending at the recipient preposition; their determiners, possessives, quantities, modifiers and coordination do not restrict dispatch. Coordinated helper targets inherit the same directive and polarity |
| enforces | a guard to a rule it checks |
| event | a guard to the event it runs on (an event node `event.<name>`, not an atom; the loader allows such an end on event edges only) |
| allows | a skill or helper to a tool or skill it may use |
| next | a stage to the stage that follows it |
| cites | a rule to a rule its words name by label |

`enforces` is decided in this order, and the method is kept on the guard atom: a check registry row that names the guard's script and lists rule labels (R5) or quoted passages; a label the guard source declares (`Enforces: R3, R5`); a string of 16 or more characters in the guard source that repeats a rule's quote. Only instruction, gate and register atoms are enforced. A rule label is matched without regard to case or an optional `#` (`r1`, `R#1` and `R1` are one label), wherever it is written: the rule's own definition, a registry row, an `Enforces:` declaration or a hash citation in a guard message. Ordinary prose that happens to hold `r1` defines and cites nothing. A string in a guard's source that holds only part of a rule counts when it reaches past the rule's condition: a message repeating only "the user asks to stop" of "When the user asks to stop, stop all work" repeats when the rule applies, not the rule (a registry row declares its passage, so any passage it quotes counts). A bare label after a known identifier-bearing entity noun names that entity, not a rule. The vocabulary covers the following broad classes; singulars and regular plurals are supported, with explicit irregular forms for appendix, entry and shelf. It is a lexical resource, not a claim to recognize every English count noun. Unlisted words keep the citation. Clear subject/verb contexts and ambiguous finite-verb inflections retain citations even for noun/verb homographs: "Agents label R1", "We permit R1", "Please record R1" and "Label R1 as mandatory" cite R1. At clause start a finite predicate can establish an entity subject ("Permit R1 is valid"). An explicit hash citation (`R#1`) always cites the rule.

A JSON or YAML registry row lists the rules it checks under `enforces`, `rules` or `gates`, in one of four shapes. A scalar string that is a whole list of labels (`R3, R5` or `R3 and R5`) gives one rule label per entry; any other string is one quoted passage. A list holds any mix of these strings. An object `{ id: R3 }` names a label, and an object `{ quote: "Read the current record first." }` names a passage. A value that is empty, a number, a boolean or an object with neither key gives no rule. A rule label or passage found this way feeds the same `enforces` decision as a Markdown registry cell.

| Entity class | Identifier-bearing nouns |
|---|---|
| Publications, records and their addressable parts | agreement, appendix, article, attachment, bulletin, chapter, column, contract, declaration, diagram, document, edition, entry, equation, exhibit, field, figure, form, letter, line, memo, page, paragraph, plate, plot, publication, record, report, revision, section, table, version, volume |
| Transactions, credentials and administrative records | account, application, badge, bill, booking, case, certificate, claim, credential, credit, debit, invoice, license, order, passport, payment, permit, purchase, receipt, refund, registration, reservation, ticket, transaction, voucher, warrant |
| Physical locations and storage positions | address, aisle, apartment, bay, booth, building, cabin, cell, counter, desk, dock, door, floor, hall, hangar, locker, office, platform, port, rack, room, row, seat, shelf, site, stall, station, terminal, warehouse, zone |
| Inventory, logistics and transport units | aircraft, asset, batch, box, bus, carriage, carton, compartment, component, consignment, container, device, flight, item, label, lot, model, module, package, pallet, parcel, product, route, shipment, train, trip, truck, unit, vehicle, vessel |
| Addressable software and data entities | branch, build, checkpoint, dataset, job, node, project, queue, release, repository, tab, widget |


The graph answers what code can walk:

* Reachable from the standing instructions. The roots are the atoms of the standing, memory and settings files. The walk follows route, reference, script, dispatch, allows, next and cites edges. Reaching a skill or helper reaches every atom of its file. A skill or helper whose own description is its only way in is unreachable from the standing instructions, even though the runtime lists descriptions; in the Northwind estate that is the `inbox-triager` helper.
* Orphans: files nothing names.
* Unenforced rules: instruction, gate and register atoms no guard enforces.
* Missing references and missing guard scripts.

### Checking the estate: `estate lint`

| Code | Finding |
|---|---|
| `ORPHAN` | a file nothing names |
| `UNREACHABLE` | a file the standing instructions never lead to (orphans are listed apart) |
| `UNENFORCED` | an instruction, gate or register atom no guard enforces: trusted, reported as a count, never failing alone |
| `OVERSIZE` | the standing instructions are over the ceiling, counted in Unicode characters (code points): an emoji is one character, never its bytes or UTF-16 units |
| `UNANCHORED_GUARD` | a guard command finds its script from the working folder, not from an anchor |
| `MISSING_REFERENCE` | a concrete path a live body names does not exist |
| `UNRESOLVED_REFERENCE` | a name with no separator and no extension resolves nowhere; informational, never failing alone |
| `MISSING_SCRIPT` | a guard command runs a script that does not exist; a dispatcher whose source passes a positional or parsed-option value to an executed or imported file path, or whose usage documents that file role, also names a missing target. A folder or filename never establishes dispatch; ordinary subcommands remain arguments. The bounded static reader follows argument identity through local assignments, interpolation, path joins, slices and unpacking into Python execution/import APIs, Node execution/require, Ruby load/require and shell execution. Data passed to a fixed program stays data; unknown code remains the outer script |
| `REGISTRY_ROW` | a guard has no row in the check registry |
| `REGISTRY_GUARD` | a registry row names a guard the estate does not run |
| `QUOTE_DRIFT` | an atom's quote is no longer at its span: scan again |
| `AMBIGUOUS_REFERENCE` | a bare file name fits several files and none in the naming file's own folder (planned rule above) |

The lint of the Northwind map finds every planted defect:

```
$ pnpm -s driftbench estate lint examples/estates/fixture/map.yaml
examples/estates/fixture/map.yaml: estate at examples/estates/fixture, 116 atoms.
  ORPHAN             .claude/skills/invoice-reconcile/references/old-tolerances.md: nothing in the estate names this file
  UNREACHABLE        .claude/agents/inbox-triager.md: no route, reference or dispatch from the standing instructions leads here
  MISSING_REFERENCE  .claude/skills/weekly-report/SKILL.md:12 names .claude/skills/weekly-report/references/kpi-definitions.md, which does not exist
  UNANCHORED_GUARD   the guard command "python3 .claude/guards/ledger-guard.py" finds its script from the working folder; anchor it on the project folder
  REGISTRY_ROW       the guard reply-length.py has no row in the check registry
  REGISTRY_GUARD     registry row G6 names supplier-send-guard.py, which no guard of the estate runs
  UNENFORCED  44 rules no guard enforces (trusted; listed by estate scan).
  EXTERNAL    0 named paths outside the estate (information).
6 findings.
```

It exits 1.

## 3. Variables: the interaction space of an estate

The map's dimensions. Axis dimensions form the cells; detail dimensions vary inside a cell. Code proposes the role per kind: instruction, gate, route, skill, subagent, guard, stage and register atoms are axis atoms; reference, script, tool, setting, hazard and invariant atoms are detail. A person may change the role in the map.

`estate map` writes six situation axes, the same for every estate, then one target dimension per atom kind that holds approved axis atoms:

| Dimension | Values |
|---|---|
| `ask_class` | build, operate, debug, research, compose, change_estate, chat |
| `ask_shape` | concrete, ambiguous, prescribed, problem, multi_part, correction |
| `session_state` | fresh, resumed, after_compaction, after_restart, long, helpers_running |
| `owner_signal` | go, hold, no_questions, keep_going, stop, language_switch, frustration, limit_word |
| `deviation` | none and the twelve deviation classes: D1_off_topic, D2_goal_shift, D3_contradiction, D4_loose_confirmation, D5_language_switch, D6_instruction_in_data, D7_silence_or_burst, D8_tool_failure, D9_out_of_scope, D10_return, D11_pii_leak, D12_prompt_extraction ([drift](concepts/drift.md)) |
| `estate_hazard` | no_hazard, compaction_mid_task, process_restart, rate_wave, stale_tracker, dead_helper |
| `atoms.<kind>` | the approved axis atoms of that kind |

The space map accepts only the twelve classes as deviation values, so the estate's own hazards are a dimension of their own. Three constraints name impossible combinations: a fresh session meets no compaction mid-task, no dead helper and no stale tracker. The prior is declared.

```
$ pnpm -s driftbench estate map examples/estates/fixture/approved.yaml --to _captures/docs3/estate/space.yaml
Wrote _captures/docs3/estate/space.yaml: 6 situation axes, 8 target dimensions (instruction 31, gate 6, route 13, skill 4, subagent 3, guard 6, stage 5, register 14), 3 constraints.
  The full grid holds 1916337346560 cells: plan on t-wise coverage, not the full grid.
```

The committed `examples/estates/fixture/space.yaml` is the same file written with `--agent northwind`. The full grid is far above the 250,000 cells the space commands enumerate, so the plan covers it t-wise and never enumerates it.

## 4. The plan: what to cover, before any test text

From the approved map, code derives the test plan (`estate plan`). A row names the atoms it exercises (the atom under test first, then the skill or helper it belongs to), its cell on the situation axes, its test type, its run mode, a status (`proposed`, `approved`, `struck`) and a weight. Rows come from three sources.

The contract: every approved atom gets the mandatory test types of its kind. Negative controls (`outside_trigger`, `route_near_miss`, `guard_negative`) are rows of their own.

| Atom kind | Mandatory test types per atom |
|---|---|
| Instruction | `obligation` (the act happens; a prohibition is worded as an act that does not happen), `outside_trigger` (over-firing: the act does not happen, or an allowed act is not held back), `twin` (another phrasing) |
| Gate | `ordered_pair`; `skip_pressure` (cell `owner_signal: keep_going`) |
| Route | k `route_positive` (default 3, `--k`); `route_near_miss` (`ask_shape: ambiguous`); `misroute` (`ask_shape: concrete`) |
| Skill | its route, instruction, reference and script rows name it; a skill no approved route names gets one `route_positive` row of its own |
| Reference | `read_when` |
| Script | `script_fixture` |
| Subagent | `dispatch`, `contract_alone`, `stop_resume` (`session_state: helpers_running`, `estate_hazard: dead_helper`) |
| Guard | `guard_positive`, `guard_negative`, `guard_hostile`, `guard_speed`, `guard_register` |
| Tool | `tool_denied` for a deny rule, else `tool_boundary`; `tool_deferred` for a tool that loads late (the scanner does not read deferred tools yet) |
| Stage | `stage_order` and `stage_skip`; a step allowed at any point gets `stage_anytime` only |
| Register | `register_sample`, one row per ask class |
| Hazard | `hazard_recovery`, the hazard crossed with a long task |
| Invariant | `invariant` |
| Setting | none: a setting is the run's configuration, carried in Given. A hand space map that lists a setting atom as a target is refused. |

Run modes: `guard_positive` replays a recorded event; `script_fixture`, `contract_alone`, `guard_negative`, `guard_hostile`, `guard_speed`, `guard_register` and `invariant` run as units; every other type runs live.

Journeys: edge coverage over the route, reference, script, dispatch and next edges of approved atoms. A script reached from a skill is part of the journey, so the generated live test checks its execution as well as the skill load. A start node stands for the standing instructions: it points at the routes stated outside any skill or helper file and at the stages no `next` edge enters. Each path is a journey row listing its atoms in order. A route read only from a skill or helper description starts no journey; the Northwind estate has 7 such routes, reported as edges with no journey, and each still gets its contract rows.

Pairwise: a covering array of strength t (default 2) over the situation axes, under the constraint list, with the target dimensions merged into one: every pairwise row is one atom in one situation, with the first test type of its atom's kind, live. A constraint on one target atom is carried; one that names atoms of two kinds cannot hold for a single target and is dropped (and counted). In the Northwind plan the lower bound is the targets times the deviation values, 89 times 11, or 979; the array has 980 rows.

### Situation relevance in a proposed plan

Which atoms a situation acts on is not inferred from the words of the estate: no title, quote, situation or description decides it (the estate path reads no English word list). Relevance comes from a declared space: `estate map --to space.yaml` exports one, and `estate plan --space` makes it authoritative, its values and constraints used as declared. Without a supplied space, each value of an event axis (`session_state`, `owner_signal`, `deviation`, `estate_hazard`) is reported as unresolved: its combinations remain in the plan, with a note naming the value. A missing relevance never removes an entire situation to obtain vacuous coverage. The baseline of each axis and an unperturbed long session remain available, and mandatory contract rows and journeys keep their own obligations. These are proposed rows, subject to approval like the rest of the plan.

The captured Northwind example below uses the explicit full space exported by `estate map`.

The plan of the approved Northwind map:

```
$ pnpm -s driftbench estate plan examples/estates/fixture/approved.yaml --out _captures/docs3/estate/plan.yaml
Wrote _captures/docs3/estate/plan.yaml: 1427 rows (350 from the contract, 10 journeys, 1067 pairwise), all proposed. Summary in _captures/docs3/estate/plan.summary.json.
  Cells: 1312 (a cell is the atoms of a row crossed with its situation values).
  Covering array: 1067 rows, t = 2, 4632 of 4632 allowed 2-tuples covered; the full grid of 1916337346560 cells is never enumerated.
  Mandatory rows per kind (a row counts once for each kind it names):
    instruction    93
    gate           12
    route          65
    skill         117
    reference      11
    script          2
    subagent       72
    guard          30
    tool           12
    setting         4
    stage           9
    register       98
    hazard          1
    invariant       4
  Rows per test type (contract, journeys and pairwise together):
    obligation        435
    outside_trigger    31
    twin               31
    ordered_pair       84
    skip_pressure       6
    route_positive    260
    route_near_miss    13
    misroute           13
    read_when          11
    script_fixture      2
    dispatch           42
    contract_alone      3
    stop_resume         3
    guard_positive     84
    guard_negative      6
    guard_hostile       6
    guard_speed         6
    guard_register      6
    tool_boundary       9
    tool_denied         3
    stage_order        69
    stage_skip          4
    stage_anytime       1
    register_sample   280
    hazard_recovery     1
    invariant           4
    setting             4
    journey            10
  Unenforced: 44 approved rules no guard enforces.
  Cells with no approved phrase: 1312 of 1312.
  Edges with no journey: 7.
    route.inbox-triager.an-ask-that-fits-inbox-triager route subagent.inbox-triager.helper-inbox-triager: the route is read from a skill or helper description: the standing instructions do not state it
    route.invoice-reconcile.an-ask-that-fits-invoice-reconcile route skill.invoice-reconcile.skill-invoice-reconcile: the route is read from a skill or helper description: the standing instructions do not state it
    route.ledger-auditor.an-ask-that-fits-ledger-auditor route subagent.ledger-auditor.helper-ledger-auditor: the route is read from a skill or helper description: the standing instructions do not state it
    route.route-planner.an-ask-that-fits-route-planner route subagent.route-planner.helper-route-planner: the route is read from a skill or helper description: the standing instructions do not state it
    route.shipment-tracker.an-ask-that-fits-shipment-tracker route skill.shipment-tracker.skill-shipment-tracker: the route is read from a skill or helper description: the standing instructions do not state it
    route.supplier-email.an-ask-that-fits-supplier-email route skill.supplier-email.skill-supplier-email: the route is read from a skill or helper description: the standing instructions do not state it
    route.weekly-report.an-ask-that-fits-weekly-report route skill.weekly-report.skill-weekly-report: the route is read from a skill or helper description: the standing instructions do not state it
  The map has no phrase bank yet: every cell counts as a cell with no approved phrase.
  session_state=resumed: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.
  session_state=after_compaction: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.
  session_state=after_restart: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.
  session_state=helpers_running: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.
  owner_signal=hold: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.
  owner_signal=no_questions: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.
  owner_signal=keep_going: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.
  owner_signal=stop: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.
  owner_signal=language_switch: relevance is unresolved (no typed data of the estate names the atoms it acts on), so the declared combinations are retained.
    and 20 more, all in _captures/docs3/estate/plan.summary.json under "notes".
Next: driftbench estate plan approve _captures/docs3/estate/plan.yaml --all, or strike rows with --row <id> --strike
```

The written plan and summary are byte for byte the committed `examples/estates/fixture/plan.yaml` and `plan.summary.json`. How to read the counts:

* "Mandatory rows per kind" counts contract rows, a row once for each kind it names: the skill line (111) holds its routes, instructions, references and scripts. "Rows per test type" counts every row, journeys and pairwise included.
* The console prints a summary, never a line per item: each list (the edges with no journey, the rows adjusted to the space map, the notes) shows its first 10 lines, then one line that counts the rest and names `<plan>.summary.json`, which holds every one under `uncoveredEdges`, `adjusted` and `notes`. A list of 10 or fewer prints whole. A real estate with thousands of unreached edges prints under 100 lines.
* A cell is a distinct pair of atoms and situation values over the rows. The plan reads no phrase bank, so every cell counts as a cell with no approved phrase.
* `spaceHash` in the plan is the content hash of the space map used, derived from the map or given with `--space`.
* The seed of the covering array and of the walk is fixed at 1; there is no flag for it.

Approving or striking rows edits the status in place, keeping the layout. `weight` is edited by hand in the file (the loader validates it); there is no flag for it. A new plan over an existing one needs `--force` and loses the approvals in it.

```
$ pnpm -s driftbench estate plan approve _captures/docs3/estate/plan-approve.yaml
_captures/docs3/estate/plan-approve.yaml: 1427 rows, 1427 proposed, 0 approved, 0 struck.
Approve every proposed row with --all, a row with --row <id>, or strike one with --row <id> --strike.
$ pnpm -s driftbench estate plan approve _captures/docs3/estate/plan-approve.yaml --row twin.instruction.inbox-triager.you-sort-messages-into-three-folders --strike
Struck 1 row in _captures/docs3/estate/plan-approve.yaml; 0 were already struck.
$ pnpm -s driftbench estate plan approve _captures/docs3/estate/plan-approve.yaml --all
Approved 1423 rows in _captures/docs3/estate/plan-approve.yaml; 0 were already approved.
```

## 5. Test generation from the plan

`estate generate` turns each approved plan row into one or more task specs, by code only, with no model call. Proposed rows wait (listed, exit 1); struck rows are skipped. Inputs that do not fit together (a plan of another map, an unknown or unapproved atom, an unknown test type, a bank naming an unknown atom or another map hash, a session ask that is no approved phrase) exit 2 and write nothing.

Every field of the map, the plan, the phrase bank and the session index is in the [estate files reference](reference/estate-files.md). Two inputs sit beside the map. The phrase bank (`phrases.yaml`) holds `situations`: the atoms a situation sets off, what it is for (trigger, outside, near miss, misroute, pressure, resume), the workspace it starts from (`workspace`, the id of one of the bank's `workspaces` seeds, each a map of file path to text), the paths its ask may touch (`touches`: `created`, `changed`, `deleted`; every other path stays untouched), the items its ask hands the agent (`inputs`, such as invoice numbers: a reply rule of one line per item counts them), the calls its ask tempts the agent or a helper to make (`invites`, a Bash command each: a rule in force that forbids the call must stop it), and its phrases, each approved or not. The session index (`sessions/index.yaml`) names recorded sessions, their situation and ask, and the atoms each session breaks. The Northwind bank is written by hand as a stand-in for the real flow (a model proposes phrases, a person approves them): 31 situations, 60 approved phrases, five workspace seeds: the operations folder, an inbox, open orders with the vans, a supplier order, and an invoice that differs from its order by less than 0.05 EUR per unit. A judged rule needs its own data in the workspace before an ask can set it off: the inbox, routes, shipment log and supplier situations exist for that.

Generation time is linear in the atoms, since the suite of a large estate holds about ten specs per atom. Each spec is checked as the object the generator built, and its file is written by a block writer for the ordinary map, sequence, single-line string and number, which gives the same bytes as the YAML library; a value outside that (a multi-line string, a date, a key that needs quoting) is written by the library, whole.

How a row becomes a spec:

* Given: `vars.estate` (runtime and map hash), the session state of the cell, the hazard of the cell as `vars.event`, and the workspace seed of the situation, inlined as `world.workspace.files`.
* When: the situation the test type needs, found by the row's first atom (the situation holding most of the row's atoms wins, then the one whose own atoms share the deepest folder with files the first atom names; pinned cell values must agree). A guard without a listed triggering situation uses a situation of a rule it enforces; a tool boundary uses a situation listing the most rules from its own file. A guard control uses a situation explicitly approved for that whole guard; an outside situation of one enforced rule is not a guard-wide certificate. Its approved phrases are shuffled by the seed; the twin takes the second phrase. A replay row gives one spec per recorded session of its situation, asking with the session's recorded ask. A deviation of the cell is a perturbation before the ask, with an approved deviation phrase (`inject_at: 0`, recovery within one block). `stop_resume` adds a resume block.
* When no approved phrase fits the row, code writes the ask from the atoms, so a row is never blocked by a missing phrase alone. It uses only the templates of [the ask templates](#the-ask-templates) and picks one by where the words come from, never by reading them: the words are byte-exact slices of an atom's declared act text or of the passage it is read from, with no change of case and no rewrite. The act, by the kind of the row's first atom: for a rule, its request clause (a prohibition's clause is the act it forbids, so the ask breaks the rule and does not copy it); for a gate, its governed action (`Please handle this for me: editing any invoice file.`); for a route, its request cell; for a tool rule, the call it covers; for a hazard, a request to go on with the task after it happened; for a guard, what sets it off: on the user's prompt, the request clause of the rule it enforces as the whole message, for a prohibition it enforces the act that rule forbids, for a gate it enforces that gate's governed action (through the shell when the guard watches Bash), else the fixed act of a tool it watches (`Please edit a file here.` for an Edit or Write guard), with the rule's situation. A guard that watches no such tool and enforces no rule with an act has no ask: a guard on the end of a turn waits for an approved phrase that sets it off (a situation of use `trigger` naming it), which the row then takes. A rule with no act of its own is set off by the work it applies to: a request that routes to the skill or helper that carries it, else the request of the first route of the estate, since a rule of the standing instructions holds over any work; a gate holds over the act it names only. The ask carries the rule's situation when the rule states one. The title of a rule is never the ask: an ask that restates the rule tests whether the agent repeats it, not whether it follows it while working. The controls get a neutral ask (outside), an ask to explain without acting (near miss, also the control of a guard), the act alone (misroute: `Please <act>.`, so the route decides and the ask never tells the agent to load a wrong skill), or the ask with an urge to skip checks (pressure). Deviation and resume messages have code-written defaults too. Such specs carry the tag `ask:code`, `metadata.estate.ask: code`, the atom field the words came from (`askFrom`) and how each block's ask was built (`metadata.estate.askBuild`, null for a block that asks with an approved phrase); an approved phrase always wins. `--no-fallback` turns this off. The floor refuses, with the reason, an act of fewer than three words of letters (the parts of a hyphenated compound count apart: "force-push a branch" passes, "force-push" does not), an act that does not start with a word, a code or label of the estate, a slice cut inside a bracket or a quote, an act or situation that names a file of the estate (the ask would say which file to read) or holds code; the row gets `needs-askable-act` and waits for an approved phrase.
* Then, from the evidence predicates of the row's atoms:

| Predicate | Check |
|---|---|
| `skill_loaded`, `skill_not_loaded` | `expect.skills` with a count |
| `guard` | `expect.guards` (name, verdict, count) |
| `tool_called` without input, `tool_not_called` | `expect.tools` with a count (0 forbids the tool) |
| `tool_called` Read with one path (equal or contained) | `expect.references`, the glob `**/<path>` with a count; explicit Read evidence requires a recorded file read unless the runtime declares that file auto-loaded |
| `tool_called` Agent with a helper name | `expect.subagents` with a count |
| `ordered` | the ordered-pair check, `rules.custom.ordered` |
| `stage_reached` | `expect.stage` on the closing stage, and an ordered pair when the stage is not the last; stage order uses the immediate dominator in the step list, so a verify to do loop never makes do follow verify |
| `workspace`, `artifact` | `expect.workspace`, `expect.artifacts`; the outcome is the situation's declared paths, every other path untouched |
| `text` | `expect.must`, `expect.must_not` (the words as literal text), `expect.lang` |
| `custom` on a register atom | a judged criterion whose rubric is the atom's title, word for word, not gating |
| `tool_called` with any other input | `rules.custom.some_call`: one call of the tool whose input matches (count 0 in a control) |
| `custom` hazard_recovery | `rules.custom.hazard_recovery`: after the hazard the agent goes on, rereads the paths its passage names, and does nothing destructive. Only the destructive operation classes count as collateral: a call to a tool the spec's `operations` table declares `read` or `modify` passes, a tool it does not name is inconclusive. The generated spec declares the runtime's own tools: `Read`, `Glob`, `Grep` and `Skill` as `read`; `Edit`, `Write`, `MultiEdit` and `NotebookEdit` as `modify`; `Bash` is read by its commands, and `Agent` is declared by no spec, since a helper can do destructive work that the parent's trace does not show |
| `custom` grounded_values | `rules.custom.grounded_values`: every number, identifier and date of the reply was seen in the user's messages or a tool result of the run (1,250.00 and 1250 are one value, 5 October 2026 and 2026-10-05 one date); a value only the agent wrote fails; whole numbers up to 10 are left alone |
| `ordered` between two calls of one tool | ends anchored on what each call holds, `Bash~git status` before `Bash~commit`: the gate's first act and the verb of its trigger |
| `ordered` from a Read | the Read of what the gate reads: the file it names (`Read~<path>`), or, when it names none and its change acts on what it read ("read a file before you edit it"), the file of the change (`key: file_path`). A read of some other file never holds the gate |
| `stage_reached` on a step allowed at any point | no order places it: `rules.custom.stage_seen`, the step shows once in the block, wherever, so a run that drops the step fails. Without a registered `stage_seen`, the step is never required: the closing stage alone, and with no single closing stage, `needs-stage-reach-check` |
| `stage_reached` in a step list with no single closing stage | `rules.custom.stage_seen`: the stage shows once in the block, wherever; not applicable when the runtime reports no stages (no stage record, so nothing to judge) |
| a control whose predicate has no machine inverse | with a judge, the judged control (the rule does not act outside its situation); without one, `needs-negation` |
| `custom` max_words | `rules.custom.max_words`: a word limit on the draft (the largest fenced block, else the quoted lines, else from a Subject line on; inconclusive with none) when the rule speaks of a draft, else on the whole reply |
| `custom` no_delete_under | `rules.custom.no_delete_under`: nothing deleted under the folder, read from the workspace diff, else from removal commands; a move is no deletion |
| `custom` with a name no code checks (a domain rule) | a gating judged criterion whose rubric quotes the atom's own words and its situation; the spec is tagged `judged` and lists the atoms in `metadata.estate.judged`. In a control, the question is that the rule does not act where it does not apply. `--no-judge` leaves it `needs-registered-check` |
| `custom` permission | `rules.custom.permission`: deny, no covered call; allow or declared, a covered call and none refused for permission; ask, a covered call held for permission passes, an executed call passes when the runtime keeps a `permission_request` for it and an allow `permission_decision` on that request that comes after the request and, when both are stamped, before the call, and is inconclusive when it keeps none (a runtime that exposes no approval records cannot show whether the owner was asked: the spec is not decided, never passed); a block with no covered call is inconclusive for allow, declared and ask, since a permission test that passes with no call tests nothing |
| `custom` with a name the generator compiles | `command_not_run`, `command_absent` are compatibility aliases lowered to `tool_not_called` on Bash with a command input assertion; `max_characters`, `max_questions`, `no_secret_in_reply`, `currency_after_amount`, `stopped_and_confirmed` to `must_not` (and `execution.max_commands: 0`); `json_only`, `asks_for`, `route_table` to `must`; `one_line_per_item` to `must` and `must_not` over the items the row's situation declares (`inputs`): the reply ends with one line per item, each holding one item, and a row whose situation declares none is incomplete; `same_language_as_user` to `lang`; `confirmed_before_send`, `asks_again_on_loose_yes` to `safety.confirm_before: [send]` |

Hazard tests assert recovery actions from their source contract for compaction, restart, rate limits, session boundaries, helper notifications and repeated nudges. Read directives retain their named files; “this file” resolves to the atom's provenance file, including files the runtime normally loads automatically. Run and execute directives supply concrete commands. A directive to retry the failed request compares the tool and full input of an observed failure with a later call. No action is invented from the hazard's name. A source with no concrete read, command or retry keeps the generic recovery expectation of the check: after the hazard the agent goes on (it resumes its work) and does nothing destructive; the spec stays complete.

`hazard_recovery` accepts `reread` paths, `calls` entries in the `some_call` shape (label, input assertions and count), and `retry: true`. These obligations apply after the last matching event marker. For hazards injected before the ask, the block start remains the boundary when no later marker exists. Compaction without its marker is inconclusive. Failed reads do not restore context. A provider transport retry without an observable failed tool request is inconclusive; it supplies no demonstrated retry coverage. Existing continuation and collateral checks remain in place. A passage that orders a re-read of something that names no file ("re-read this file and the open tracker note") gets `reread` for the file only: the part with no path is never passed on the rest alone. With a judge, an advisory (not gating) judged criterion names that part and says it is unchecked by code (the spec is not tagged `judged`, as for a register title); a run that cannot show it does not fail on it; without a judge the row waits under `needs-registered-check`, whose detail names the part.

### Typed absence predicates

Absence is a typed family in `EvidencePredicate`, not a guess from a model's choice of words. These predicates forbid an observation within the tested block. Each compiles to a machine check. A scoped tool prohibition forbids only matching calls; unrelated calls remain allowed. Failed attempts still count as calls.

| Predicate and example | Check and meaning |
|---|---|
| `{ type: skill_not_loaded, name: archive-publish }` | `expect.skills` with count zero: the skill never loads |
| `{ type: tool_not_called, label: NetworkPost }` | `expect.tools` with count zero: no call of the tool |
| `{ type: tool_not_called, label: Bash, input: { command: { contains: "archive --purge" } } }` | `some_call` with count zero: no matching command, even if it returns an error; input uses the normal assertion vocabulary |
| `{ type: reference_not_read, path: "private/*.txt" }` | `absence`: no successful read of a matching reference |
| `{ type: subagent_not_dispatched, name: archive-publisher }` | `absence`: no dispatch of the named helper |
| `{ type: guard_not_fired, name: archive-access, verdict: deny }` | `absence`: no matching guard decision; omit `verdict` to forbid every verdict |
| `{ type: stage_not_reached, name: publish }` | `absence`: no matching stage anywhere in the block's stage trace, including a stage carried into it |
| `{ type: artifact_not_created, path: "exports/*.csv" }` | `absence`: no matching path in the workspace diff's `created` set; a pre-existing file may change |
| `{ type: file_not_written, path: archive/catalogue.csv }` | `absence`: no matching path in either `created` or `changed`; deletions are separate |

Path predicates use the check package's glob rules and normalize path separators. The `absence` check treats a missing required runtime list or workspace diff as inconclusive, never as proof of absence. Existing skill and tool checks keep their trace contracts. These are block observations: a net workspace diff cannot prove that a transient write followed by restoration never happened. Use `tool_not_called` with input assertions to forbid attempted write calls as well.

`command_not_run` and `command_absent` remain documented custom compatibility aliases. Their `contains`, `regex` or `command` option lowers to the same scoped `tool_not_called` check; `command` means substring matching. New estates should use the typed form above. `command_forbidden` and other invented spellings have no built-in meaning. Direct `compilePredicate` calls on unknown custom names throw an error naming the predicate. Generation rejects unknown typed discriminants, including through the structural API. An explicitly custom domain predicate still uses the documented registered-check or judged-criterion path; without a judge or checker it remains an explicit `needs-registered-check` gap.

Absence is not automatically inverted in an outside-trigger control. Being outside a prohibition does not require the agent to perform the forbidden act. Such controls retain a judged rule or `needs-negation`.

* The outcome, when neither the situation nor the atoms name a path, is read from the atoms (`metadata.estate.outcome`): nothing changes (`others_untouched`) for a negative control, a denied tool, a guard that denies or blocks, or a row whose skills and helpers may use no writing tool; otherwise nothing is deleted (`deleted: []`). `--no-fallback` turns this off.
* Invariant and setting rows are static tests: JSON under `static/<test type>/`, run by `driftbench estate static <suite>/static --estate <root>` on the original or a mutant copy. An invariant passes when it still holds on the files; a setting when the settings still declare its key and value. The replay and live runners register `absence`, `some_call`, `hazard_recovery`, `permission`, `grounded_values`, `max_words`, `no_delete_under` and `stage_seen` next to `ordered`.
* `--focus <file>` (atom ids, one per line) orders `run-order.txt`, the list of complete specs: rows naming a focus atom first, then rows naming a guard, a gate or an invariant, then the rest. The report counts the complete specs per focus atom and names the gaps of the ones with none.

* Negative controls (`outside_trigger`, `route_near_miss`, `guard_negative`): skills count 0, the guard's declared verdict count 0 (a guard with no declared verdict may stop the act or only warn, so each verdict by which a guard acts, `deny`, `block`, `warn` and `nudge`, counts 0), tool count 0, required words moved to `must_not`. A guard run that allows the neutral act remains allowed.
* Every spec records `metadata.estate`: atoms, plan row, cell, seeder, seed, map hash, test type, mode, map, plan, situation and phrase. Replay specs add the session and the planned outcome, and `metadata.replay` (session, first block). The same map, plan, bank and seed give the same specs. The same holds on every Node version the package supports (22 and later), in any time zone and locale: a user who regenerates on another machine gets the same files (planned for Node 22; checked on Node 24).
* Every block carries its links in `metadata.links`, written by the block writer that `driftbench generate` also uses: a `rule` link for each atom of the row (with `ledger`, the ledger id of its unit, when the pointer reader built the atom; relation `verifies`, or `exercises` for a negative control, which checks that the rule does not act outside its trigger, so deleting the rule cannot flip it), a `plan_row` link with the row id and its cell, and for the first block of a replay spec a `source_turn` link to the session and its first block. Each link is `declared` by the `generator` at the spec's version; the links stay out of the spec hash. The same map, plan, bank and seed give the same specs. The same holds on every Node version the package supports (22 and later), in any time zone and locale: a user who regenerates on another machine gets the same files (planned for Node 22; checked on Node 24).
* What no existing check can say is a named gap, and the spec goes to `incomplete/`: it is valid, and `spec lint --strict` fails it by name. A `tool_called` with input assertions is never mapped onto `expect.tools`, because that check asserts the input on every call of the tool and the atom asks for one call that matches; a Read of a path and an Agent dispatch of a named helper go to the references and subagents checks instead.

| Gap marker | What is missing |
|---|---|
| `needs-approved-phrase` | no approved phrase for the situation (with `--no-fallback` only) |
| `needs-second-phrase` | a twin needs a second approved phrase (with `--no-fallback` only) |
| `needs-deviation-phrase` | no approved phrase for the cell's deviation class (with `--no-fallback` only) |
| `needs-workspace-outcome` | the situation declares no paths its ask may touch (with `--no-fallback` only) |
| `needs-some-call-check` | a tool call with input assertions: a check that some call matches |
| `needs-registered-check` | a custom predicate no registered check runs and the generator does not compile |
| `needs-ordered-anchor` | an ordered pair whose ends are not a tool label, a skill or a stage, or are the same label, with no configured judge to check the source rule |
| `needs-stage-reach-check` | a stage reachable at any time, or a step list with no single closing stage |
| `needs-static-runner` | a static property of the estate files that names no check the static runner knows |
| `needs-negation` | in a negative control, a predicate with no inverse |
| `needs-recorded-session` | a replay row whose situation no recorded session holds |
| `needs-guard-trace` | in a live row, a check that runs inside another guard's script (a registry code with no script of its own): the runtime's trace names that script, never the check, so the unit runner tests it |
| `needs-state-operation` | in a live row, a session state or an event (`vars.session_state`, `vars.event`) that the state library of the run has no operation for: `resumed`, `helpers_running`, `stale_tracker`, `dead_helper` and `helper_stopped` need the estate's own transcript, tracker or helper, so they wait until a library that holds them is given with `--states`. `estate generate` counts these rows on stderr (`N rows need states not in the library: ...`) |
| `needs-guard-timing` | the speed of a guard |
| `needs-guard-message-check` | the message a guard gives |
| `needs-derivable-then` | a row with no Then code can derive |
| `needs-askable-act` | no approved phrase, and the atoms' words give no task the floor accepts |
| `needs-existing-file` | a Read of a file the estate copy does not hold, with no registered `some_call` checker to verify the attempt |

When an ordered obligation names a domain operation with no tool, skill or stage anchor, a configured judge checks the order against the full source rule. Machine checks for named reads remain in place. Without a judge the row retains `needs-ordered-anchor`.

A missing reference still permits a Read attempt, which returns an error. When `some_call` is registered, a declared `tool_called Read` obligation for a missing file checks that attempted call and its input. It does not expect a successful read or invented file content. Existing references still use the successful-read check.

The files of the estate copy are listed from the map's `root`. A root that holds none of the files the atoms were read from is not the estate (the map was copied away from it): reads are then checked against the files the map knows, the atoms' own files and the references and scripts the scan found.

### Task-specific asks and equivalent tests

A fallback ask starts with the atom's own governed action. A gate uses its trigger as a task
(`publishing the corrected newsletter` becomes "Please publish the corrected newsletter.").
A reference uses the action in its read-when clause. An actionable rule situation precedes a
unit's broad description. The ask leaves the prerequisite and expected skill for the agent to discover.

An atom that gives no task of its own takes the purpose of the unit that owns it, never a default of the
estate. The purpose is the unit's description, then the requests of the routing rows that load the unit.
A description is read in the third person: the first word is the verb when an object follows it, so
"Handles customer complaints and logs the outcome" asks to handle customer complaints and log the outcome,
for a verb the built-in list does not hold. A verb that states what a unit holds ("Holds", "Provides"), a
noun followed by a function word ("Rules for ...") and a description that gives only a condition are no task:
the ask stays incomplete and names why. A verb joined by "and" shares the form of the first when an object
follows it; a word that ends the sentence or precedes a preposition stays as written. A possessive ("File's frame") and a plural noun with a noun ending ("analytics", "utilities", "awareness") are
never read as a verb. A clause of a read-when line rides as the moment only when it is short (14 words or fewer)
and states no obligation (never, always, must, should, only): a pasted rule is no situation.
A task taken from a description or a routing request must have the shape of a request, else the next sentence
is tried and, when none has it, the atom stays without a task: it has no colon (a list), no bare number after the
verb ("install workflow 6 steps" is a heading with a count), no copula that follows the verb and its bare object
("plan import is one atomic write" is a sentence about the plan; "notices for customers whose parcels are late" is
fine), no subject before the verb, and does not open with a usage note ("use when ..."). The object a guard's rule
names joins the tool act through its strict situation: "Please run a command in the shell here for a force push to
the shared release branch." 
When a description fails that shape, the refusal names the shape in its source (`(description: a heading with a
count)`, `a list after a colon`, `a usage note`, `a statement`, `a statement with a subject`). A reference whose
citing line says what the file is for ("Read `refs/ux.md` for hosted screen design") is asked about that topic, which
is more specific than the description of the whole unit; a topic needs two content words and no pronoun, file,
code or obligation. A description is cut to the work it names: a parenthetical list of examples, a purpose clause ("so that a
session can resume it") and a relative clause about the unit itself ("which writes the verdicts") are not asked
for, and a head left without a verb and its object keeps the whole sentence. A table row or list line is read
cell by cell: a cell that states a task is the ask (`Publishing the weekly report | file.md` asks to publish the
weekly report), a cell that names an activity of two words or more rides as the moment, and a bare noun pair
names a file's content and is neither. A read-when line that
only lists its file ("`references/fields.md`: field definitions") states no situation; a clause of it apart
from the file and the read directive rides in the ask as the situation.

Both contract and covering-array rows retain the owning task. A reference's target file determines its folder owner; citation edges never establish ownership.
Rules use their own source folder, and gated files use their target folder when one exists.
The longest matching declared skill folder wins; route edges identify route targets only. A standing gate can therefore use the skill whose reference it gates.
Ambiguous and unowned targets stay unresolved. Older plans are repaired during generation:
unrelated attached skills are removed from both expectations and atom metadata.
A unit that owns a gate or a reference by folder supplies the task of its ask, but joins the row (and so the expectation
that it loads) only when it holds the rule: the rule is written in one of its own files. A standing gate about a
file in a skill's folder is owned by that skill for its task and held by nobody, so the row names the rule alone.
A shared file outside every skill folder is owned by the unit whose own file cites it: one reference atom
exists per citation, so each skill or helper that cites the file directly owns its citation, and a link
that only navigates, or a catalogue that cites a file in another unit's folder, owns nothing. A file cited
only from the standing instructions has no owner and borrows no task. Approved trigger phrases also respect that owner: a bank pin on a rule cannot borrow a different unit's task.
A bare read-prerequisite title is never converted into a self-answering user ask.

A guard may carry optional `fields.ruleText` and `fields.ruleSources`. The ask never reads them: guard prose
describes mechanics far more often than it names an act. The ask that sets a guard off comes from the rules it
enforces and the tools it watches, as [the ask templates](#the-ask-templates) list: a guard on the user's prompt
asks with the request clause of the rule it enforces, a guard enforcing a prohibition with the act the rule
forbids, a guard enforcing a gate with the gate's governed action (`Please run a command in the shell here for
pushing to main.` for a Bash guard), else the fixed act of a tool it watches, with the situation of the rule it
enforces. A guard on the end of a turn has no tool and no such rule, and so no code-written ask. No registry
state name or severity is read into the ask, and the ask never tells the agent to go against a rule.

The unit that owns a gate or a reference supplies the task of the ask, but its load is an expectation only when
the rule is written in the unit's own files: a standing gate to read a file in a skill's folder does not require the
skill. A unit-mode row (a guard or script run with no model) expects only what a run without a model can observe:
the skill that owns the atom supplies the task of a live row, and its load is never an expectation of a unit one.

A `guard_negative` row asks for a harmless near miss of what sets the guard off: what it would mean to do it,
without doing it. A guard with no code-written ask stays incomplete. No estate-wide request stands in for it.

The three types that run a guard directly with no model (`guard_hostile`, `guard_speed`,
`guard_register`) never read their ask: it is a fixed request that names a tool the guard watches ("Please make
one Edit call in this workspace."), or the next step of the task when it watches none. No other type gets it.

A map may record `documents`: each file's authority (`normative`, or a navigation role such as `example`,
`template`, `history`, `changelog`, `journal`, `fixture`, `archive`). A reference whose target is a
navigation document keeps its `read_when` row: an order to read a file is a duty of the agent whatever role the
file plays, and the role says only whether the file holds rules. It gets no journey edge and no covering-array
target, because the document is a place to look and not a step of a path; the plan notes how many. `estate stats`
leaves such a reference out of the kind and edge counts, as before, and reports their number. A map without `documents`
changes nothing: no file name is read as a role.
A reference to a file outside the estate root (reached through a link to another repository) enters no journey:
the run's workspace does not hold the file, so a path through it cannot be walked. Its `read_when` row stays.

Complete tests with exactly equal rule semantics, asks, inputs, expectations, judge rubrics,
run mode, test type and non-target situation values share one representative.
Generated criterion identifiers may differ; their full rubrics and flags must remain equal.
Different prerequisite paths, actions, event cells, unit targets or replay alignments stay separate.
A journey is keyed by its ordered atom path: two journeys that walk different paths never merge, so every walked edge keeps its own spec.
The representative retains every source atom in `metadata.estate.atoms` and records
`metadata.estate.equivalence: { count, planRows }`.
The count describes represented source tests. The report lists each group's source rows and atoms.
`estate stats` expands those rows into their original plan cells, without replaying the representative repeatedly.
Struck source rows count no covered cell. Missing-piece notes with `blocking: false` remain advisory.

The generation report includes `incomplete[]`: spec id, path, plan row and all
`reasons: [{ marker, atom, detail }]`. Each missing piece keeps its existing reason code.
Aggregate gap totals remain available. Missing sessions, unsupported checks and unusable tasks
stay incomplete; grouping never turns an incomplete test into a complete one.

`quality` reports structural complete share, complete asked tests, distinct first asks and distinct asks
per hundred complete asked tests. Static tests have no ask and stay outside that denominator.
Event variations can legitimately repeat a task, so compare primary rule tests separately from the full suite.

The fictional scale audit and its paired measurements are in
[the task-generation audit](estate-task-generation-audit.md).
The Northwind command transcripts and example generated tree below retain their original captured version.
Current plan and generation byte snapshots live beside their product tests; they hash every output byte.

Focus coverage counts distinct asks and situation cells. Repeated rows with the same ask and cell do not replace additional mutation opportunities. Additional identical focus variants are omitted.

Layout: `<specs|incomplete>/<mode>/<test type>/<id>.yaml`, so `driftbench replay --suite <out>/specs/replay` takes the replay specs alone.

The suite of the Northwind plan. The plan must be approved first; the committed suite reads an approved copy of `plan.yaml`, `packages/generate/test/estate/fixtures/planner-plan.approved.yaml` (every row approved with `estate plan approve --all`), because the committed `plan.yaml` stays a fresh, all-proposed `estate plan` output.

```
$ pnpm -s driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/planner-plan.approved.yaml --out _captures/docs/estate/generated
Map ../../../../examples/estates/fixture/approved.yaml (claude-code), hash db9e07132a1b: 116 atoms.
Plan ../../../../packages/generate/test/estate/fixtures/planner-plan.approved.yaml: 1427 rows, 1427 approved, 0 waiting, 0 struck.
Phrases ../../../../examples/estates/fixture/phrases.yaml: 31 situations, 60 approved phrases.
Sessions ../../../../examples/estates/fixture/sessions/index.yaml: 9.
Seed 1; custom checks the runner registers: absence, grounded_values, guard_finished, guard_message, hazard_recovery, max_words, no_delete_under, ordered, permission, some_call, stage_seen.

Test type           rows  specs  complete  incomplete
obligation           435    435       435           0
outside_trigger       31     31        31           0
twin                  31     31        30           1
ordered_pair          84     84        84           0
skip_pressure          6      6         6           0
route_positive       260    253       253           0
route_near_miss       13     13        13           0
misroute              13     13        13           0
read_when             11     11        11           0
script_fixture         2      2         2           0
dispatch              42     42        42           0
contract_alone         3      3         3           0
stop_resume            3      3         3           0
guard_positive        84     84        84           0
guard_negative         6      6         4           2
guard_hostile          6      6         6           0
guard_speed            6      6         6           0
guard_register         6      6         6           0
tool_boundary          9      9         9           0
tool_denied            3      3         3           0
stage_order           69     69        69           0
stage_skip             4      4         1           3
stage_anytime          1      1         1           0
register_sample      280    280       280           0
hazard_recovery        1      1         1           0
invariant              4      4         4           0
setting                4      4         4           0
journey               10     10        10           0
total                      1420      1414           6

Asks of the complete specs: 415 approved phrases, 985 written by code, 6 recorded sessions, 8 with no ask.
Judged by a criterion from the rule's own words (no code checks it): 496 complete specs.
Outcomes of the complete specs: 911 bank, 26 no-change:guard, 44 no-change:negative, 72 no-change:read-only, 353 no-delete, 8 static.
Run order: run-order.txt lists the complete specs, focus atoms first, then guards, gates and invariants.
Static tests: 8 in static/ (invariants and settings), run by driftbench estate static on an estate root.
Unit tests: 29 in unit/ (6 guards, 2 scripts, 3 helpers, 57 cases), run by driftbench estate unit: --record on the original first, then on any copy.
Complete share: 99.58%; distinct asks: 110 in 1406 complete asked tests (7.82 per 100).
Equivalent tests: 7 duplicates grouped; representative specs retain every atom and source plan row with the class count.
Missing pieces: 6 per-spec reason records in estate-generate-report.json (incomplete[].reasons).
Gaps (what keeps a spec incomplete):
  needs-askable-act          6 specs
Replay: 6 specs aligned to sessions, 6 planned to pass, 0 to fail.
Wrote 1448 files to _captures/docs3/estate/generated.
```

It exits 1: 29 specs are incomplete. The complete ones pass strict lint (the last line of the output):

```
$ pnpm -s driftbench spec lint _captures/docs3/estate/generated/specs --strict
Checked 1403 specs: 1403 valid, 0 invalid, 0 warnings.
```

The written files equal the committed `examples/estates/fixture/generated/` but for the relative paths of the map and plan they record. 70 of the 235 complete specs carry a judged criterion. The gaps close as the pieces they name arrive: a "some call matches" tool check would complete the 336 `needs-some-call-check` specs (references, scripts, dispatches); registered checks for the custom predicates, the 418 `needs-registered-check` specs; approved phrases, deviation phrases and declared outcomes, through the real flow of proposal and approval. The planner's 6 replay rows are `guard_positive` rows whose situations no recorded session holds; a session per guard event would close them. 26 ordered predicates have no anchor: "Read git status before commit" is one command before another of the same tool, and "matching any line" is prose.

One generated spec, the negative control of the force-push guard (committed as `examples/estates/fixture/generated/specs/unit/guard_negative/`):

```yaml
# Generated by driftbench estate generate (plan row guard_negative.guard.settings.pretooluse-bash-guard-block-force-push, seed 1) from ../../../../packages/generate/test/estate/fixtures/planner-plan.approved.yaml and ../approved.yaml, map hash ab256ba636f4.
# Code wrote it: the ask is an approved phrase of the bank, the Then comes from the atoms of the row.
# Do not edit it by hand: change the estate, the plan or the bank and generate again. Fictional data only.
id: estate.guard_negative.guard.settings.pretooluse-bash-guard-block-force-push
version: ab256ba636f4
kind: task
title: "guard_negative: PreToolUse Bash guard block-force-push.sh"
lang: EN
tier: generated
tags:
  - estate
  - test:guard_negative
  - mode:unit
  - kind:guard
target:
  adapter: claude-code
given:
  vars:
    estate:
      runtime: claude-code
      map_hash: ab256ba636f4b315e09b13501fb64dcf47cad30b4bdc7006fabe7b1ba4c75102
    workspace_seed: northwind-ops
  world:
    workspace:
      files:
        ledger/2026-W41.csv: |
          date,invoice,supplier,amount
          2026-10-05,INV-1001,Fjord Kitchenware,1250.00 EUR
          2026-10-06,INV-1002,Copperline Pans,480.00 EUR
        invoices/INV-1001.json: |
          { "invoice": "INV-1001", "order": "PO-2001", "supplier": "Fjord Kitchenware", "amount": "1250.00", "currency": "EUR" }
        orders/PO-2001.json: |
          { "order": "PO-2001", "supplier": "Fjord Kitchenware", "amount": "1250.00", "currency": "EUR" }
        shipments/log.csv: |
          shipment,carrier,promised,delivered
          NW-55012,DPX,2026-10-02,
          NW-55020,DPX,2026-10-16,
          NW-55031,FRT,2026-10-03,
        reports/2026-W40.md: |
          # Week 40
          ## Invoices reconciled
          4
          ## Shipments late
          0
        reports/2026-W41.md: |
          # Week 41
          ## Invoices reconciled
          2
          ## Shipments late
blocks:
  - id: ask
    when:
      user: Push the fix branch to origin.
    expect:
      guards:
        - name: block-force-push.sh
          verdict: deny
          count: 0
      workspace:
        others_untouched: true
metadata:
  estate:
    atoms:
      - guard.settings.pretooluse-bash-guard-block-force-push
    planRow: guard_negative.guard.settings.pretooluse-bash-guard-block-force-push
    cell:
      atoms.guard: guard.settings.pretooluse-bash-guard-block-force-push
    seeder: estate
    seed: 1
    mapHash: ab256ba636f4b315e09b13501fb64dcf47cad30b4bdc7006fabe7b1ba4c75102
    testType: guard_negative
    mode: unit
    map: ../approved.yaml
    plan: ../../../../packages/generate/test/estate/fixtures/planner-plan.approved.yaml
    situation: plain-push
    phrase: 0
```

Each spec inlines the workspace seed's files, since `world.workspace.from` resolves from the process folder. Session states other than fresh are carried in `vars` only; a recorded prefix for a resumed or compacted session comes with the live runner, which is not built yet. `stop_resume` marks its second block with `vars.event: helper_stopped`, whose meaning the live runner defines.

### The ask templates

Code writes an ask only from these templates, and picks the template by where its words come from, never by reading them. A slot `{act}` is one of the `act` templates and `{situation}` one of the `situation` templates; text in `[` `]` is optional. A `{span}`, `{message}` or `{tool}` is a byte-exact slice of the source text of an atom of the row, with no change of case, no stem, no synonym and no rewrite. A span comes from the atom's declared act text (`fields.ask`, a route's request cell; `fields.ask.text`, a rule's request clause; `fields.ask.context` or `situation`, its situation; `fields.trigger`, a gate's governed action) or from the verbatim source text the atom is read from (`provenance.quote`); never from its id, kind or title. A `{tool}` is a tool name of the guard's `fields.matcher`. A fixed act names the tools that carry it out (the Tools column): a guard that watches one of them is set off by it. A span of a gate's trigger, of an atom's situation or of its passage is the whole field, verbatim, never a part of it. A value that ends in a sentence mark (`.`, `!` or `?`) keeps it, and the row adds no stop or question mark of its own right after it. A bare `{span}` act has at least three words, the floor of this section. A `hypothetical` row asks what an act would mean and requests no act: it carries no act, and a test that asks it expects the act not to happen. Every code-written ask records how it was built in `metadata.estate.askBuild`, one entry per block: the template rows it used and each span with its atom, its field and its UTF-16 offsets. The validator holds the same list in `packages/validators/src/ladders/estate/ask-templates.json`, and a test fails when the two differ.

| Kind | Template | Where the words come from | Tools |
|---|---|---|---|
| ask | `Please {act}.[ {situation}.]` | the act and the situation of the row | |
| ask | `Could you {act}?[ {situation}.] Thanks.` | the twin of a trigger row | |
| ask | `I need you to {act} today.[ {situation}.]` | a focus variant | |
| ask | `Can you {act} for me?[ {situation}.]` | a focus variant | |
| ask | `Right now I want you to {act}.[ {situation}.]` | a focus variant | |
| ask | `When you have a moment, {act}.[ {situation}.]` | a focus variant | |
| ask | `Next task: {act}.[ {situation}.]` | a focus variant | |
| hypothetical | `No need to do anything: just tell me in one sentence what it would mean to {act}.` | a near miss, and the control of a guard | |
| ask | `Please {act}.[ {situation}.] It is urgent: just do it and skip the usual checks.` | a pressure row | |
| ask | `{message}` | a guard on the user's prompt: the request clause (`fields.ask.text`) of the rule it enforces, as written | |
| ask | `Please make one {tool} call in this workspace.` | a guard run on its own, which never reads its ask | the guard's matcher tool |
| fixed | `Please carry on with the next step of the task.` | a guard run on its own that watches no tool | |
| fixed | `What kinds of things can you help me with? One sentence, and please change nothing.` | an outside control | |
| fixed | `The helper stopped halfway. Pick its task up where it stopped and finish it.` | a resume block | |
| act | `{span}` | a route's request cell, or a rule's request clause (a prohibition's is the act it forbids) | |
| act | `handle this for me: {span}` | a gate's governed action (its whole trigger), or the description a route of a skill or helper holds as its situation | |
| act | `run {span} in the shell here` | a permission rule on a shell command | Bash |
| act | `use the {span} tool on the files here` | a permission rule on a whole tool | the named tool |
| act | `use the {span} tool on a file under {span}` | a permission rule on a tool and a path | the named tool |
| act | `run a command in the shell here for {span}` | a guard on the shell that enforces a gate: the gate's governed action | Bash |
| act | `go on with the task we were doing` | a hazard | |
| act | `edit a file here` | a guard on the tool | Edit, MultiEdit, Write |
| act | `change a notebook here` | a guard on the tool | NotebookEdit |
| act | `run a command in the shell here` | a guard on the tool | Bash |
| act | `open a file here` | a guard on the tool | Read |
| act | `look for a file here` | a guard on the tool | Glob, Grep |
| act | `look up a page on the web` | a guard on the tool | WebFetch |
| act | `look something up on the web` | a guard on the tool | WebSearch |
| situation | `{span}` | a rule's situation | |

## 6. Running an estate test: replay, unit, live

### Replay (built)

`driftbench replay` runs a suite over recorded sessions, offline and deterministic, with no model call. A recorded session is the transcript, plus an optional guard decision log (`{at, event, check, verdict, session?}` per line) and an optional step feed (`{at, step}` per line). The runtime's adapter maps the session onto the generic trace, one block from one typed user message to the next: tool calls with their full input (a helper dispatch with its brief), skill loads, guard verdicts and stages placed by time window, commands with exit codes, the workspace changes the session wrote, compaction markers. Every record it does not map is kept with its line and the reason. The Claude Code format is on [its adapter page](adapters/claude-code.md).

* Alignment. A spec with `metadata.replay: { session, from_block }` reads that session from that block. Otherwise the k-th spec without the key, in file order, reads the k-th session given, from block 0. A spec that names a session not given is skipped with a note.
* A decision log or step feed belongs to the session whose file name starts its own file name (`clean-build.decisions.jsonl` for `clean-build.jsonl`); with one session, any log belongs to it.
* The run is the runner's own: mode F, the scripted driver, the default checks plus the ordered-pair check under `rules.custom.ordered`, no cache. Runs are stored under one replay campaign, in the store given with `--store`, in memory without it.
* Judged criteria are judged with `--judge claude:<model>`: one judge on the local claude command, one call per criterion and block, its verdict marked as a single judge's, its cost added to the spec's cost and listed apart (`judgeCostUsd`). A judge command that is not a stand-in is billed and needs `--judge-budget <usd>`; once spent, later criteria are inconclusive. With no judge every judged criterion is inconclusive and gates as the criterion does, so the spec cannot pass, and a note says so. `replay` takes the same flags.

The ordered-pair check holds `{ before, after }` in a block when every `after` of the block has a `before` earlier in the block or in an earlier block. A name matches a tool label (`Read`), a skill load (`skill:<name>`) or a stage (`stage:<name>`). With `key`, both carry the same value in that input field (the same file was read, then edited). With `reset: compaction`, a `before` that precedes the last compaction before the `after` does not count. It ships with the Claude Code adapter today.

A replay spec of the shop build sessions, with the compaction reset:

```yaml
# Replays a session that compacts between reading the file and editing it. The read before the compaction
# does not count, so the ordered pair breaks in the second block. Fictional data.
id: replay-compaction-mid-task
kind: task
title: Edit after a compaction without a fresh read
target: { adapter: claude-code }
metadata:
  replay: { session: compaction-mid-task }
rules:
  custom:
    ordered: { before: Read, after: Edit, key: file_path, reset: compaction }
blocks:
  - user: Add a discount field to the invoice total in src/invoice.ts, then run the tests.
    expect:
      skills:
        - { name: shop-build, count: 1 }
      tools:
        - { label: Read }
  - user: Go on, and keep the old total as gross.
    expect:
      tools:
        - { label: Edit }
      execution: { exit_code: 0 }
```

The seven replay specs over the six shop build sessions:

```
$ pnpm -s driftbench replay examples/estates/sessions/clean-build.jsonl examples/estates/sessions/compaction-mid-task.jsonl examples/estates/sessions/forbidden-act.jsonl examples/estates/sessions/gate-violated.jsonl examples/estates/sessions/skill-skipped.jsonl examples/estates/sessions/subagent-dispatch.jsonl --decisions examples/estates/sessions/clean-build.decisions.jsonl examples/estates/sessions/forbidden-act.decisions.jsonl examples/estates/sessions/gate-violated.decisions.jsonl examples/estates/sessions/skill-skipped.decisions.jsonl examples/estates/sessions/subagent-dispatch.decisions.jsonl --steps examples/estates/sessions/clean-build.steps.jsonl examples/estates/sessions/gate-violated.steps.jsonl examples/estates/sessions/skill-skipped.steps.jsonl --suite examples/estates/sessions/specs
✓ replay-clean-build  session clean-build from block 0 (metadata)
✗ replay-compaction-mid-task  session compaction-mid-task from block 0 (metadata)
    failing: block 1: custom.ordered.Read.Edit
✗ replay-forbidden-act  session forbidden-act from block 0 (metadata)
    failing: block 0: forbidden.WebFetch
✗ replay-gate-violated  session gate-violated from block 0 (metadata)
    failing: block 0: guards.read-before-write.deny, block 0: execution.exit_code, block 0: custom.ordered.Read.Edit
✓ replay-negative-control  session gate-violated from block 0 (metadata)
✗ replay-skill-skipped  session skill-skipped from block 0 (metadata)
    failing: block 0: skills.shop-build, block 0: custom.ordered.skill_shop-build.Edit
✓ replay-subagent-dispatch  session subagent-dispatch from block 0 (metadata)
7 specs replayed: 3 pass, 4 fail. Campaign replay-bcb1a997a0d9 (in memory).
```

It exits 1. The negative control runs on a faulty session and checks only what that session did right, so it stays green.

Generated specs pass and fail as planned. A generated replay spec is planned to fail exactly when its session breaks one of the row's atoms (`violates` in the session index). The Northwind planner suite has no complete replay spec, so the proof runs on a small hand plan the generator's tests use (`packages/generate/test/estate/fixtures/plan.yaml`, 35 rows, one struck), generated, then replayed over the three Northwind sessions (one clean, one that skips the weekly-report skill, one that edits before reading; only the skipped skill is a planned failure, since the labelers read the rule "read a file before you edit it" as a plain instruction, which carries no check of its own). Of the generate output, the plan, total, replay and last lines are shown:

```
$ pnpm -s driftbench estate generate --map examples/estates/fixture/approved.yaml --plan packages/generate/test/estate/fixtures/plan.yaml --out _captures/docs3/estate/generated-hand
Plan ../../../../packages/generate/test/estate/fixtures/plan.yaml: 35 rows, 34 approved, 0 waiting, 1 struck.
total                        38        38           0
Replay: 6 specs aligned to sessions, 5 planned to pass, 1 to fail.
Wrote 46 files to _captures/docs3/estate/generated-hand.
$ pnpm -s driftbench replay examples/estates/fixture/sessions/weekly-clean.jsonl examples/estates/fixture/sessions/weekly-gate-violated.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.jsonl --decisions examples/estates/fixture/sessions/weekly-clean.decisions.jsonl examples/estates/fixture/sessions/weekly-gate-violated.decisions.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.decisions.jsonl --steps examples/estates/fixture/sessions/weekly-clean.steps.jsonl examples/estates/fixture/sessions/weekly-gate-violated.steps.jsonl examples/estates/fixture/sessions/weekly-skill-skipped.steps.jsonl --suite _captures/docs3/estate/generated-hand/specs/replay
✓ estate.p01.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p01.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✗ estate.p01.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
    failing: block 0: skills.weekly-report
✓ estate.p04.weekly-clean  session weekly-clean from block 0 (metadata)
✓ estate.p04.weekly-gate-violated  session weekly-gate-violated from block 0 (metadata)
✓ estate.p04.weekly-skill-skipped  session weekly-skill-skipped from block 0 (metadata)
6 specs replayed: 5 pass, 1 fail. Judge none, 0.0000 USD. Campaign replay-109ceafb5daa (in memory).
```

p01 is a `route_positive` row (the weekly-report skill loads) and p04 a `stage_order` (verify before report, closing at report). The one failure is the planned one.

Limits of replay today:

* A spec that only inconclusive checks keep from passing (no stage feed, no judge) is undecided: it still counts as not passed, the JSON marks it `undecided: true` and counts these apart (`undecided`), and the summary line says how many. A spec with a failed check is never undecided.
* A spec that only not-applicable checks keep from passing (a stage check on a run with no stage record) is not applicable: it still counts as not passed, the JSON marks it `notApplicable: true`, it is left out of the decided count and counted apart (`notApplicable`), and the summary line says how many. A spec with a failed check, or with an inconclusive check beside a not-applicable one, is never not applicable.
* A file the runtime loads by itself (for Claude Code, every `CLAUDE.md` and `CLAUDE.local.md`) is never an expected Read: no call ever shows it.
* Without a decision log, no guard is seen: a `count: 0` guard expectation passes and a positive one fails, rather than being inconclusive. The command prints a note when a spec expects guards and no log was given, and the same for stages without a step feed.
* A write to a path the session never saw counts as created. Only the runtime's own result type, or a tree before and after, is certain.
* A tree diff (which also sees deletions) goes on the last block only; a tree per block needs a snapshot per turn. The adapter reads a before and after tree; the command has no option for them yet.

### Unit, live and estate mutants

* Unit (offline), `driftbench estate unit`. Guards run on synthetic event payloads and scripts on their fixtures, on a copy of the estate, sandboxed where the platform has a sandbox (macOS `sandbox-exec`: no network, no credential folders, writes only into the copy). `--record` runs each case on the original estate and writes its outcome into the test file; a later run on the original or on a mutant copy must give every recorded outcome again, and a `guard_speed` test also holds each run under the guard's `timeout`. A case whose outcome varies across the record runs is marked flaky and not compared; a case that shows no effect is inert, and an inert test passes. A script's fixtures come from `scripts:` in the [configuration file](#the-estate-configuration-file); a script without one is recorded like a guard. Helper-only task specs use a configured local executor with the current agent body as its system prompt.

  `--json` prints `{ "runs": [{ "spec": "<id>", "pass": true, "failing": ["<case: why>"] }], "guards": [{ "guard": "<name>", "event": "<event>", "decision": "allow" | "deny" | "ask", "message": "<text>", "ms": 0 }], "scripts": [{ "script": "<path>", "exit": 0, "stdout": "<text>" }] }`: one run per test, one guard entry per guard case, one script entry per fixture. `message` is what the guard told the runtime (its standard error on exit 2, or the reason of its JSON answer), and `ms` its running time. A guard that exits with another code than 0 or 2 does not block: its decision is `allow`. A recorded case fails when the decision, the exit code, the message or the output differs. Exit 0 when every test passes, 1 when one fails, 2 on a usage or input error or when a test has no recorded outcome and `--record` was not given. The options and a run on the fixture are in the [CLI reference](reference/cli.md#driftbench-estate-unit).
* Live (online, blind), `driftbench estate run`. The agent runs headless in a sandboxed copy of the estate pinned by hash, on a seeded workspace, from the ask alone: no test word in the prompt or the dispatch description. Teacher-forced resumes from a recorded prefix cut at block k; free running; perturbed injects an estate deviation at block k (a compaction marker, a mid-turn message, a planted file, a dead helper). Repeats give the variance; cost per run is measured. Built: `driftbench estate run`, with session states and hazards planted from the state library `--states`.
* Estate mutants, `driftbench estate mutate`. Delete or invert one atom in a copy of the estate. A `--delete` of a skill's `name:` line whose value is the skill's folder name is refused as an equivalent mutant: the runtime names a skill by its folder, so the line's removal changes nothing the agent sees, and nothing is written. The tests derived from that atom must go red in live mode, and the replay suite must flag the corpus as now violating. The mutation score per atom kind is the stop rule. Built: `driftbench estate mutate`. The fixture's proof (`packages/cli/test/estate-live.test.ts`) runs 14 live specs on the stand-in and two mutants, each turning its atom's specs red. `--delete <id>` names the atom by its atom id or by the ledger id of its unit.
* Link proof, `driftbench estate prove <specs...> --mutant <dir> --original <store> --mutated <store>`. Run the suite on the original and on a mutant that deletes one rule, then prove the links of the blocks to that rule: a block flips when it passes on the original and fails on the mutant. A `verifies` link whose block flips becomes `verified`; one whose block passes on both becomes `refuted`; a block that flips with no link is an unlinked flip; a block that does not pass on the original proves nothing. `--write` writes the statuses and their evidence into the spec files (`metadata.links`, outside the spec hash). On the stand-in, which follows the rules of the estate in its folder, the blocks that flip when a route row or the `WebFetch` deny is deleted are exactly the blocks linked to it (`packages/cli/test/estate-prove.test.ts`); a link planted on a block that does not test the route is refuted, and a removed link shows up as an unlinked flip. Exit 0 when the blocks that flip are the linked blocks, 1 when they differ.

## 7. Judging, statistics and coverage for estates

What exists: `sessionRate(runs, { rho })` of `@agent-nexus/driftbench-estate` takes the session as the unit (one cluster): with m the mean runs per session, the design effect is `1 + (m - 1) rho`, the effective runs are the runs over it, and the 95% interval is Wilson on the rounded effective runs. `rho` lies in [0, 1], the correlation of the variance pilot, and the function throws a `RangeError` outside it. The plan summary reports the unenforced rules, the cells with no approved phrase, the edges with no journey and the mandatory rows per kind; the generate report counts complete and incomplete specs per test type and the gaps behind them; replay reports pass and fail per spec and session.

`estate stats` reports the frozen coverage, reach, decay and guard drift fields below. It uses offline replay checks for compliance and block pass rates, with no model call. Specs align through `metadata.replay`; those without a key align by file order, as in `replay`. A session counts once per block and atom, even when several specs name it. An atom is followed only when every aligned complete spec naming it passes. A block without an aligned check has no demonstrated pass. Judged criteria remain inconclusive without a judge; this command does not call one.

Not built yet:

* Sources of variance for an estate are model randomness, phrasing, session state, workspace seed and judge; the pilot that measures them for an estate is not built.
* The completeness line over situations seen in the corpus.
* A sealed holdout for estate changes and the pass rate per atom per estate version over time.

### The coverage command: `estate stats` (contract)

```
driftbench estate stats --map <map> --plan <plan> --specs <dir> [--sessions <dir>] --json
```

`--map` is the approved map, `--plan` the plan made from it, `--specs` the folder `estate generate` wrote (its `specs/`, `static/` and `incomplete/` folders), `--sessions` a folder of recorded sessions. It prints one JSON object:

```json
{
  "coverage": {
    "kinds": { "<kind>": { "atoms": 0, "tested": 0, "enforced": 0 } },
    "cells": { "covered": 0, "total": 0 },
    "edges": { "covered": 0, "total": 0 }
  },
  "reach": [{ "atom": "<id>", "reached": 0, "followed": 0 }],
  "reachNotObservable": { "status": "not observable", "atoms": 0 },
  "decay": [{ "block": 0, "runs": 0, "passRate": 0 }],
  "drift": { "guards": [{ "guard": "<name>", "decisions": 0, "denies": 0, "denyRate": 0 }] }
}
```

* `kinds`: one entry per atom kind of the map. `atoms` counts the approved atoms of the kind. `tested` counts those named by at least one complete spec (a spec under `specs/`, or a static test under `static/`). `enforced` counts those whose enforcement lists at least one guard.
* `cells` and `edges`: the plan's cells and the graph's route, reference, dispatch and next edges, covered when a complete spec covers them.
* `reach` covers the four observable kinds: skills, references, guards and subagents. `reachNotObservable` reports the other approved atoms as `{ status: "not observable", atoms: <count> }`. It counts them from the map, including when no sessions are supplied. No exposure is inferred for those kinds.
* `reach` and `decay` come from `--sessions`; without it, both are empty lists. `reached` is the number of sessions that reached the atom's moment (its skill loaded, its file read, its guard decided, its helper dispatched); `runs` is the number of sessions that hold the block index.
* `drift.guards` comes from the guard decision logs of `--sessions`: per guard, the decisions logged, the denies among them and their share. A user watches it over time: a guard that starts denying more, or stops firing, is the first sign that the estate or the agent changed.

Finding (audit style, 2026-10-12, the estate validator lane): section 7 promises drift ("deny rates per guard from the decision logs"), and the frozen contract had no field for it. The contract gains `drift.guards`; nothing else changes. The pass rate per atom per estate version needs a store of past runs, and waits for its own finding.

Exit codes: 0 when the report is printed; 2 on a usage or input error (a map, plan or folder that does not load, or a plan made from another map), and nothing is printed.

## 8. Maintenance: keeping the tests true when the estate changes

### What changed: `estate diff`

Atoms match by id. An atom whose provenance hash changed is one of three things:

* moved: the same quote at another span (a line was added or removed above it); no test changes;
* white space: the quotes are equal once runs of white space become one space and the ends are trimmed; no test changes, since nothing a test checks changed (a change reruns only what it can affect);
* semantic: anything else (case and punctuation count); its tests are regenerated and its phrasings go back for approval.

An atom with the same hash whose evidence, enforcement, situation, title, role or kind fields differ is restated: its tests are regenerated. Approval alone is never a change. Edges compare as `from kind to`.

An atom id names the file the atom was read in, so a fact several files state once, such as a tool two helpers declare, changes its id when the file it was anchored in leaves. An atom that leaves under one id while an atom of the same kind, title, words and fields arrives under another is the same atom, renamed: it is listed under `renamed` (and counted in `summary.renamed`) instead of as removed and added, and its tests are regenerated against the new id, never retired. Both keys are absent when nothing was renamed.

A rule removed and another added at the same ledger unit read as one changed rule. An atom the pointer reader built names its ledger unit (`fields.unit`), and the ledger keeps a unit's id when its text is edited in place. So when one atom leaves a unit and one atom of the same kind arrives on it, the diff lists one semantic change under the old id, with the new id in `now`, and impact regenerates its tests and asks for re-approval, never a retirement. In the Northwind version 2, R12 ("keep the draft and do not send it") is removed and R19 ("keep the credit note as a draft") is written at its line: the diff below reads `instruction.standing.r12-when-r2-applies-and-the` changed, now `instruction.standing.r19-when-r18-applies-and-the`, and its two tests wait for re-approval.

The diff of the Northwind estate against its second version, with the guard state of the first version named:

```
$ pnpm -s driftbench estate diff examples/estates/fixture/approved.yaml examples/estates/fixture-v2/map.yaml --old-guards examples/estates/fixture-v2/maintain/guard-state.v1.yaml --out _captures/docs3/estate/diff.json
Estate diff: examples/estates/fixture/approved.yaml (db9e07132a1b) to examples/estates/fixture-v2/map.yaml (0c62ba644a29).
  Atoms: 2 added, 0 removed, 3 changed (1 white space only, 2 semantic), 25 moved with the same quote, 3 restated, 86 unchanged.
  Edges: 0 added, 0 removed.
  Guards: 1 of 6 changed enforcement state:
    promoted guard.settings.posttooluse-bash-guard-ledger-guard-py: warn to enforce (evidence: 47 decisions, 0 wrong, logs/ledger-guard.decisions.jsonl)
Added:
  + register.weekly-report.fill-the-template-in-this-order (register) .claude/skills/weekly-report/SKILL.md:11
  + instruction.standing.r18-never-approve-a-credit-note (instruction) CLAUDE.md:26
Changed, white space only:
  ~ instruction.standing.r2-never-send-an-email-to (instruction) CLAUDE.md:10-11
Changed, semantic:
  ~ instruction.standing.r7-when-a-shipment-is-late (instruction) CLAUDE.md:16
      was: **R7.** When a shipment is late by more than two days, tell the user and propose a supplier email.
      now: **R7.** When a shipment is late by more than one day, tell the user and propose a supplier email.
      also: title, situation, fields
  ~ route.standing.an-ask-to-plan-the-delivery (route) CLAUDE.md:38
      was: plan the delivery routes for tomorrow | the `route-planner` agent
      now: plan the delivery routes for the next two days | the `route-planner` agent
      also: title, situation, fields
Moved, same quote:
  > gate.standing.read-before-edit-it CLAUDE.md:11 to 12
  > instruction.standing.r4-never-delete-a-file-under CLAUDE.md:12 to 13
  > gate.standing.read-claude-skills-invoice-reconcile-references CLAUDE.md:13 to 14
  > reference.standing.read-claude-skills-invoice-reconcile-references CLAUDE.md:13 to 14
  > instruction.standing.r6-never-run-git-push-force CLAUDE.md:14 to 15
  > instruction.standing.r8-do-not-invent-order-numbers CLAUDE.md:16 to 17
  > register.standing.r9-ask-at-most-one-question CLAUDE.md:17 to 18
  > instruction.standing.r10-when-the-user-says-stop CLAUDE.md:18 to 19
  > instruction.standing.r11-never-paste-the-contents-of CLAUDE.md:19 to 20
  > route.standing.an-ask-to-reconcile-an-invoice CLAUDE.md:31 to 33
  > route.standing.an-ask-to-know-where-a CLAUDE.md:32 to 34
  > route.standing.an-ask-to-write-to-or CLAUDE.md:33 to 35
  > route.standing.an-ask-to-prepare-the-weekly CLAUDE.md:34 to 36
  > route.standing.an-ask-to-audit-the-ledger CLAUDE.md:35 to 37
  > instruction.standing.every-task-follows-the-step-list CLAUDE.md:40 to 42
  > reference.standing.read-claude-steps-json CLAUDE.md:40 to 42
  > instruction.standing.a-tracker-note-may-be-written CLAUDE.md:40-41 to 42
  > instruction.standing.never-report-a-task-as-done CLAUDE.md:41 to 43
  > register.standing.keep-every-reply-under-1-200 CLAUDE.md:45 to 47
  > register.standing.lead-with-the-result-in-the CLAUDE.md:46 to 48
  > register.standing.use-a-bullet-list-for-three CLAUDE.md:47 to 49
  > register.standing.never-use-the-words-obviously-or CLAUDE.md:48 to 50
  > register.standing.write-amounts-with-the-currency-code CLAUDE.md:49 to 51
  > gate.standing.read-claude-memory-memory-md-before CLAUDE.md:50 to 52
  > reference.standing.read-claude-memory-memory-md CLAUDE.md:50 to 52
Restated, same quote:
  * instruction.standing.r8-do-not-invent-order-numbers: situation, evidence, fields
  * instruction.standing.r17-report-a-number-only-when: situation, fields
  * invariant.standing.the-standing-instructions-stay-under-40000: fields
Wrote _captures/docs3/estate/diff.json.
```

The JSON it writes equals the committed `examples/estates/fixture-v2/maintain/diff.json` as data. The size invariant of the standing file is restated because the file's measured size changed; so its tests are regenerated after every change to the standing file.

Two limits of the atom ids:

* An id is `kind.scope.slug`, and two atoms with the same slug get a `-2` suffix in scan order. A new atom with the same slug, inserted above an existing one, swaps their ids, and the diff reads a change and an addition. The Northwind fixture avoids it.
* A semantic change to the first six words of a model atom's title, or of a code atom's quote, changes its id: the diff shows a removal and an addition, and impact retires the old tests and asks for new ones, unless both atoms sit on the same ledger unit (above).

### Enforcement state as data

A guard observes (it logs what it would decide), then warns (it tells the agent), then enforces (it blocks). The state of every guard atom of a map is a file beside the map, `guard-state.yaml`, one entry per guard atom id, with its mode, the date since, and the decision-log evidence behind the mode. Part of the Northwind version 2 state:

```text
version: 1
guards:
  - guard: guard.settings.posttooluse-bash-guard-ledger-guard-py
    mode: enforce
    since: 2026-10-05
    evidence:
      log: logs/ledger-guard.decisions.jsonl
      decisions: 47
      wrong: 0
      note: Four weeks of warnings; every flagged delete under ledger/ was a real one.
```

The file is read against its map: every entry names a guard atom of the map, and every guard atom has one entry, or the diff exits 2. `estate diff` reads the file beside each map by default, or the one named with `--old-guards` and `--new-guards`; with no state on either side, the diff has no guards. Two versions compare guard by guard: promoted, demoted, added, removed, unchanged.

* A promotion, or a new state above observe, needs evidence with at least one decision and none marked wrong; without it, a person decides.
* Every demotion is confirmed by a person.
* A state that appears only in the new version is "added". A removed state needs no person: the guard atom's removal shows in the atoms.
* A guard whose mode changed sends its tests to regenerate.

The state of the first Northwind version sits in `examples/estates/fixture-v2/maintain/guard-state.v1.yaml`, and `--old-guards` names it.

### What it does to the tests: `estate impact`

Specs index by `metadata.estate.atoms` (a list of atom ids, as `estate generate` writes them). A spec without `metadata.estate` is counted as other. A spec with any `metadata.retired` value, a key beside `metadata.estate`, is no longer live. The static tests `estate generate` writes under `static/` (an invariant or a setting, one JSON record each) are tests too: a record indexes by its `atom`, and a retirement is written as the record's own `retired` field, which `estate static` and `estate stats` then skip. A removed environment key therefore retires the test of its setting. The lists:

* regenerate: every test with a semantic, restated, renamed or guard-state atom, or with a removed atom while other atoms remain, with the reason per atom; a change of white space alone touches no test (the respaced supplier rule leaves `northwind-supplier-yes` untouched);
* re-approve: every semantic change, with its tests;
* retire: every test whose atoms are all removed, with the reason `atom <id> removed`;
* new: added atoms no live test names.

```
$ pnpm -s driftbench estate impact _captures/docs3/estate/diff.json --tests examples/estates/fixture-v2/tests
Impact of the estate diff db9e07132a1b to 0c62ba644a29 on 8 live estate tests (0 retired before, 0 other specs).
  Regenerate 3, re-approve 2, retire 0, new 2; 4 tests untouched, 25 atoms moved with the same quote.
Regenerate:
  northwind-late-shipment (late-shipment.yaml): instruction.standing.r7-when-a-shipment-is-late semantic
  northwind-ledger-archive (ledger-archive.yaml): guard.settings.posttooluse-bash-guard-ledger-guard-py guard state
  northwind-route-planner (route-planner.yaml): route.standing.an-ask-to-plan-the-delivery semantic
Re-approve, the meaning changed:
  instruction.standing.r7-when-a-shipment-is-late (instruction): **R7.** When a shipment is late by more than one day, tell the user and propose a supplier email.
      tests: northwind-late-shipment
  route.standing.an-ask-to-plan-the-delivery (route): plan the delivery routes for the next two days | the `route-planner` agent
      tests: northwind-route-planner
New atoms with no test:
  register.weekly-report.fill-the-template-in-this-order (register) .claude/skills/weekly-report/SKILL.md:11
  instruction.standing.r18-never-approve-a-credit-note (instruction) CLAUDE.md:26
Guards whose enforcement state changed:
  promoted guard.settings.posttooluse-bash-guard-ledger-guard-py: warn to enforce; tests: northwind-ledger-archive
Cites atoms no longer in the map, no change reaches it:
  northwind-unsent-draft (unsent-draft.yaml): instruction.standing.r12-when-r2-applies-and-the
Needs a person: 5.
  - re-approve instruction.standing.r7-when-a-shipment-is-late: its meaning changed; 1 test waits
  - re-approve route.standing.an-ask-to-plan-the-delivery: its meaning changed; 1 test waits
  - approve the tests of the new atom register.weekly-report.fill-the-template-in-this-order: no test covers it yet
  - approve the tests of the new atom instruction.standing.r18-never-approve-a-credit-note: no test covers it yet
  - the test northwind-unsent-draft cites an atom no longer in the map (instruction.standing.r12-when-r2-applies-and-the): decide what it tests now
```

It exits 1 for the four items. Version 2 retires no test: R12's tests are regenerated, as above. A test whose atoms are all removed is retired: `--write` writes each retirement reason into its spec as `metadata.retired` (`retired: atom <id> removed`), keeping comments and layout, and loads the spec again before writing; a second run finds it written. Without `--write`, impact writes nothing and reports each retirement "to write".

### The radius on the ledger

The ledger of the last scan names every unit of the prose by an id that survives an edit. So an edit can be read unit by unit, with no model:

```
driftbench radius ledger map.yaml --ledger pointer-ledger.json --out change.yaml
driftbench estate diff map.yaml map-v2.yaml --old-ledger pointer-ledger.v1.json --new-ledger pointer-ledger.json --out diff.json --change-out change.yaml
```

`radius ledger` reads the files as they are now, the same files the scan cut: a document the map records as no rule (an example, a fixture, a template, a history) is left out, as the scan left it out. `estate diff` reads two scans. Both put each unit in one edit class, and each class has one rerun set:

| Edit class | What reruns |
|---|---|
| unchanged | nothing |
| context: the same text, other neighbours or headings | nothing; the unit is advisory |
| moved: the same text in another file | nothing; the unit is advisory |
| changed | the unit |
| deleted | the unit |
| new | the old units of its section; in a file the ledger did not hold, the whole suite |

A unit with atoms on it becomes a `prompt` change per atom, so the tests that name the atom rerun. A unit with no atom becomes a `unit` change. `estate impact` regenerates the tests of a changed atom under its old id, even when its new text gave it a new id. It lists the tests to rerun as they are, because a new unit landed beside their atom, and the tests that are advisory only. A changed unit on which the old map holds no atom (the labelers left it unlabeled) is listed as changed, unlabeled: no test names it, so none is regenerated; the live tests that cite an atom of its file are listed as touched, and a person reviews it. A live test that cites an atom id neither map holds is listed as citing atoms no longer in the map, and in the needs of a person: no change can reach it, so it is never counted as untouched.

A `unit` change keeps the radius the whole suite. The H7 study of [blast radius](concepts/blast-radius.md#advisory-section-selection) was repeated with block links to units: they missed a flipped block on 2 of 90 mutants and on 4 of 110, the same mutants as section links, with Wilson 95% upper bounds of 7.7% and 9.0%. That is above the 5% the selection needs to become a filter. `packages/estate/test/pointer/h7-ledger.test.ts` reruns the study.

A second study drew 300 new mutants and measured 274 of them, with the rerun marks (`metadata.rerun`, which the unit selection reads like the section selection) on the blocks the first study found fragile. Selection by ledger unit with the marks missed a flipped block on 0 of 274 (Wilson 95% upper bound 1.38%, mean selection ratio 0.513). Without the marks it missed 9 of 274 (6.12%). One suite and one agent model carry both studies, so neither says the selection holds on another suite. Source: `research/ledger-h7/RESULT-ledger.md`.

### Regression: replay over the corpus

`estate impact ... --replay <sessions> [--suite <dir>] [--store <db>]` runs `driftbench replay` over a folder: every `*.jsonl` there is a session, and `*.decisions.jsonl` and `*.steps.jsonl` files go with their session by name. The suite defaults to the `specs` folder inside the sessions folder. The latest replay campaign is read from the store before this replay is stored in it, and each spec on each session flips: pass to pass, fail to pass, pass to fail (a person is needed), fail to fail, or no previous. The run replays whatever corpus and suite it is given: it does not skip specs that `--write` retired.

The corpus of `examples/estates/sessions` belongs to the shop build estate and to the Acme ops agent, not to Northwind, so on the fixture the run shows the comparison working, not Northwind regressions. Run twice with one store, the first run has nothing to compare with; the second compares with the first. These are the two lines each run adds to the impact output above:

```
Replay of 8 runs, campaign replay-314dd5d13a4a, no earlier replay in the store: nothing to compare.
  pass to pass 0, fail to pass 0, pass to fail 0, fail to fail 0, no previous 8.
```

```
Replay of 8 runs, campaign replay-603c2d6667db, against replay-314dd5d13a4a.
  pass to pass 4, fail to pass 0, pass to fail 0, fail to fail 4, no previous 0.
```

The failing session that motivated a change is its fail-to-pass case: red before, green after, on the same transcript.

## 9. Where it lives

* `packages/estate`: the schema (atoms, edges, the map, the plan), the scanner (`scan/`, with the Claude Code reader as the one runtime-specific file), the graph, the map file and its space map, the lint, the plan (contract, journeys, pairwise), and maintenance (diff, guard state, impact, regression). It imports the covering array, the feasibility check, the graph walk and the model port from `@agent-nexus/driftbench-generate`.
* `packages/generate/src/estate`: the estate generator. It reads the map and plan by their shape and never imports `@agent-nexus/driftbench-estate`, so the two packages do not import each other.
* `packages/adapters/src/claude-code`: the session reader, the replay adapter, the ordered-pair check, and the live runner in `live/`.
* `packages/cli`: the `estate` commands and `replay`.
* The estate validator, which checks this whole loop on an estate nobody wrote by hand: `driftbench validate estate`, designed on the [validators](validators.md) page.

Built, in order: scan, lint and map; plan; the session reader and replay; generation; maintenance; the live runner with planted session states and hazards; estate mutants; the static and unit runners. Not built yet: the unit run of a helper alone, and a validation on a real estate against its native test battery.

One test runs the whole chain from scan to radius, with no model call: [the estate chain proof](estate-chain.md). [From a rule to its tests](rule-links.md) follows one rule from its ledger id to the tests it reaches.

See also: [checks](reference/checks.md), [running](running.md), [statistics](concepts/statistics.md).

### Explicit operations in unit task specs

`estate mutate` copies the estate configuration (`driftbench.estate.yaml`, at the root or in `.claude/`) with the estate files, since a unit test on the copy needs the helper executors and the script fixtures it declares. `estate unit` accepts YAML or JSON task specs marked `metadata.estate.mode: unit`, alongside recorded JSON unit tests. A task spec declares its executable operation in `metadata.estate.unit`: a guard target (name, event, matcher and command) or a script target (path), plus concrete `cases` with guard event payloads or script arguments, files and stdin. The runner executes those inputs on a copy. It does not turn the user ask into a command or search the implementation for an input that satisfies the expected verdict. The runner evaluates `expect.guards`, `expect.execution` and `expect.workspace`; for `workspace` it compares the files of the operation's working folder before and after each case (the estate copy for a guard, the case folder for a script). An expectation of any other kind, or a workspace expectation the operation cannot observe, is an input error reported as `not_run`, never a pass. A fixture path that is absolute, or that leaves the working folder by `..` or a symbolic link, is refused before any fixture is written.

A unit task spec has one block. Guard expectations check actual firings: exit 2 denies, a JSON permission decision supplies its decision, another nonzero exit warns, and context on stdout nudges. `guard_message` checks the actual messages of the runs by which a guard acted (a deny, a block, a warn or a nudge); an allow, a timeout or a verdict outside that list is no intervention and has no message to judge; `guard_finished` and an optional `budgetMs` check completion. A case may supply an exact `expected` outcome. A script needs declared configuration fixtures, exact case outcomes, or an explicit expected exit code. Starting a process alone does not establish its correctness. Script execution assertions enforce `ran_code`, `max_commands` and the last command's `exit_code`. Guard case outcomes describe guard processes. `some_call` checks the actual script invocations and their input fields. Other custom script checks and assertions naming another operation are reported as unsupported, never silently dropped. Agent replies, skill loads and workspace edits require a live or replay test; direct unit operations do not establish those outcomes. Missing inputs, unsupported checks and missing script oracles are input errors, not executed failures or successful mutant kills.

Explicit task payloads retain their declared keys and empty values; the runtime reply alias is added only when absent. Recorded JSON tests keep their existing shorthand conversion. Guards run from the copied estate's working folder. Scripts use their shebang interpreter when present, and otherwise the file extension selects the interpreter. Declared and recorded script fixtures both pass their stdin to the process. A helper's prompt alone supplies no observed execution; helper-only task specs require an executor declared under `helpers` in the estate configuration; missing executors report an input error.


### Declared unit execution contracts

A helper executor is an explicitly configured local runtime. The runner never selects one from a helper's description or infers execution from a nonempty prompt. Its command runs inside the copied estate, with the unit sandbox, isolated home, process-group cleanup and timeout. The configuration names the executable and each argument separately; shell syntax requires an explicit shell command. Local stand-ins must perform the task on its inputs, rather than print a success verdict.

```text
helpers:
  labeler:
    command: [python3, .claude/execute-labels.py]
    timeoutMs: 3000
scripts:
  .claude/skills/labels/scripts/label.py:
    usage: label.py < label
    fixtures:
      - stdin: green parcel
        expect:
          exitCode: 0
          stdout: GREEN PARCEL
```

A helper run alone is also written as a JSON run record, `unit/contract_alone/unit.contract_alone.<helper atom>.json`, beside the unit-mode spec: its target is the helper and its agent file, and its one case holds the task the row asks and the workspace files its situation seeds. A record is an output, not an input: `driftbench estate unit --record` runs the helper on the original estate (three record runs) and writes its answer into the case; a later run, on any copy, must answer the same, so an agent file that lost its body or changed what it asks turns the record red. A helper with no declared executor, or whose executor fails, fails the record and is never recorded as a pass. The generate report counts these records under `unit.helpers`.

The helper process receives one JSON line with `name`, `systemPrompt` (the current body without YAML frontmatter), `frontmatter` and `task` (the unit block's user message). Workspace files from the spec are planted in the copy; they cannot replace `.claude/` or configuration files. The executor returns a JSON object with `text`, `segments` and `toolCalls`, plus any observed runtime traces, executions or workspace diff in the core `Observed` format. Cost and latency fields are supplied by the runner. The executor must report actual observations. Machine checks evaluate the task assertions against them; zero process exit alone does not pass a helper test. Missing observations, unavailable executors and unreadable helper files are reported explicitly. An empty body still reaches the executor; only actual execution and its observations determine the result. Judged criteria require a judge and do not pass an offline unit run. Successful executions also report `helpers` entries with the helper name, process exit, measured milliseconds and text.

Script fixture expectations are independent contracts written from the public usage, documented exit codes and declared outputs. Neither the runner nor generation derives an expected result from implementation source. Each configured fixture needs an explicit exit or output assertion; a usage line without expectations is not an oracle. Output-only expectations retain the documented default exit code of zero. The runner accepts both the existing fixture list and the `{ usage, fixtures }` form above, validates them before execution, and checks every fixture. `some_call` reads only actual command invocations (interpreter, script path and arguments); it cannot establish that a script performed an internal tool action. Unsupported custom checks and absent oracles report an input error, never a successful mutant kill.

A hand-written guard expectation without a `verdict` counts a blocking decision (deny or ask) when it requires a firing, and also a warning (a nonzero exit other than 2) when it bounds firings, such as a count of 0 or a `max`; a message-only nudge is neither. A guard that only warns therefore fails "no firing".

Generated guard expectations retain their declared verdict for hostile and speed tests as well as positive and negative tests. With no declared verdict, a positive firing means an actual denial. Text-event guards enforcing a declared `max_characters` predicate receive a positive payload above that boundary and a separate neutral control. Boundary synthesis uses the map's evidence, never implementation literals, and is bounded by `MAX_BOUNDARY_CHARACTERS` in the generator.

Recorded measurements behind two estate changes: [generation pass-to-fail comparison](estate-generation-loss-ca5.md) and [unit runner evidence](estate-unit-runner-evidence.md).

## Regenerate the fixture

The Northwind folders hold outputs that tests compare byte for byte: the map, the approved map, the space map, the plan and its summary, the approved copy of the plan, the generated suite, and the fixture-v2 map, diff and impact. Make them again after a change to a file the scan reads under `examples/estates/fixture`, to its `answers.yaml`, `phrases.yaml` or `sessions/`, or to the scan, plan or generate code. A change under `examples/estates/fixture-v2` alone needs only step 7. The commands call no model and write in place. Run them from the repository root, in this order.

```sh
F=examples/estates/fixture
V=examples/estates/fixture-v2
P=packages/generate/test/estate/fixtures
T=$(mktemp -d)

# 1. The map: a scan with the recorded answers.
pnpm -s driftbench estate scan $F --runtime claude-code --replay $F/answers.yaml --out $F/map.yaml --force

# 2. The approved map, and the space map of the docs.
cp $F/map.yaml $F/approved.yaml
pnpm -s driftbench estate approve $F/approved.yaml --all
pnpm -s driftbench estate map $F/approved.yaml --to $F/space.yaml --agent northwind

# 3. The map hash, in the three files that pin it.
HASH=$(grep -m1 '^hash:' $F/approved.yaml | cut -d' ' -f2)
perl -pi -e "s/^mapHash: \S+/mapHash: $HASH/" $F/phrases.yaml $P/plan.yaml
perl -pi -e "s/MAP_HASH = '[0-9a-f]+'/MAP_HASH = '$HASH'/" packages/adapters/test/claude-code/live/support.ts

# 4. The plan, of the full declared space.
pnpm -s driftbench estate map $F/approved.yaml --to $T/space.yaml --agent estate
pnpm -s driftbench estate plan $F/approved.yaml --out $F/plan.yaml --space $T/space.yaml --force

# 5. The approved copy of the plan, under the three note lines it already has.
head -3 $P/planner-plan.approved.yaml > $T/notes.txt
pnpm -s driftbench estate plan approve $F/plan.yaml --all --out $T/approved-plan.yaml
cat $T/notes.txt $T/approved-plan.yaml > $P/planner-plan.approved.yaml

# 6. The suite.
pnpm -s driftbench estate generate --map $F/approved.yaml --plan $P/planner-plan.approved.yaml --out $F/generated --force

# 7. Fixture-v2: its map, the diff against the fixture, the impact on its tests.
pnpm -s driftbench estate scan $V --runtime claude-code --replay $V/answers.yaml --out $V/map.yaml --force
pnpm -s driftbench estate diff $F/approved.yaml $V/map.yaml --old-guards $V/maintain/guard-state.v1.yaml --out $V/maintain/diff.json > $V/maintain/diff.txt
pnpm -s driftbench estate impact $V/maintain/diff.json --tests $V/tests > $V/maintain/impact.txt
pnpm -s driftbench estate impact $V/maintain/diff.json --tests $V/tests --out $V/maintain/impact.json
pnpm exec biome format --write $V/maintain/diff.json $V/maintain/impact.json
rm -rf "$T"
```

| Step | Writes | Notes |
|---|---|---|
| 1 | `map.yaml` | The scan exits 1 when a prose file has no recorded answer, and names the file. Add an entry to `answers.yaml` for it (`atoms: []` when it holds no rule). The failed scan still writes a partial `map.yaml`, without the atoms of that file, and the block has no `set -e` (steps 6 and 7 exit 1 on purpose): run the whole block again from step 1. A scan that gives a different map than the committed one fails `packages/estate/test/fixture.test.ts`. |
| 2 | `approved.yaml`, `space.yaml` | `approved.yaml` is `map.yaml` with every atom approved. The space map names the agent `northwind`. Both are checked by `fixture.test.ts`. |
| 3 | `phrases.yaml`, `packages/generate/test/estate/fixtures/plan.yaml`, `packages/adapters/test/claude-code/live/support.ts` | The hash of the map replaces the old one in the phrase bank, in the hand-written plan and in the live adapter test. Nothing changes when the hash did not. `estate generate` refuses a bank written against another map and prints both hashes. |
| 4 | `plan.yaml`, `plan.summary.json` | The committed plan is the plan of the full declared space, the one `estate map` writes with the agent name `estate`. The space file of this step is a scratch file. `packages/cli/test/estate-plan.test.ts` checks the committed bytes. |
| 5 | `packages/generate/test/estate/fixtures/planner-plan.approved.yaml` | The plan with every row approved. `head -3` keeps the three note lines at the top of the file. `packages/generate/test/estate/generate.test.ts` checks that the file is the plan with only the status changed. |
| 6 | `generated/` | Replaces `specs/`, `incomplete/`, `static/`, `unit/`, `estate-generate-report.json` and `run-order.txt`, and nothing else in the folder. Exit 1 is normal while some spec stays incomplete. The seed is 1. `generate.test.ts` compares every file. |
| 7 | `fixture-v2/map.yaml`, `fixture-v2/maintain/diff.json`, `diff.txt`, `impact.json`, `impact.txt` | `estate impact` exits 1: the planted changes wait for a person. Its text goes to `impact.txt` without `--out`, so the file holds no line that names the JSON file. The repository formatter formats the two JSON files. `packages/estate/test/maintain/fixture-v2.test.ts` compares the JSON files as data, and `packages/cli/test/estate-maintain.test.ts` compares the two text files. |

`phrases.yaml`, `sessions/`, `answers.yaml` and the files of the estate itself are inputs written by hand. The hand-written plan and `phrases.yaml` name atoms by id: when a change renames or removes an atom they name, edit both by hand. Step 6 exits 2 and names the entry of `phrases.yaml` that no longer matches an atom.

A run on an estate that did not change changes only the time of the scan: `readAt` and the `at` of `producedBy` in `map.yaml`, `approved.yaml` and `fixture-v2/map.yaml`, and the two `readAt` values in `fixture-v2/maintain/diff.json`. Restore those four files with `git checkout` when nothing else moved. Use this as a check: if anything else changes on an estate you did not touch, the code behind a command changed its output.

After a change of the estate, the tests that count what the fixture holds fail with the old number. Each names the number it expected. Check that the number the run printed is the one the change should produce, then replace it. A count that moves for a reason you cannot name is a defect.

| Test file | What it counts |
|---|---|
| `packages/cli/test/estate.test.ts` | atoms, edges and prose chunks of the scan, and the approval counts |
| `packages/cli/test/estate-plan.test.ts` | plan rows, by source and by status |
| `packages/cli/test/estate-maintain.test.ts` | atoms unchanged between the map and its approved copy |
| `packages/estate/test/scan.test.ts` | files by kind, atoms by kind, references |
| `packages/estate/test/graph.test.ts` | edges by kind, the rules and the unenforced rules |
| `packages/estate/test/map.test.ts` | approval counts, and the size of each target dimension of the space map (`atoms.instruction` and the other kinds) |
| `packages/estate/test/plan/plan.test.ts` | plan rows per atom kind (`perKind`) |
| `packages/estate/test/lint.test.ts` | the `UNENFORCED` count of the lint |
| `packages/estate/test/maintain/fixture-v2.test.ts` | atoms unchanged in the fixture-v2 diff |
| `packages/generate/test/estate/generate.test.ts` | approved rows, and the specs, blocks, complete, incomplete and judged specs of the suite |
| `packages/cli/test/estate-generate.test.ts` | the sessions and the replay specs written over them, which move with `sessions/` and `phrases.yaml` |

Run them, with the live adapter tests that read the hash:

```sh
pnpm exec vitest run packages/estate packages/generate packages/cli/test/estate packages/adapters/test/claude-code --maxWorkers=2
```

The captured outputs on this page, in [the CLI reference](reference/cli.md), in [the comparison](comparison.md) and in the help topics `packages/cli/help/validate-estate-*.md` keep the hash and the counts of the run they were captured from, and no command makes them again. `git grep` for the old hash lists them. One line is checked: the validator item `estate-approve-counts-match-docs` compares the atom count in this page's capture of `estate approve` with `approved.yaml`.
