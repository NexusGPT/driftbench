# The command line

A tour of the commands with a runnable example each. [CLI](reference/cli.md) is the full reference.

`driftbench <command> --help` prints every option. The examples below run from a clone (`git clone https://github.com/NexusGPT/driftbench && cd driftbench && pnpm install`), on the fictional Acme Telecom agent, with no model call. Put `pnpm` in front of each example in a clone, or `npx` in your own project. `campaign run` writes the `ci.db` the later rows read.

Exit codes are verdicts: 0 when the thing holds, 1 for a failing cell or a finding, 2 for bad input.

**Write and check specs**

| Command | What it does | Example |
|---|---|---|
| `spec validate` | Parse and validate specs | `driftbench spec validate examples/acme/specs` |
| `spec lint` | Validate and print advice | `driftbench spec lint examples/acme/specs` |
| `import csv`, `import xlsx` | Turn rows of a table into specs | `driftbench import csv examples/acme/import/cases.csv --mapping examples/acme/import/mapping.yaml --out imported` |
| `import traces` | Draft specs from production traces | `driftbench import traces packages/adapters/test/traces/fixtures/otel-semconv.json --from otel --out drafts` |

**Run an agent**

| Command | What it does | Example |
|---|---|---|
| `campaign plan` | List the runs and print the smallest effect they can detect, before spending | `driftbench campaign plan examples/acme/specs/conversations --target function:acme --mode T,F --repeats 3` |
| `campaign run` | Run specs × targets × modes × repeats, and keep the runs | `driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --store ci.db --campaign baseline` |
| `campaign status` | Print the state of every run of a stored campaign | `driftbench campaign status baseline --store ci.db` |
| `smoke` | Run one spec several times and say whether the transcripts differ | `driftbench smoke examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme` |
| `perturb` | Inject one deviation and print the recovery | `driftbench perturb examples/acme/specs/conversations/plan-upgrade.yaml --class D2_goal_shift --at 2` |
| `simulate` | Let a simulated user play a persona | `driftbench simulate examples/acme/specs/conversations/plan-upgrade.yaml --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --target function:acme` |
| `attack` | Attack adaptively, each move picked from the agent's last replies | `driftbench attack examples/acme/specs/conversations/plan-upgrade.yaml --target function:acme --rounds 3 --seed 1` |
| `replay` | Run a spec suite over recorded sessions, offline | `driftbench replay examples/estates/sessions/price-sheet-build.jsonl --suite examples/estates/sessions/specs/price-sheet-build.yaml` |

**Judge**

| Command | What it does | Example |
|---|---|---|
| `judge check` | Validate criteria and their pass and fail transcripts | `driftbench judge check examples/acme/criteria` |
| `judge run` | Replay a panel of judges on recorded answers | `driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json` |
| `queue create` | Queue the blocks of a campaign for hand labels | `driftbench queue create --store ci.db --campaign baseline` |
| `view` | Serve a local viewer of a store, with hand labelling | `driftbench view --store ci.db` |

**Change the agent, or the rules, and rerun little**

| Command | What it does | Example |
|---|---|---|
| `radius` | List the blocks a change to the agent can affect, and run nothing | `driftbench radius examples/acme/gated/specs --change examples/acme/radius/stage-recap.yaml --mode F,T` |
| `isolation` | Check which children of a parent link need their parent | `driftbench isolation <spec> --target function:acme-sales` (a template: the spec needs `parent` links and a target that passes it) |
| `object` | List, show, explain and check the rule files | `driftbench object list` |
| `campaign rejudge` | Score stored runs again under a changed rule, with no agent call | `driftbench campaign rejudge <specs> --from baseline --campaign rescored --store ci.db --use check-set/<id>` (a template: put the specs and the object you wrote) |

**Report and compare**

| Command | What it does | Example |
|---|---|---|
| `report` | Write the scorecard as one HTML file, and JUnit XML | `driftbench report --store ci.db --out scorecard.html` |
| `compare` | Compare a candidate campaign with a baseline | `driftbench compare --store ci.db --baseline baseline --candidate <campaign id>` (a template: put the id that `ci` printed) |
| `ci` | Run, compare and gate in one step | `driftbench ci --specs examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --baseline baseline --store ci.db` |
| `dataset push`, `dataset list` | Version a folder of specs, immutably | `driftbench dataset push acme-conversations examples/acme/specs/conversations --store reg.db` |

<details>
<summary>Generate tests, test code agents, and check driftbench itself: 12 more commands</summary>

<br/>

| Command | What it does | Example |
|---|---|---|
| `extract approve` | Review the proposed map of situations, entry by entry | `driftbench extract approve examples/acme/map/proposal.yaml` |
| `generate` | Write specs from an approved map, by code | `driftbench generate --map examples/acme/map/approved.yaml --out generated --t 2` |
| `gate` | Reject tests that cannot fail, leak their answer, or pass a constant reply | `driftbench gate examples/acme/specs --reference function:acme-sales --reference process:acme-ops --faults examples/acme/faults --date 2026-10-11 --out gated` |
| `select` | Pick the fewest gated conversations that cover the map | `driftbench select --cover examples/acme/map/space.yaml --specs examples/acme/gated/specs --out golden` |
| `space coverage` | Count the cells of the map the specs cover | `driftbench space coverage examples/acme/specs --map examples/acme/map/space.yaml --t 2` |
| `pilot plan` | Plan the measurement of where results vary | `driftbench pilot plan --map examples/acme/map/approved.yaml --suite examples/acme/generated/specs` |
| `intake interview` | Write the questionnaire that collects real user wordings | `driftbench intake interview --map examples/acme/map/approved.yaml --out questions.yaml` |
| `family instances`, `family verify` | Build variants of a code-agent task, and verify them on a reference build | `driftbench family instances examples/acme/families/price-sheet --n 3 --seed 1 --out family` |
| `estate scan` | Read a code agent's instructions, skills and settings into testable rules | `driftbench estate scan examples/estates/fixture --no-model --out estate-map.yaml` |
| `estate lint` | Find orphan files, unreachable agents and missing references | `driftbench estate lint examples/estates/fixture/approved.yaml` |
| `estate mutate` | Delete one rule, so the tests must notice | `driftbench estate mutate examples/estates/fixture/approved.yaml --atom instruction.standing.r3-read-a-file-before-you --delete --to mutant` |
| `validate floors` | Print the level each self-test suite must hold in CI | `driftbench validate floors` |

`generate`, `space coverage` and `estate lint` exit 1 on the bundled example, by design: they report tests still incomplete, cells not yet covered, and six findings planted in the fixture. `monitor`, `holdout`, `prompt` and the other subcommands are in the [CLI reference](reference/cli.md).

</details>
