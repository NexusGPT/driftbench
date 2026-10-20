# Block help coverage

Baseline: main at `346a8249d460fb0a73c1deb6cdfdc6fd10e0e6ec`.
This inventory precedes the help edits. Only merged interfaces are in scope.

## Redesign inventory before edits

| Item | Source | Topic or MISSING |
|---|---|---|
| Block object: id, user, burst, when, given, expect, budget | packages/core/src/schema/spec.ts | authoring-blocks |
| blocks[].parent and parent scheduling | packages/core/src/schema/spec.ts | MISSING |
| given.world.workspace.binary | packages/core/src/schema/common.ts | MISSING |
| given.vars and given.world.store | packages/core/src/schema/spec.ts, common.ts | authoring-prefixes |
| PARENT_MISSING | packages/core/src/spec/issues.ts | MISSING |
| PARENT_CYCLE | packages/core/src/spec/issues.ts | MISSING |
| WORKSPACE_PATH_TWICE | packages/core/src/spec/issues.ts | MISSING |
| Carried runs and partial block reruns | packages/cli/src/commands/campaign.ts | running-change-carry |
| Parent restrictions on carry and rejudge | packages/core/src/radius/blocks.ts | MISSING |
| campaign rejudge | packages/cli/src/commands/campaign-rejudge.ts | judging-campaign-rejudge |
| not_run and blocked verdicts | packages/core/src/schema/run.ts | running-not-run |
| Campaign configuration keys | packages/core/src/schema/config.ts | running-campaign-config |
| Estate commands | packages/cli/src/commands/estate*.ts | validate-estate topic family |

Standalone object commands, re-score commands and a variable-store interface are not registered in this baseline.
The existing interfaces are block objects inside specs, `campaign rejudge`, `given.vars` and `given.world.store`.
Future registrations must add help in their own change.

## Existing topics

- `authoring-blast-radius`
- `authoring-block-links`
- `authoring-blocks`
- `authoring-covering-arrays`
- `authoring-deviation-classes`
- `authoring-extract`
- `authoring-gate`
- `authoring-generate`
- `authoring-given-checks`
- `authoring-import`
- `authoring-intake`
- `authoring-inventory`
- `authoring-map`
- `authoring-personas`
- `authoring-perturbations`
- `authoring-prefixes`
- `authoring-prompt-sections`
- `authoring-script-api`
- `authoring-space-coverage`
- `authoring-spec-check`
- `authoring-spec-format`
- `authoring-task-families`
- `authoring-users`
- `core-configuration`
- `core-exit-codes`
- `core-getting-started`
- `core-global-options`
- `core-project-layout`
- `core-reading-help`
- `judging-bench-floors`
- `judging-bench-record`
- `judging-bench-replay`
- `judging-calibration`
- `judging-campaign-rejudge`
- `judging-cassettes`
- `judging-check-runtime`
- `judging-check-text`
- `judging-check-tools`
- `judging-council`
- `judging-criteria`
- `judging-default-judge`
- `judging-evidence`
- `judging-families`
- `judging-judge-calibrate`
- `judging-judge-check`
- `judging-judge-options`
- `judging-judge-run`
- `judging-long-structured`
- `judging-machine-checks`
- `judging-mixture-of-judges`
- `judging-opt-in-settings`
- `judging-overview`
- `judging-pairwise`
- `judging-queue`
- `judging-run-judge`
- `judging-self-tests`
- `recipes-benchmark-a-judge`
- `recipes-compare-two-versions`
- `recipes-find-why-a-test-failed`
- `recipes-gate-in-ci`
- `recipes-red-team-an-agent`
- `recipes-rerun-what-a-change-touches`
- `recipes-test-a-chat-agent`
- `recipes-test-a-code-agent`
- `recipes-tests-from-past-conversations`
- `redteam-attack`
- `redteam-crescendo`
- `redteam-goat`
- `redteam-indirect`
- `redteam-overview`
- `redteam-plugin-ascii-smuggling`
- `redteam-plugin-bfla`
- `redteam-plugin-bola`
- `redteam-plugin-context-compliance-attack`
- `redteam-plugin-cross-session-leak`
- `redteam-plugin-data-exfiltration`
- `redteam-plugin-debug-access`
- `redteam-plugin-divergent-repetition`
- `redteam-plugin-excessive-agency`
- `redteam-plugin-hallucination`
- `redteam-plugin-harm-copyright`
- `redteam-plugin-harm-cybercrime`
- `redteam-plugin-harm-graphic-content`
- `redteam-plugin-harm-harassment-bullying`
- `redteam-plugin-harm-hate`
- `redteam-plugin-harm-illegal-drugs`
- `redteam-plugin-harm-insults`
- `redteam-plugin-harm-intellectual-property`
- `redteam-plugin-harm-misinformation`
- `redteam-plugin-harm-privacy`
- `redteam-plugin-harm-profanity`
- `redteam-plugin-harm-radicalisation`
- `redteam-plugin-harm-self-harm`
- `redteam-plugin-harm-specialised-advice`
- `redteam-plugin-harm-violent-crime`
- `redteam-plugin-hijacking`
- `redteam-plugin-imitation`
- `redteam-plugin-indirect-prompt-injection`
- `redteam-plugin-overreliance`
- `redteam-plugin-pii-disclosure`
- `redteam-plugin-politics`
- `redteam-plugin-prompt-extraction`
- `redteam-plugin-rag-document-exfiltration`
- `redteam-plugin-rbac`
- `redteam-plugin-reasoning-dos`
- `redteam-plugin-shell-injection`
- `redteam-plugin-sql-injection`
- `redteam-plugin-ssrf`
- `redteam-plugin-tool-discovery`
- `redteam-plugin-unverifiable-claims`
- `redteam-plugins`
- `results-ci`
- `results-compare`
- `results-drift-recovery`
- `results-exports`
- `results-holdout`
- `results-monitor`
- `results-radius`
- `results-registry`
- `results-report`
- `results-scorecard`
- `results-select`
- `results-statistics`
- `results-view`
- `running-budget-and-prices`
- `running-cache`
- `running-campaign-config`
- `running-campaign-export-import`
- `running-campaign-plan`
- `running-campaign-resume`
- `running-campaign-run`
- `running-campaign-status`
- `running-cells-and-repeats`
- `running-change-carry`
- `running-cleanup`
- `running-family`
- `running-modes`
- `running-not-run`
- `running-outcomes`
- `running-pilot`
- `running-plugins`
- `running-process-and-sandboxes`
- `running-realized-text`
- `running-recordings`
- `running-retries`
- `running-sdk-adapters`
- `running-simulate`
- `running-smoke`
- `running-store`
- `running-targets-from-settings`
- `running-targets`
- `running-tool-history`
- `validate-estate-generate`
- `validate-estate-live`
- `validate-estate-loop`
- `validate-estate-maintain`
- `validate-estate-plan`
- `validate-estate-replay`
- `validate-estate-scan`
- `validate-estate-stats`
- `validate-estate-unit`
- `validate-estate`
- `validate-executor-loop`
- `validate-floors`
- `validate-generator`
- `validate-judges`
- `validate-map`
- `validate-mutants-and-rulings`
- `validate-overview`
- `validate-protect`
- `validate-reading-items`
- `validate-research-replays`
- `validate-self-checks`
- `validate-stats`
- `validate-system`

## Registered surface before edits

88 runnable commands: 88 covered. 809 registered flags: 799 covered.
91 registered error codes: 54 covered in Common errors sections.

Flags may use their command topic or a directly linked option reference.
Each row records the baseline before any missing sections were written.

| Kind | Item | Topic or MISSING |
|---|---|---|
| flag | `(global) --version` | `core-global-options`, `core-exit-codes` |
| flag | `(global) --plugin` | `core-global-options` |
| command | `spec validate` | `core-getting-started`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-block-links`, `authoring-blocks`, `authoring-prefixes`, `authoring-script-api`, `authoring-spec-check`, `authoring-spec-format`, `running-tool-history`, `judging-criteria` |
| flag | `spec validate --json` | `core-getting-started`, `recipes-test-a-code-agent`, `authoring-block-links`, `authoring-prefixes`, `authoring-spec-check`, `authoring-spec-format`, `running-tool-history`, `core-getting-started`, `authoring-given-checks`, `authoring-inventory`, `authoring-perturbations`, `authoring-prefixes`, `authoring-prompt-sections`, `authoring-spec-check`, `authoring-spec-format`, `authoring-users`, `running-campaign-run`, `running-tool-history`, `judging-judge-check` |
| command | `spec lint` | `authoring-block-links`, `authoring-blocks`, `authoring-given-checks`, `authoring-prefixes`, `authoring-script-api`, `authoring-spec-check`, `authoring-spec-format` |
| flag | `spec lint --json` | `authoring-block-links`, `authoring-given-checks`, `authoring-prefixes`, `authoring-spec-check`, `authoring-spec-format`, `authoring-given-checks`, `authoring-inventory`, `authoring-perturbations`, `authoring-prefixes`, `authoring-prompt-sections`, `authoring-spec-check`, `authoring-spec-format`, `authoring-users`, `running-campaign-run`, `running-outcomes`, `running-tool-history` |
| flag | `spec lint --strict` | `authoring-block-links`, `authoring-given-checks`, `authoring-prefixes`, `authoring-spec-check`, `authoring-spec-format`, `authoring-given-checks`, `authoring-prefixes`, `authoring-spec-check`, `authoring-spec-format` |
| flag | `spec lint --summaries` | `authoring-given-checks`, `authoring-spec-check`, `authoring-given-checks`, `authoring-spec-check` |
| flag | `spec lint --sections` | `authoring-block-links`, `authoring-spec-check`, `authoring-prompt-sections`, `authoring-spec-check` |
| command | `spec coverage` | `authoring-deviation-classes`, `authoring-inventory`, `authoring-spec-format` |
| flag | `spec coverage --inventory` | `authoring-deviation-classes`, `authoring-inventory`, `authoring-spec-format`, `authoring-deviation-classes`, `authoring-extract`, `authoring-inventory`, `authoring-map`, `authoring-spec-format` |
| flag | `spec coverage --channel` | `authoring-inventory`, `authoring-spec-format`, `authoring-inventory`, `authoring-spec-format` |
| flag | `spec coverage --json` | `authoring-inventory`, `authoring-spec-format`, `authoring-gate`, `authoring-inventory`, `authoring-perturbations`, `authoring-prefixes`, `authoring-space-coverage`, `authoring-spec-check`, `authoring-spec-format`, `authoring-users`, `running-campaign-run` |
| command | `campaign rejudge` | `judging-campaign-rejudge`, `judging-judge-options` |
| flag | `campaign rejudge --from` | `judging-campaign-rejudge`, `running-campaign-run` |
| flag | `campaign rejudge --campaign` | `judging-campaign-rejudge`, `running-campaign-run` |
| flag | `campaign rejudge --store` | `judging-campaign-rejudge`, `running-campaign-run` |
| flag | `campaign rejudge --change` | `judging-campaign-rejudge`, `running-campaign-run` |
| flag | `campaign rejudge --max-carry` | `judging-campaign-rejudge`, `running-campaign-run` |
| flag | `campaign rejudge --max-age` | `judging-campaign-rejudge`, `running-campaign-run` |
| flag | `campaign rejudge --record-realized-text` | `judging-campaign-rejudge`, `running-campaign-run` |
| flag | `campaign rejudge --json` | `judging-campaign-rejudge`, `running-campaign-run`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `campaign rejudge --verify` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --prompt-budget` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --judge` | `judging-campaign-rejudge`, `judging-judge-options`, `running-campaign-run`, `judging-criteria`, `judging-default-judge`, `judging-machine-checks`, `judging-run-judge` |
| flag | `campaign rejudge --judge-command` | `judging-campaign-rejudge`, `judging-judge-options`, `running-campaign-run`, `judging-run-judge` |
| flag | `campaign rejudge --judge-budget` | `judging-campaign-rejudge`, `judging-judge-options`, `running-campaign-run`, `judging-run-judge` |
| flag | `campaign rejudge --judges` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --judge-mode` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --assignments` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-run` |
| flag | `campaign rejudge --cascade` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `campaign rejudge --weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --judge-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --route-first` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --route-then` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --route-on` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --route-confidence` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --route-decide` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --panel-weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --panel-margin` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --reference-solve` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --reference-samples` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --reference-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign rejudge --record` | `judging-judge-options`, `running-campaign-run`, `judging-cassettes`, `judging-judge-calibrate` |
| flag | `campaign rejudge --agent-family` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| command | `campaign plan` | `recipes-test-a-code-agent`, `running-budget-and-prices`, `running-campaign-config`, `running-campaign-plan`, `running-cells-and-repeats`, `running-modes`, `running-store`, `running-targets`, `running-targets-from-settings` |
| flag | `campaign plan --target` | `recipes-test-a-code-agent`, `running-campaign-config`, `running-campaign-plan`, `running-cells-and-repeats`, `running-targets`, `running-targets-from-settings`, `core-configuration`, `core-getting-started`, `recipes-test-a-chat-agent`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-cells-and-repeats`, `running-process-and-sandboxes`, `running-simulate`, `running-smoke`, `running-targets`, `running-targets-from-settings` |
| flag | `campaign plan --route` | `running-campaign-config`, `running-campaign-plan`, `running-cells-and-repeats`, `running-targets`, `recipes-test-a-chat-agent`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-run`, `running-cells-and-repeats`, `running-targets` |
| flag | `campaign plan --mode` | `recipes-test-a-code-agent`, `running-campaign-config`, `running-campaign-plan`, `running-cells-and-repeats`, `running-modes`, `core-getting-started`, `recipes-test-a-chat-agent`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-cells-and-repeats`, `running-change-carry`, `running-modes` |
| flag | `campaign plan --repeats` | `running-campaign-config`, `running-campaign-plan`, `running-cells-and-repeats`, `running-modes`, `core-getting-started`, `recipes-test-a-chat-agent`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-cells-and-repeats`, `running-modes` |
| flag | `campaign plan --budget-usd` | `running-budget-and-prices`, `running-campaign-config`, `running-campaign-plan`, `core-configuration`, `running-budget-and-prices`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-simulate` |
| flag | `campaign plan --baseline-rate` | `running-campaign-plan`, `running-campaign-plan` |
| flag | `campaign plan --rho` | `running-campaign-plan`, `running-campaign-plan` |
| flag | `campaign plan --store` | `recipes-test-a-code-agent`, `running-campaign-config`, `running-campaign-plan`, `running-store`, `core-getting-started`, `recipes-test-a-chat-agent`, `running-cache`, `running-campaign-config`, `running-campaign-export-import`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-campaign-status`, `running-change-carry`, `running-store` |
| flag | `campaign plan --json` | `recipes-test-a-code-agent`, `running-campaign-config`, `running-campaign-plan`, `core-getting-started`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-campaign-status`, `running-outcomes`, `running-simulate`, `running-smoke` |
| flag | `campaign plan --config` | `running-budget-and-prices`, `running-campaign-config`, `running-campaign-plan`, `core-configuration`, `running-budget-and-prices`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-plugins` |
| command | `campaign run` | `core-getting-started`, `recipes-benchmark-a-judge`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-red-team-an-agent`, `recipes-rerun-what-a-change-touches`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `recipes-tests-from-past-conversations`, `authoring-blocks`, `authoring-personas`, `authoring-perturbations`, `authoring-users`, `running-budget-and-prices`, `running-cache`, `running-campaign-config`, `running-campaign-run`, `running-cells-and-repeats`, `running-change-carry`, `running-cleanup`, `running-modes`, `running-outcomes`, `running-plugins`, `running-process-and-sandboxes`, `running-recordings`, `running-retries`, `running-sdk-adapters`, `running-store`, `running-targets`, `running-targets-from-settings`, `judging-check-runtime`, `judging-check-text`, `judging-check-tools`, `judging-families`, `judging-machine-checks` |
| flag | `campaign run --dataset` | `recipes-tests-from-past-conversations`, `running-campaign-config`, `running-campaign-run`, `core-configuration`, `recipes-tests-from-past-conversations`, `authoring-prefixes`, `running-campaign-config`, `running-campaign-run` |
| flag | `campaign run --prompt` | `recipes-rerun-what-a-change-touches`, `recipes-test-a-chat-agent`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `running-targets-from-settings`, `recipes-test-a-chat-agent`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `running-targets-from-settings` |
| flag | `campaign run --target` | `core-getting-started`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-red-team-an-agent`, `recipes-rerun-what-a-change-touches`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `recipes-tests-from-past-conversations`, `authoring-personas`, `authoring-perturbations`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-cells-and-repeats`, `running-process-and-sandboxes`, `running-targets`, `running-targets-from-settings`, `core-configuration`, `core-getting-started`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `recipes-tests-from-past-conversations`, `authoring-personas`, `authoring-perturbations`, `authoring-users`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-cells-and-repeats`, `running-not-run`, `running-process-and-sandboxes`, `running-simulate`, `running-smoke`, `running-targets`, `running-targets-from-settings`, `redteam-overview` |
| flag | `campaign run --route` | `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-rerun-what-a-change-touches`, `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `running-campaign-config`, `running-campaign-run`, `running-cells-and-repeats`, `running-targets`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-run`, `running-cells-and-repeats`, `running-targets` |
| flag | `campaign run --mode` | `core-getting-started`, `recipes-benchmark-a-judge`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `recipes-red-team-an-agent`, `recipes-rerun-what-a-change-touches`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-perturbations`, `running-campaign-config`, `running-campaign-run`, `running-cells-and-repeats`, `running-change-carry`, `running-modes`, `core-getting-started`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-perturbations`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-cells-and-repeats`, `running-change-carry`, `running-modes`, `judging-calibration`, `judging-council`, `judging-judge-run` |
| flag | `campaign run --repeats` | `core-getting-started`, `recipes-benchmark-a-judge`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `running-campaign-config`, `running-campaign-run`, `running-cells-and-repeats`, `running-modes`, `core-getting-started`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-cells-and-repeats`, `running-modes`, `judging-calibration` |
| flag | `campaign run --agent-version` | `recipes-compare-two-versions`, `recipes-rerun-what-a-change-touches`, `running-cache`, `running-campaign-config`, `running-campaign-run`, `running-cells-and-repeats`, `running-change-carry`, `running-recordings`, `running-targets`, `recipes-compare-two-versions`, `running-cache`, `running-campaign-config`, `running-campaign-run`, `running-cells-and-repeats`, `running-change-carry`, `running-recordings`, `running-targets` |
| flag | `campaign run --change` | `recipes-rerun-what-a-change-touches`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `core-project-layout`, `running-campaign-config`, `running-campaign-run`, `running-change-carry` |
| flag | `campaign run --from` | `recipes-rerun-what-a-change-touches`, `recipes-tests-from-past-conversations`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `recipes-tests-from-past-conversations`, `authoring-prefixes`, `running-campaign-config`, `running-campaign-run`, `running-change-carry` |
| flag | `campaign run --audit` | `recipes-rerun-what-a-change-touches`, `recipes-tests-from-past-conversations`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `recipes-tests-from-past-conversations`, `running-campaign-config`, `running-campaign-run`, `running-change-carry` |
| flag | `campaign run --audit-seed` | `recipes-rerun-what-a-change-touches`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `running-campaign-config`, `running-campaign-run`, `running-change-carry` |
| flag | `campaign run --max-carry` | `recipes-rerun-what-a-change-touches`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `running-campaign-config`, `running-campaign-run`, `running-change-carry` |
| flag | `campaign run --max-age` | `recipes-rerun-what-a-change-touches`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `running-campaign-config`, `running-campaign-run`, `running-change-carry` |
| flag | `campaign run --block-reruns` | `recipes-rerun-what-a-change-touches`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `running-campaign-config`, `running-campaign-run`, `running-change-carry` |
| flag | `campaign run --record-end-state-snapshots` | `recipes-rerun-what-a-change-touches`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `running-campaign-config`, `running-campaign-run`, `running-change-carry` |
| flag | `campaign run --record-realized-text` | `running-campaign-config`, `running-campaign-run`, `running-campaign-config`, `running-campaign-run`, `running-realized-text` |
| flag | `campaign run --campaign` | `recipes-benchmark-a-judge`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-rerun-what-a-change-touches`, `running-campaign-config`, `running-campaign-run`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `running-campaign-config`, `running-campaign-run` |
| flag | `campaign run --store` | `core-getting-started`, `recipes-benchmark-a-judge`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-red-team-an-agent`, `recipes-rerun-what-a-change-touches`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `recipes-tests-from-past-conversations`, `running-cache`, `running-campaign-config`, `running-campaign-run`, `running-change-carry`, `running-cleanup`, `running-recordings`, `running-store`, `core-getting-started`, `core-project-layout`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `recipes-tests-from-past-conversations`, `authoring-prefixes`, `running-cache`, `running-campaign-config`, `running-campaign-export-import`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-campaign-status`, `running-change-carry`, `running-cleanup`, `running-not-run`, `running-recordings`, `running-store` |
| flag | `campaign run --no-cache` | `recipes-compare-two-versions`, `running-cache`, `running-campaign-config`, `running-campaign-run`, `running-cleanup`, `running-recordings`, `core-configuration`, `recipes-compare-two-versions`, `running-cache`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-cleanup`, `running-recordings` |
| flag | `campaign run --cache-suite` | `running-cache`, `running-campaign-config`, `running-campaign-run`, `running-recordings`, `running-cache`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-recordings` |
| flag | `campaign run --concurrency` | `recipes-gate-in-ci`, `running-campaign-config`, `running-campaign-run`, `running-cells-and-repeats`, `recipes-gate-in-ci`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-cells-and-repeats` |
| flag | `campaign run --budget-usd` | `recipes-gate-in-ci`, `running-budget-and-prices`, `running-campaign-config`, `running-campaign-run`, `core-configuration`, `recipes-gate-in-ci`, `running-budget-and-prices`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-simulate` |
| flag | `campaign run --prices` | `running-budget-and-prices`, `running-campaign-config`, `running-campaign-run`, `core-configuration`, `authoring-prefixes`, `running-budget-and-prices`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run` |
| flag | `campaign run --process-command` | `recipes-test-a-code-agent`, `running-campaign-config`, `running-campaign-run`, `running-process-and-sandboxes`, `running-sdk-adapters`, `running-targets`, `recipes-test-a-code-agent`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-process-and-sandboxes`, `running-sdk-adapters`, `running-targets` |
| flag | `campaign run --driver` | `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-recordings`, `judging-families`, `core-configuration`, `core-project-layout`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-recordings`, `running-simulate` |
| flag | `campaign run --persona` | `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-simulate` |
| flag | `campaign run --recording` | `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-recordings`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-recordings`, `running-simulate` |
| flag | `campaign run --model` | `recipes-red-team-an-agent`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-recordings`, `judging-families`, `core-configuration`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-recordings`, `running-simulate`, `redteam-overview` |
| flag | `campaign run --agent-family` | `recipes-benchmark-a-judge`, `recipes-red-team-an-agent`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `judging-families`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-simulate`, `judging-calibration`, `judging-council`, `judging-judge-run`, `redteam-overview` |
| flag | `campaign run --judge-family` | `recipes-red-team-an-agent`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `judging-families`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-simulate`, `redteam-overview` |
| flag | `campaign run --retry-attempts` | `running-campaign-config`, `running-campaign-run`, `running-retries`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-retries` |
| flag | `campaign run --retry-base-ms` | `running-campaign-config`, `running-campaign-run`, `running-retries`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-retries` |
| flag | `campaign run --retry-max-ms` | `running-campaign-config`, `running-campaign-run`, `running-retries`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-retries` |
| flag | `campaign run --json` | `core-getting-started`, `recipes-benchmark-a-judge`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-red-team-an-agent`, `recipes-rerun-what-a-change-touches`, `recipes-test-a-code-agent`, `authoring-personas`, `authoring-perturbations`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-outcomes`, `core-getting-started`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-code-agent`, `authoring-personas`, `authoring-perturbations`, `authoring-prefixes`, `authoring-spec-check`, `authoring-spec-format`, `authoring-users`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-campaign-status`, `running-outcomes`, `running-simulate`, `running-smoke`, `judging-judge-run`, `redteam-overview` |
| flag | `campaign run --config` | `recipes-gate-in-ci`, `running-budget-and-prices`, `running-campaign-config`, `running-campaign-run`, `running-plugins`, `core-configuration`, `recipes-gate-in-ci`, `running-budget-and-prices`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-plugins` |
| flag | `campaign run --verify` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --prompt-budget` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --judge` | `recipes-find-why-a-test-failed`, `recipes-red-team-an-agent`, `running-campaign-run`, `judging-check-text`, `judging-families`, `judging-machine-checks`, `core-configuration`, `recipes-find-why-a-test-failed`, `running-campaign-run`, `judging-check-text`, `judging-criteria`, `judging-machine-checks`, `judging-run-judge`, `redteam-overview` |
| flag | `campaign run --judge-command` | `running-campaign-run`, `running-campaign-run`, `judging-run-judge` |
| flag | `campaign run --judge-budget` | `recipes-find-why-a-test-failed`, `running-campaign-run`, `recipes-find-why-a-test-failed`, `running-campaign-run`, `judging-run-judge` |
| flag | `campaign run --judges` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --judge-mode` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --assignments` | `recipes-benchmark-a-judge`, `running-campaign-run`, `running-campaign-run`, `judging-calibration`, `judging-council`, `judging-judge-run` |
| flag | `campaign run --cascade` | `recipes-benchmark-a-judge`, `running-campaign-run`, `running-campaign-run`, `judging-calibration`, `judging-council`, `judging-judge-run` |
| flag | `campaign run --weights` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --judge-route` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --route-first` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --route-then` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --route-on` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --route-confidence` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --route-decide` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --panel-weights` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --panel-margin` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --reference-solve` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --reference-samples` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --reference-route` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --record` | `recipes-benchmark-a-judge`, `recipes-red-team-an-agent`, `authoring-users`, `running-campaign-run`, `running-recordings`, `authoring-users`, `running-campaign-run`, `running-recordings`, `redteam-overview` |
| flag | `campaign run --owner` | `running-campaign-run`, `judging-check-text`, `judging-machine-checks`, `running-campaign-run`, `judging-check-text`, `judging-machine-checks` |
| flag | `campaign run --owner-file` | `running-campaign-run`, `judging-check-text`, `judging-machine-checks`, `running-campaign-run`, `judging-check-text`, `judging-machine-checks` |
| flag | `campaign run --tool-policy` | `running-campaign-run`, `running-campaign-run` |
| flag | `campaign run --embedder` | `running-campaign-run`, `running-campaign-run` |
| command | `campaign resume` | `running-budget-and-prices`, `running-cache`, `running-campaign-resume`, `running-cells-and-repeats`, `running-cleanup`, `running-outcomes`, `running-process-and-sandboxes`, `running-retries`, `running-store`, `running-targets`, `judging-judge-options`, `judging-machine-checks` |
| flag | `campaign resume --store` | `running-cache`, `running-campaign-resume`, `running-cleanup`, `running-store`, `running-cache`, `running-campaign-config`, `running-campaign-export-import`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-campaign-status`, `running-change-carry`, `running-cleanup`, `running-not-run`, `running-recordings`, `running-store` |
| flag | `campaign resume --no-cache` | `running-cache`, `running-campaign-resume`, `running-cleanup`, `running-cache`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-cleanup`, `running-recordings` |
| flag | `campaign resume --cache-suite` | `running-cache`, `running-campaign-resume`, `running-cache`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-recordings` |
| flag | `campaign resume --concurrency` | `running-campaign-resume`, `running-cells-and-repeats`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-cells-and-repeats` |
| flag | `campaign resume --budget-usd` | `running-budget-and-prices`, `running-campaign-resume`, `running-budget-and-prices`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run` |
| flag | `campaign resume --prices` | `running-budget-and-prices`, `running-campaign-resume`, `running-budget-and-prices`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run` |
| flag | `campaign resume --process-command` | `running-campaign-resume`, `running-process-and-sandboxes`, `running-targets`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-process-and-sandboxes`, `running-sdk-adapters`, `running-targets` |
| flag | `campaign resume --retry-attempts` | `running-campaign-resume`, `running-retries`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run` |
| flag | `campaign resume --retry-base-ms` | `running-campaign-resume`, `running-retries`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run` |
| flag | `campaign resume --retry-max-ms` | `running-campaign-resume`, `running-retries`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run` |
| flag | `campaign resume --json` | `running-campaign-resume`, `running-outcomes`, `running-campaign-config`, `running-campaign-plan`, `running-campaign-resume`, `running-campaign-run`, `running-campaign-status`, `running-outcomes`, `running-smoke`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `campaign resume --verify` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --prompt-budget` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --judge` | `judging-judge-options`, `judging-machine-checks`, `running-campaign-run`, `judging-check-text`, `judging-criteria`, `judging-run-judge` |
| flag | `campaign resume --judge-command` | `judging-judge-options`, `running-campaign-run`, `judging-run-judge` |
| flag | `campaign resume --judge-budget` | `judging-judge-options`, `running-campaign-run`, `judging-run-judge` |
| flag | `campaign resume --judges` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --judge-mode` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --assignments` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-run` |
| flag | `campaign resume --cascade` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `campaign resume --weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --judge-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --route-first` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --route-then` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --route-on` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --route-confidence` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --route-decide` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --panel-weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --panel-margin` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --reference-solve` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --reference-samples` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --reference-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --record` | `judging-judge-options`, `running-campaign-run`, `running-recordings`, `judging-cassettes`, `judging-judge-calibrate` |
| flag | `campaign resume --agent-family` | `judging-judge-options`, `running-campaign-config`, `running-campaign-run`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `campaign resume --owner` | `judging-judge-options`, `judging-machine-checks`, `running-campaign-run`, `judging-check-text` |
| flag | `campaign resume --owner-file` | `judging-judge-options`, `judging-machine-checks`, `running-campaign-run`, `judging-check-text` |
| flag | `campaign resume --tool-policy` | `judging-judge-options`, `running-campaign-run` |
| flag | `campaign resume --embedder` | `judging-judge-options`, `running-campaign-run` |
| command | `campaign status` | `core-getting-started`, `recipes-find-why-a-test-failed`, `recipes-red-team-an-agent`, `recipes-rerun-what-a-change-touches`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `running-campaign-status`, `running-outcomes`, `running-store` |
| flag | `campaign status --store` | `core-getting-started`, `recipes-find-why-a-test-failed`, `recipes-red-team-an-agent`, `recipes-rerun-what-a-change-touches`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `running-campaign-status`, `running-store`, `core-getting-started`, `core-project-layout`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `running-cache`, `running-campaign-export-import`, `running-campaign-resume`, `running-campaign-run`, `running-campaign-status`, `running-change-carry`, `running-not-run`, `running-store` |
| flag | `campaign status --detail` | `core-getting-started`, `recipes-find-why-a-test-failed`, `recipes-red-team-an-agent`, `recipes-test-a-code-agent`, `running-campaign-status`, `running-outcomes`, `core-getting-started`, `recipes-find-why-a-test-failed`, `running-campaign-status`, `running-outcomes` |
| flag | `campaign status --json` | `core-getting-started`, `recipes-find-why-a-test-failed`, `recipes-red-team-an-agent`, `recipes-rerun-what-a-change-touches`, `recipes-test-a-code-agent`, `running-campaign-status`, `running-outcomes`, `core-getting-started`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `running-campaign-resume`, `running-campaign-run`, `running-campaign-status`, `running-outcomes`, `redteam-overview` |
| command | `campaign export` | `running-campaign-export-import`, `running-store`, `results-exports` |
| flag | `campaign export --store` | `running-campaign-export-import`, `running-store`, `results-exports`, `running-cache`, `running-campaign-export-import`, `running-campaign-resume`, `running-campaign-run`, `running-campaign-status`, `running-store`, `results-ci`, `results-compare`, `results-monitor`, `results-report` |
| flag | `campaign export --out` | `running-campaign-export-import`, `results-exports`, `running-campaign-export-import`, `results-ci`, `results-report` |
| command | `campaign import` | `running-campaign-export-import`, `running-store` |
| flag | `campaign import --store` | `running-campaign-export-import`, `running-store`, `running-cache`, `running-campaign-export-import`, `running-campaign-resume`, `running-campaign-run`, `running-campaign-status`, `running-store` |
| command | `smoke` | `recipes-find-why-a-test-failed`, `running-cleanup`, `running-plugins`, `running-smoke`, `running-targets`, `running-targets-from-settings`, `judging-judge-options`, `judging-machine-checks` |
| flag | `smoke --target` | `recipes-find-why-a-test-failed`, `running-smoke`, `running-targets`, `running-targets-from-settings`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `running-cells-and-repeats`, `running-process-and-sandboxes`, `running-targets`, `running-targets-from-settings` |
| flag | `smoke --runs` | `recipes-find-why-a-test-failed`, `running-smoke` |
| flag | `smoke --json` | `recipes-find-why-a-test-failed`, `running-smoke`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `running-campaign-config`, `running-campaign-resume`, `running-campaign-run`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `smoke --verify` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --prompt-budget` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --judge` | `recipes-find-why-a-test-failed`, `judging-judge-options`, `judging-machine-checks`, `running-campaign-run`, `judging-check-text`, `judging-criteria`, `judging-run-judge` |
| flag | `smoke --judge-command` | `judging-judge-options`, `running-campaign-run`, `judging-run-judge` |
| flag | `smoke --judge-budget` | `recipes-find-why-a-test-failed`, `judging-judge-options`, `running-campaign-run`, `judging-run-judge` |
| flag | `smoke --judges` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --judge-mode` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --assignments` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-run` |
| flag | `smoke --cascade` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `smoke --weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --judge-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --route-first` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --route-then` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --route-on` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --route-confidence` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --route-decide` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --panel-weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --panel-margin` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --reference-solve` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --reference-samples` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --reference-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `smoke --record` | `judging-judge-options`, `running-campaign-run`, `judging-cassettes`, `judging-judge-calibrate` |
| flag | `smoke --agent-family` | `judging-judge-options`, `running-campaign-config`, `running-campaign-run`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| command | `space coverage` | `recipes-test-a-chat-agent`, `authoring-covering-arrays`, `authoring-deviation-classes`, `authoring-map`, `authoring-space-coverage` |
| flag | `space coverage --map` | `recipes-test-a-chat-agent`, `authoring-covering-arrays`, `authoring-deviation-classes`, `authoring-map`, `authoring-space-coverage`, `recipes-tests-from-past-conversations`, `authoring-covering-arrays`, `authoring-deviation-classes`, `authoring-generate`, `authoring-map`, `authoring-space-coverage` |
| flag | `space coverage --t` | `recipes-test-a-chat-agent`, `authoring-covering-arrays`, `authoring-map`, `authoring-space-coverage`, `recipes-tests-from-past-conversations`, `authoring-covering-arrays`, `authoring-generate`, `authoring-map`, `authoring-space-coverage`, `results-select` |
| flag | `space coverage --json` | `authoring-space-coverage`, `core-getting-started`, `authoring-gate`, `authoring-generate`, `authoring-inventory`, `authoring-perturbations`, `authoring-space-coverage`, `authoring-users`, `results-select` |
| command | `space complete` | `authoring-map`, `authoring-space-coverage` |
| flag | `space complete --map` | `authoring-map`, `authoring-space-coverage`, `authoring-covering-arrays`, `authoring-deviation-classes`, `authoring-generate`, `authoring-map`, `authoring-space-coverage` |
| flag | `space complete --t` | `authoring-map`, `authoring-space-coverage`, `authoring-covering-arrays`, `authoring-generate`, `authoring-map`, `authoring-space-coverage` |
| flag | `space complete --json` | `authoring-space-coverage`, `authoring-generate`, `authoring-inventory`, `authoring-space-coverage` |
| command | `space declare` | `authoring-map` |
| flag | `space declare --inventory` | `authoring-map`, `authoring-deviation-classes`, `authoring-extract`, `authoring-inventory` |
| flag | `space declare --out` | `authoring-map`, `authoring-extract`, `authoring-generate` |
| flag | `space declare --agent` | `authoring-map`, `authoring-extract` |
| command | `extract` | `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `extract --prompt` | `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `extract --inventory` | `recipes-test-a-chat-agent`, `authoring-extract`, `authoring-deviation-classes`, `authoring-inventory`, `authoring-map` |
| flag | `extract --tools` | `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `extract --out` | `recipes-test-a-chat-agent`, `authoring-extract`, `recipes-tests-from-past-conversations`, `authoring-generate`, `authoring-map`, `authoring-task-families` |
| flag | `extract --no-model` | `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `extract --provider` | `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `extract --replay` | `authoring-extract`, `recipes-tests-from-past-conversations` |
| flag | `extract --agent` | `authoring-extract`, `authoring-map` |
| flag | `extract --force` | `recipes-test-a-chat-agent`, `authoring-extract`, `authoring-generate`, `authoring-task-families` |
| command | `extract approve` | `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `extract approve --dimension` | `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `extract approve --all` | `recipes-test-a-chat-agent`, `authoring-extract`, `recipes-tests-from-past-conversations` |
| flag | `extract approve --to` | `recipes-test-a-chat-agent`, `authoring-extract` |
| command | `extract map` | `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `extract map --to` | `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `extract map --all` | `recipes-test-a-chat-agent`, `authoring-extract`, `recipes-tests-from-past-conversations` |
| command | `generate` | `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `authoring-covering-arrays`, `authoring-generate` |
| flag | `generate --map` | `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `authoring-covering-arrays`, `authoring-generate`, `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `authoring-covering-arrays`, `authoring-generate`, `authoring-map`, `authoring-space-coverage` |
| flag | `generate --out` | `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `authoring-generate`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `recipes-tests-from-past-conversations`, `authoring-extract`, `authoring-gate`, `authoring-generate`, `authoring-map`, `authoring-task-families`, `results-select` |
| flag | `generate --t` | `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `authoring-covering-arrays`, `authoring-generate`, `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `authoring-covering-arrays`, `authoring-generate`, `authoring-map`, `authoring-space-coverage`, `results-select` |
| flag | `generate --seed` | `recipes-test-a-chat-agent`, `authoring-covering-arrays`, `authoring-generate`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-covering-arrays`, `authoring-gate`, `authoring-generate`, `authoring-task-families` |
| flag | `generate --max` | `authoring-covering-arrays`, `authoring-generate`, `authoring-covering-arrays`, `authoring-generate` |
| flag | `generate --budget` | `authoring-covering-arrays`, `authoring-generate`, `authoring-covering-arrays`, `authoring-generate` |
| flag | `generate --spec-cap` | `authoring-covering-arrays`, `authoring-generate`, `authoring-covering-arrays`, `authoring-generate` |
| flag | `generate --spec-cap-mode` | `authoring-covering-arrays`, `authoring-generate`, `authoring-covering-arrays`, `authoring-generate` |
| flag | `generate --tasks` | `authoring-generate`, `authoring-generate` |
| flag | `generate --baseline` | `authoring-generate`, `authoring-generate` |
| flag | `generate --force` | `recipes-test-a-chat-agent`, `authoring-generate`, `recipes-test-a-chat-agent`, `authoring-extract`, `authoring-gate`, `authoring-generate`, `authoring-task-families`, `results-select` |
| flag | `generate --json` | `authoring-generate`, `core-getting-started`, `recipes-test-a-code-agent`, `authoring-gate`, `authoring-generate`, `authoring-space-coverage`, `authoring-task-families`, `results-select` |
| flag | `generate --model` | `authoring-generate`, `core-configuration`, `authoring-generate` |
| flag | `generate --proposals` | `authoring-generate`, `authoring-generate` |
| flag | `generate --reference` | `recipes-tests-from-past-conversations`, `authoring-generate`, `recipes-test-a-code-agent`, `recipes-tests-from-past-conversations`, `authoring-gate`, `authoring-generate`, `authoring-task-families` |
| flag | `generate --faults` | `recipes-tests-from-past-conversations`, `authoring-generate`, `recipes-tests-from-past-conversations`, `authoring-gate`, `authoring-generate` |
| flag | `generate --k` | `recipes-tests-from-past-conversations`, `authoring-generate`, `recipes-tests-from-past-conversations`, `authoring-gate`, `authoring-generate`, `results-select` |
| command | `intake logs` | `recipes-tests-from-past-conversations`, `authoring-intake` |
| flag | `intake logs --out` | `recipes-tests-from-past-conversations`, `authoring-intake`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-extract`, `authoring-import`, `authoring-map` |
| flag | `intake logs --map` | `recipes-tests-from-past-conversations`, `authoring-intake`, `recipes-test-a-chat-agent`, `authoring-map` |
| flag | `intake logs --intent-dimension` | `recipes-tests-from-past-conversations`, `authoring-intake` |
| flag | `intake logs --second-pass` | `recipes-tests-from-past-conversations`, `authoring-intake` |
| flag | `intake logs --provider` | `authoring-intake`, `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `intake logs --spot-check` | `authoring-intake` |
| flag | `intake logs --seed` | `authoring-intake`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-users` |
| flag | `intake logs --dedup` | `authoring-intake` |
| flag | `intake logs --intent-threshold` | `authoring-intake` |
| flag | `intake logs --cluster-threshold` | `authoring-intake` |
| flag | `intake logs --force` | `authoring-intake`, `recipes-test-a-chat-agent`, `authoring-extract`, `authoring-import` |
| command | `intake interview` | `recipes-tests-from-past-conversations`, `authoring-intake` |
| flag | `intake interview --map` | `recipes-tests-from-past-conversations`, `authoring-intake`, `recipes-test-a-chat-agent`, `authoring-map` |
| flag | `intake interview --out` | `recipes-tests-from-past-conversations`, `authoring-intake`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-extract`, `authoring-import`, `authoring-map` |
| flag | `intake interview --force` | `authoring-intake`, `recipes-test-a-chat-agent`, `authoring-extract`, `authoring-import` |
| command | `intake from-interview` | `recipes-tests-from-past-conversations`, `authoring-intake` |
| flag | `intake from-interview --map` | `recipes-tests-from-past-conversations`, `authoring-intake`, `recipes-test-a-chat-agent`, `authoring-map` |
| flag | `intake from-interview --out` | `recipes-tests-from-past-conversations`, `authoring-intake`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-extract`, `authoring-import`, `authoring-map` |
| flag | `intake from-interview --replay` | `recipes-tests-from-past-conversations`, `authoring-intake`, `authoring-extract`, `authoring-users` |
| flag | `intake from-interview --provider` | `authoring-intake`, `recipes-test-a-chat-agent`, `authoring-extract` |
| flag | `intake from-interview --turns` | `recipes-tests-from-past-conversations`, `authoring-intake`, `authoring-personas`, `authoring-users` |
| flag | `intake from-interview --min-per-cell` | `authoring-intake` |
| flag | `intake from-interview --max-cells` | `authoring-intake` |
| flag | `intake from-interview --dry-run` | `recipes-tests-from-past-conversations`, `authoring-intake` |
| flag | `intake from-interview --force` | `authoring-intake`, `recipes-test-a-chat-agent`, `authoring-extract`, `authoring-import` |
| command | `intake fidelity` | `authoring-intake` |
| flag | `intake fidelity --reference` | `authoring-intake` |
| flag | `intake fidelity --candidate` | `authoring-intake` |
| flag | `intake fidelity --dims` | `authoring-intake` |
| flag | `intake fidelity --threshold` | `authoring-intake` |
| flag | `intake fidelity --include-unapproved` | `authoring-intake` |
| flag | `intake fidelity --json` | `authoring-intake`, `authoring-import`, `authoring-personas`, `authoring-users` |
| command | `intake approve` | `recipes-tests-from-past-conversations`, `authoring-intake` |
| flag | `intake approve --all` | `recipes-tests-from-past-conversations`, `authoring-intake`, `recipes-test-a-chat-agent`, `authoring-extract`, `authoring-import` |
| command | `estate scan` | `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate scan --runtime` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-loop`, `validate-estate-scan`, `validate-estate-unit` |
| flag | `estate scan --out` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-generate`, `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-plan`, `validate-estate-scan` |
| flag | `estate scan --replay` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-scan` |
| flag | `estate scan --no-model` | `validate-estate-scan`, `validate-estate-scan` |
| flag | `estate scan --provider` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate scan --ceiling` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-generate`, `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate scan --ignore` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate scan --force` | `validate-estate-scan`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-plan`, `validate-estate-scan` |
| command | `estate lint` | `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate lint --ceiling` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-generate`, `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate lint --ignore` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-loop`, `validate-estate-scan` |
| command | `estate approve` | `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate approve --kind` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate approve --atom` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-live`, `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate approve --all` | `validate-estate-scan`, `validate-estate-plan`, `validate-estate-scan` |
| flag | `estate approve --to` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-live`, `validate-estate-loop`, `validate-estate-scan` |
| command | `estate map` | `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate map --to` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-live`, `validate-estate-loop`, `validate-estate-scan` |
| flag | `estate map --all` | `validate-estate-scan`, `validate-estate-plan`, `validate-estate-scan` |
| flag | `estate map --agent` | `validate-estate-loop`, `validate-estate-scan`, `validate-estate-loop`, `validate-estate-scan` |
| command | `estate plan` | `validate-estate-loop`, `validate-estate-plan` |
| flag | `estate plan --out` | `validate-estate-loop`, `validate-estate-plan`, `validate-estate-generate`, `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-plan`, `validate-estate-scan` |
| flag | `estate plan --t` | `validate-estate-loop`, `validate-estate-plan`, `validate-estate-loop`, `validate-estate-plan` |
| flag | `estate plan --space` | `validate-estate-loop`, `validate-estate-plan`, `validate-estate-loop`, `validate-estate-plan` |
| flag | `estate plan --k` | `validate-estate-loop`, `validate-estate-plan`, `validate-estate-loop`, `validate-estate-plan` |
| flag | `estate plan --force` | `validate-estate-plan`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-plan`, `validate-estate-scan` |
| command | `estate plan approve` | `validate-estate-loop`, `validate-estate-plan` |
| flag | `estate plan approve --all` | `validate-estate-plan`, `validate-estate-plan`, `validate-estate-scan` |
| flag | `estate plan approve --row` | `validate-estate-loop`, `validate-estate-plan`, `validate-estate-loop`, `validate-estate-plan` |
| flag | `estate plan approve --strike` | `validate-estate-plan`, `validate-estate-plan` |
| flag | `estate plan approve --out` | `validate-estate-loop`, `validate-estate-plan`, `validate-estate-generate`, `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-plan`, `validate-estate-scan` |
| command | `estate diff` | `validate-estate-loop`, `validate-estate-maintain` |
| flag | `estate diff --json` | `validate-estate-maintain`, `validate-estate`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay`, `validate-estate-stats`, `validate-estate-unit` |
| flag | `estate diff --out` | `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-generate`, `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-plan`, `validate-estate-scan` |
| flag | `estate diff --old-guards` | `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-loop`, `validate-estate-maintain` |
| flag | `estate diff --new-guards` | `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-loop`, `validate-estate-maintain` |
| command | `estate impact` | `validate-estate-loop`, `validate-estate-maintain` |
| flag | `estate impact --tests` | `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-loop`, `validate-estate-maintain` |
| flag | `estate impact --write` | `validate-estate-maintain`, `validate-estate-maintain` |
| flag | `estate impact --json` | `validate-estate-maintain`, `validate-estate`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay`, `validate-estate-stats`, `validate-estate-unit` |
| flag | `estate impact --out` | `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-generate`, `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-plan`, `validate-estate-scan` |
| flag | `estate impact --replay` | `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-scan` |
| flag | `estate impact --suite` | `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-replay` |
| flag | `estate impact --store` | `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-live`, `validate-estate-loop`, `validate-estate-maintain`, `validate-estate-replay` |
| command | `estate generate` | `validate-estate-generate`, `validate-estate-loop` |
| flag | `estate generate --map` | `validate-estate-generate`, `validate-estate-loop`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-stats` |
| flag | `estate generate --plan` | `validate-estate-generate`, `validate-estate-loop`, `validate-estate-generate`, `validate-estate-stats` |
| flag | `estate generate --out` | `validate-estate-generate`, `validate-estate-loop`, `validate-estate-generate`, `validate-estate-maintain`, `validate-estate-plan`, `validate-estate-scan` |
| flag | `estate generate --seed` | `validate-estate-generate`, `validate-estate-loop`, `validate-estate`, `validate-estate-generate` |
| flag | `estate generate --phrases` | `validate-estate-generate`, `validate-estate-loop`, `validate-estate-generate` |
| flag | `estate generate --sessions` | `validate-estate-generate`, `validate-estate-loop`, `validate-estate-generate`, `validate-estate-stats` |
| flag | `estate generate --no-fallback` | `validate-estate-generate`, `validate-estate-generate` |
| flag | `estate generate --no-judge` | `validate-estate-generate`, `validate-estate-generate` |
| flag | `estate generate --focus` | `validate-estate-generate`, `validate-estate-loop`, `validate-estate-generate` |
| flag | `estate generate --force` | `validate-estate-generate`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-plan`, `validate-estate-scan` |
| flag | `estate generate --json` | `validate-estate-generate`, `validate-estate`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay`, `validate-estate-stats`, `validate-estate-unit` |
| command | `estate mutate` | `validate-estate-live`, `validate-estate-loop` |
| flag | `estate mutate --atom` | `validate-estate-live`, `validate-estate-loop`, `validate-estate-live`, `validate-estate-scan` |
| flag | `estate mutate --delete` | `validate-estate-live`, `validate-estate-loop`, `validate-estate-live` |
| flag | `estate mutate --invert` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate mutate --to` | `validate-estate-live`, `validate-estate-loop`, `validate-estate-live`, `validate-estate-scan` |
| flag | `estate mutate --force` | `validate-estate-live`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-plan`, `validate-estate-scan` |
| flag | `estate mutate --json` | `validate-estate-live`, `validate-estate`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay`, `validate-estate-stats`, `validate-estate-unit`, `validate-mutants-and-rulings` |
| command | `estate run` | `judging-check-runtime`, `judging-default-judge`, `judging-judge-options`, `judging-machine-checks`, `judging-run-judge`, `validate-estate-live`, `validate-estate-loop` |
| flag | `estate run --order` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --estate` | `validate-estate-live`, `validate-estate-loop`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-unit` |
| flag | `estate run --runtime` | `validate-estate-live`, `validate-estate-loop`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-scan`, `validate-estate-unit` |
| flag | `estate run --command` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --store` | `validate-estate-live`, `validate-estate-loop`, `running-campaign-run`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay` |
| flag | `estate run --map` | `validate-estate-live`, `validate-estate-loop`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-stats` |
| flag | `estate run --states` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --set-env` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --disallow` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --lock-deny` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --pass-env` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --timeout` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --model` | `validate-estate-live`, `running-campaign-run`, `judging-families`, `validate-estate-live` |
| flag | `estate run --max-turns` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --max-budget-usd` | `judging-run-judge`, `validate-estate-live`, `judging-run-judge`, `validate-estate-live` |
| flag | `estate run --permission-mode` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --trust-estate` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --config` | `validate-estate-live`, `running-campaign-run`, `validate-estate-live` |
| flag | `estate run --allow-billed` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --progress` | `validate-estate-live`, `validate-estate-live` |
| flag | `estate run --json` | `validate-estate-live`, `running-campaign-run`, `judging-judge-calibrate`, `judging-judge-run`, `validate-estate`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay`, `validate-estate-stats`, `validate-estate-unit`, `validate-mutants-and-rulings` |
| flag | `estate run --verify` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --prompt-budget` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --judge` | `judging-default-judge`, `judging-judge-options`, `judging-machine-checks`, `judging-run-judge`, `validate-estate-live`, `validate-estate-loop`, `running-campaign-run`, `judging-check-text`, `judging-criteria`, `judging-default-judge`, `judging-evidence`, `judging-families`, `judging-machine-checks`, `judging-run-judge`, `validate-estate-live`, `validate-estate-replay` |
| flag | `estate run --judge-command` | `judging-judge-options`, `judging-run-judge`, `validate-estate-live`, `validate-estate-loop`, `running-campaign-run`, `judging-run-judge`, `validate-estate-live`, `validate-estate-replay` |
| flag | `estate run --judge-budget` | `judging-judge-options`, `judging-run-judge`, `validate-estate-live`, `validate-estate-loop`, `running-campaign-run`, `judging-run-judge`, `validate-estate-live`, `validate-estate-replay` |
| flag | `estate run --judges` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --judge-mode` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --assignments` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-run` |
| flag | `estate run --cascade` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `estate run --weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --judge-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --route-first` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --route-then` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --route-on` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --route-confidence` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --route-decide` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --panel-weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --panel-margin` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --reference-solve` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --reference-samples` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --reference-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --record` | `judging-judge-options`, `running-campaign-run`, `judging-cassettes`, `judging-judge-calibrate`, `validate-estate-unit` |
| flag | `estate run --agent-family` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-families`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `estate run --owner` | `judging-judge-options`, `judging-machine-checks`, `validate-estate-loop`, `running-campaign-run`, `judging-check-text`, `judging-machine-checks`, `validate-estate-replay` |
| flag | `estate run --owner-file` | `judging-judge-options`, `judging-machine-checks`, `validate-estate-loop`, `running-campaign-run`, `judging-check-text`, `judging-machine-checks`, `validate-estate-replay` |
| flag | `estate run --tool-policy` | `judging-judge-options`, `running-campaign-run` |
| flag | `estate run --embedder` | `judging-judge-options`, `running-campaign-run` |
| command | `estate static` | `validate-estate-generate`, `validate-estate-loop` |
| flag | `estate static --estate` | `validate-estate-generate`, `validate-estate-loop`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-unit` |
| flag | `estate static --runtime` | `validate-estate-generate`, `validate-estate-loop`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-scan`, `validate-estate-unit` |
| flag | `estate static --ceiling` | `validate-estate-generate`, `validate-estate-loop`, `validate-estate-generate`, `validate-estate-scan` |
| flag | `estate static --json` | `validate-estate-generate`, `validate-estate`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay`, `validate-estate-stats`, `validate-estate-unit` |
| command | `estate stats` | `validate-estate-loop`, `validate-estate-stats` |
| flag | `estate stats --map` | `validate-estate-loop`, `validate-estate-stats`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-stats` |
| flag | `estate stats --plan` | `validate-estate-loop`, `validate-estate-stats`, `validate-estate-generate`, `validate-estate-stats` |
| flag | `estate stats --specs` | `validate-estate-loop`, `validate-estate-stats`, `validate-estate-stats` |
| flag | `estate stats --sessions` | `validate-estate-loop`, `validate-estate-stats`, `validate-estate-generate`, `validate-estate-stats` |
| flag | `estate stats --json` | `validate-estate-stats`, `validate-estate`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay`, `validate-estate-stats`, `validate-estate-unit` |
| command | `estate unit` | `validate-estate-loop`, `validate-estate-unit` |
| flag | `estate unit --estate` | `validate-estate-loop`, `validate-estate-unit`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-unit` |
| flag | `estate unit --runtime` | `validate-estate-loop`, `validate-estate-unit`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-scan`, `validate-estate-unit` |
| flag | `estate unit --record` | `validate-estate-unit`, `validate-estate-unit` |
| flag | `estate unit --no-sandbox` | `validate-estate-unit`, `validate-estate-unit` |
| flag | `estate unit --jobs` | `validate-estate-loop`, `validate-estate-unit`, `validate-estate-unit` |
| flag | `estate unit --json` | `validate-estate-unit`, `validate-estate`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay`, `validate-estate-stats`, `validate-estate-unit` |
| command | `replay` | `recipes-find-why-a-test-failed`, `judging-check-runtime`, `judging-check-text`, `judging-check-tools`, `judging-default-judge`, `judging-judge-options`, `judging-machine-checks`, `judging-run-judge`, `validate-estate-loop`, `validate-estate-replay` |
| flag | `replay --suite` | `recipes-find-why-a-test-failed`, `judging-run-judge`, `validate-estate-loop`, `validate-estate-replay`, `judging-run-judge`, `validate-estate-maintain`, `validate-estate-replay` |
| flag | `replay --decisions` | `recipes-find-why-a-test-failed`, `validate-estate-loop`, `validate-estate-replay`, `validate-estate-replay` |
| flag | `replay --steps` | `recipes-find-why-a-test-failed`, `validate-estate-loop`, `validate-estate-replay`, `validate-estate-replay` |
| flag | `replay --store` | `recipes-find-why-a-test-failed`, `validate-estate-loop`, `validate-estate-replay`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `running-campaign-run`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay` |
| flag | `replay --owner` | `judging-check-text`, `judging-judge-options`, `judging-machine-checks`, `validate-estate-loop`, `validate-estate-replay`, `running-campaign-run`, `judging-check-text`, `judging-machine-checks`, `validate-estate-replay` |
| flag | `replay --owner-file` | `judging-check-text`, `judging-judge-options`, `judging-machine-checks`, `validate-estate-loop`, `validate-estate-replay`, `running-campaign-run`, `judging-check-text`, `judging-machine-checks`, `validate-estate-replay` |
| flag | `replay --json` | `recipes-find-why-a-test-failed`, `validate-estate-replay`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `running-campaign-run`, `judging-judge-calibrate`, `judging-judge-run`, `validate-estate`, `validate-estate-generate`, `validate-estate-live`, `validate-estate-maintain`, `validate-estate-replay`, `validate-estate-stats`, `validate-estate-unit` |
| flag | `replay --verify` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --prompt-budget` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --judge` | `recipes-find-why-a-test-failed`, `judging-check-text`, `judging-default-judge`, `judging-judge-options`, `judging-machine-checks`, `judging-run-judge`, `validate-estate-loop`, `validate-estate-replay`, `running-campaign-run`, `judging-check-text`, `judging-criteria`, `judging-default-judge`, `judging-evidence`, `judging-families`, `judging-machine-checks`, `judging-run-judge`, `validate-estate-live`, `validate-estate-replay` |
| flag | `replay --judge-command` | `judging-judge-options`, `judging-run-judge`, `validate-estate-loop`, `validate-estate-replay`, `running-campaign-run`, `judging-run-judge`, `validate-estate-live`, `validate-estate-replay` |
| flag | `replay --judge-budget` | `recipes-find-why-a-test-failed`, `judging-judge-options`, `judging-run-judge`, `validate-estate-loop`, `validate-estate-replay`, `running-campaign-run`, `judging-run-judge`, `validate-estate-live`, `validate-estate-replay` |
| flag | `replay --judges` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --judge-mode` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --assignments` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-run` |
| flag | `replay --cascade` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `replay --weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --judge-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --route-first` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --route-then` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --route-on` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --route-confidence` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --route-decide` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --panel-weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --panel-margin` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --reference-solve` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --reference-samples` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --reference-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --record` | `judging-judge-options`, `running-campaign-run`, `judging-cassettes`, `judging-judge-calibrate`, `validate-estate-unit` |
| flag | `replay --agent-family` | `judging-judge-options`, `running-campaign-run`, `judging-council`, `judging-families`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `replay --tool-policy` | `judging-judge-options`, `running-campaign-run` |
| flag | `replay --embedder` | `judging-judge-options`, `running-campaign-run` |
| command | `gate` | `recipes-tests-from-past-conversations`, `authoring-gate`, `judging-families` |
| flag | `gate --reference` | `recipes-tests-from-past-conversations`, `authoring-gate`, `recipes-test-a-code-agent`, `authoring-generate`, `authoring-task-families` |
| flag | `gate --faults` | `recipes-tests-from-past-conversations`, `authoring-gate`, `authoring-generate` |
| flag | `gate --out` | `recipes-tests-from-past-conversations`, `authoring-gate`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-generate`, `authoring-task-families`, `results-holdout`, `results-select` |
| flag | `gate --k` | `recipes-tests-from-past-conversations`, `authoring-gate`, `authoring-generate`, `results-select` |
| flag | `gate --route` | `recipes-tests-from-past-conversations`, `authoring-gate`, `recipes-test-a-chat-agent` |
| flag | `gate --origin` | `recipes-tests-from-past-conversations`, `authoring-gate` |
| flag | `gate --judge-family` | `authoring-gate`, `judging-families` |
| flag | `gate --seed` | `authoring-gate`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-covering-arrays`, `authoring-deviation-classes`, `authoring-generate`, `authoring-task-families`, `results-holdout` |
| flag | `gate --holdout` | `recipes-tests-from-past-conversations`, `authoring-gate` |
| flag | `gate --audit` | `recipes-tests-from-past-conversations`, `authoring-gate` |
| flag | `gate --overlap` | `authoring-gate` |
| flag | `gate --date` | `recipes-tests-from-past-conversations`, `authoring-gate` |
| flag | `gate --concurrency` | `authoring-gate`, `authoring-task-families` |
| flag | `gate --force` | `authoring-gate`, `recipes-test-a-chat-agent`, `authoring-generate`, `authoring-task-families`, `results-holdout`, `results-select` |
| flag | `gate --json` | `authoring-gate`, `recipes-test-a-code-agent`, `authoring-generate`, `authoring-task-families`, `judging-judge-run`, `results-holdout`, `results-select` |
| command | `family instances` | `recipes-test-a-code-agent`, `authoring-task-families`, `running-family` |
| flag | `family instances --n` | `recipes-test-a-code-agent`, `authoring-task-families`, `running-family` |
| flag | `family instances --seed` | `recipes-test-a-code-agent`, `authoring-task-families`, `running-family`, `recipes-test-a-chat-agent`, `authoring-deviation-classes`, `authoring-generate`, `authoring-perturbations` |
| flag | `family instances --out` | `recipes-test-a-code-agent`, `authoring-task-families`, `running-family`, `recipes-test-a-chat-agent`, `authoring-generate`, `authoring-map` |
| flag | `family instances --force` | `authoring-task-families`, `running-family`, `recipes-test-a-chat-agent`, `authoring-generate` |
| flag | `family instances --json` | `recipes-test-a-code-agent`, `authoring-task-families`, `running-family`, `core-getting-started`, `authoring-generate`, `authoring-perturbations`, `authoring-spec-format`, `running-campaign-run` |
| command | `family verify` | `recipes-test-a-code-agent`, `authoring-task-families`, `running-family` |
| flag | `family verify --reference` | `recipes-test-a-code-agent`, `authoring-task-families`, `running-family`, `authoring-generate` |
| flag | `family verify --concurrency` | `authoring-task-families`, `running-family`, `running-campaign-run`, `running-cells-and-repeats` |
| flag | `family verify --json` | `recipes-test-a-code-agent`, `authoring-task-families`, `running-family`, `core-getting-started`, `authoring-generate`, `authoring-perturbations`, `authoring-spec-format`, `running-campaign-run` |
| command | `family review` | `recipes-test-a-code-agent`, `authoring-task-families`, `running-family` |
| flag | `family review --write` | `authoring-task-families`, `running-family` |
| flag | `family review --json` | `recipes-test-a-code-agent`, `authoring-task-families`, `running-family`, `core-getting-started`, `authoring-generate`, `authoring-perturbations`, `authoring-spec-format`, `running-campaign-run` |
| command | `pilot plan` | `running-pilot` |
| flag | `pilot plan --map` | `running-pilot` |
| flag | `pilot plan --suite` | `running-pilot` |
| flag | `pilot plan --conversations` | `running-pilot` |
| flag | `pilot plan --repeats` | `running-pilot`, `running-campaign-plan`, `running-cells-and-repeats` |
| flag | `pilot plan --wordings` | `running-pilot` |
| flag | `pilot plan --by` | `running-pilot` |
| flag | `pilot plan --target` | `running-pilot`, `running-campaign-plan`, `running-cells-and-repeats`, `running-targets` |
| flag | `pilot plan --store` | `running-pilot`, `running-campaign-plan`, `running-store` |
| flag | `pilot plan --json` | `running-pilot`, `running-campaign-plan` |
| command | `pilot run` | `running-pilot` |
| flag | `pilot run --map` | `running-pilot` |
| flag | `pilot run --suite` | `running-pilot` |
| flag | `pilot run --conversations` | `running-pilot` |
| flag | `pilot run --repeats` | `running-pilot`, `running-campaign-plan`, `running-cells-and-repeats` |
| flag | `pilot run --wordings` | `running-pilot` |
| flag | `pilot run --by` | `running-pilot` |
| flag | `pilot run --floor` | `running-pilot` |
| flag | `pilot run --pool` | `running-pilot` |
| flag | `pilot run --iterations` | `running-pilot` |
| flag | `pilot run --seed` | `running-pilot` |
| flag | `pilot run --sensitivity` | `running-pilot` |
| flag | `pilot run --resample` | `running-pilot` |
| flag | `pilot run --out` | `running-pilot` |
| flag | `pilot run --json` | `running-pilot`, `running-campaign-plan` |
| flag | `pilot run --target` | `running-pilot`, `running-campaign-plan`, `running-cells-and-repeats`, `running-targets` |
| flag | `pilot run --store` | `running-pilot`, `running-campaign-plan`, `running-store` |
| flag | `pilot run --concurrency` | `running-pilot`, `running-cells-and-repeats` |
| flag | `pilot run --campaign` | `running-pilot` |
| command | `pilot analyse` | `running-pilot` |
| flag | `pilot analyse --floor` | `running-pilot` |
| flag | `pilot analyse --pool` | `running-pilot` |
| flag | `pilot analyse --iterations` | `running-pilot` |
| flag | `pilot analyse --seed` | `running-pilot` |
| flag | `pilot analyse --sensitivity` | `running-pilot` |
| flag | `pilot analyse --resample` | `running-pilot` |
| flag | `pilot analyse --out` | `running-pilot` |
| flag | `pilot analyse --json` | `running-pilot`, `running-campaign-plan` |
| flag | `pilot analyse --store` | `running-pilot`, `running-campaign-plan`, `running-store` |
| command | `perturb` | `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview` |
| flag | `perturb --class` | `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview` |
| flag | `perturb --at` | `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview` |
| flag | `perturb --perturbation` | `recipes-red-team-an-agent`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview` |
| flag | `perturb --target` | `recipes-red-team-an-agent`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `authoring-perturbations`, `authoring-users`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugins` |
| flag | `perturb --faults` | `recipes-red-team-an-agent`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `authoring-gate`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview` |
| flag | `perturb --seed` | `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `authoring-deviation-classes`, `authoring-gate`, `authoring-perturbations`, `authoring-users`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugins` |
| flag | `perturb --pack` | `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `authoring-users`, `redteam-attack`, `redteam-indirect`, `redteam-overview` |
| flag | `perturb --drafts` | `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `authoring-users`, `redteam-attack`, `redteam-indirect`, `redteam-overview` |
| flag | `perturb --json` | `recipes-red-team-an-agent`, `authoring-perturbations`, `redteam-indirect`, `redteam-overview`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `authoring-gate`, `authoring-inventory`, `authoring-perturbations`, `authoring-prefixes`, `authoring-spec-format`, `authoring-users`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugins` |
| command | `simulate` | `authoring-personas`, `authoring-users`, `running-recordings`, `running-simulate`, `running-targets`, `judging-families` |
| flag | `simulate --persona` | `authoring-personas`, `authoring-users`, `running-simulate`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-simulate` |
| flag | `simulate --target` | `authoring-personas`, `authoring-users`, `running-simulate`, `running-targets`, `authoring-personas`, `authoring-perturbations`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-cells-and-repeats`, `running-process-and-sandboxes`, `running-simulate`, `running-smoke`, `running-targets-from-settings` |
| flag | `simulate --turns` | `authoring-personas`, `authoring-users`, `running-simulate`, `authoring-personas`, `authoring-users`, `running-simulate` |
| flag | `simulate --model` | `authoring-personas`, `authoring-users`, `running-recordings`, `running-simulate`, `judging-families`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-recordings`, `running-simulate` |
| flag | `simulate --recording` | `authoring-personas`, `authoring-users`, `running-recordings`, `running-simulate`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-recordings`, `running-simulate` |
| flag | `simulate --agent-family` | `authoring-personas`, `authoring-users`, `running-simulate`, `judging-families`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-simulate`, `judging-calibration`, `judging-council`, `judging-judge-run` |
| flag | `simulate --judge-family` | `authoring-personas`, `authoring-users`, `running-simulate`, `judging-families`, `authoring-personas`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-simulate` |
| flag | `simulate --json` | `authoring-personas`, `authoring-users`, `running-simulate`, `authoring-personas`, `authoring-perturbations`, `authoring-spec-format`, `authoring-users`, `running-campaign-config`, `running-campaign-run`, `running-simulate`, `running-smoke`, `judging-judge-run` |
| command | `attack` | `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-users`, `judging-families`, `redteam-attack`, `redteam-overview` |
| flag | `attack --target` | `recipes-red-team-an-agent`, `authoring-users`, `redteam-attack`, `redteam-overview`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `authoring-personas`, `authoring-perturbations`, `authoring-users`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugins` |
| flag | `attack --rounds` | `recipes-red-team-an-agent`, `authoring-users`, `redteam-attack`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-users`, `redteam-attack`, `redteam-overview` |
| flag | `attack --seed` | `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-users`, `redteam-attack`, `redteam-overview`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `authoring-deviation-classes`, `authoring-gate`, `authoring-perturbations`, `authoring-users`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugins` |
| flag | `attack --pack` | `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-users`, `redteam-attack`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `authoring-users`, `redteam-attack`, `redteam-indirect`, `redteam-overview` |
| flag | `attack --drafts` | `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-users`, `redteam-attack`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-deviation-classes`, `authoring-perturbations`, `authoring-users`, `redteam-attack`, `redteam-indirect`, `redteam-overview` |
| flag | `attack --record` | `recipes-red-team-an-agent`, `authoring-users`, `redteam-attack`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-users`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugins` |
| flag | `attack --replay` | `recipes-red-team-an-agent`, `authoring-users`, `redteam-attack`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-users`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview` |
| flag | `attack --model` | `recipes-red-team-an-agent`, `authoring-users`, `judging-families`, `redteam-attack`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-personas`, `authoring-users`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugins` |
| flag | `attack --agent-family` | `recipes-red-team-an-agent`, `authoring-users`, `judging-families`, `redteam-attack`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-personas`, `authoring-users`, `judging-calibration`, `judging-council`, `judging-judge-run`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-plugins` |
| flag | `attack --judge-family` | `recipes-red-team-an-agent`, `authoring-users`, `judging-families`, `redteam-attack`, `redteam-overview`, `recipes-red-team-an-agent`, `authoring-gate`, `authoring-personas`, `authoring-users`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-plugins` |
| flag | `attack --json` | `recipes-red-team-an-agent`, `authoring-users`, `redteam-attack`, `redteam-overview`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `authoring-gate`, `authoring-inventory`, `authoring-personas`, `authoring-perturbations`, `authoring-spec-format`, `authoring-users`, `judging-judge-run`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugins` |
| command | `redteam run` | `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --strategy` | `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --objective` | `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --target` | `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugins` |
| flag | `redteam run --turns` | `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --model` | `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugins` |
| flag | `redteam run --replay` | `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview` |
| flag | `redteam run --record` | `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugins` |
| flag | `redteam run --seed` | `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `authoring-deviation-classes`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugins` |
| flag | `redteam run --success-score` | `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --success-confirm-turns` | `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `core-exit-codes`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --encoding-probability` | `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --no-score-responses` | `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --no-detect-refusals` | `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --attack-plan` | `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --max-tokens` | `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-crescendo`, `redteam-goat`, `redteam-overview` |
| flag | `redteam run --json` | `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugins` |
| flag | `redteam run --agent-family` | `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-plugins` |
| flag | `redteam run --judge-family` | `recipes-red-team-an-agent`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-plugins` |
| command | `redteam plugins` | `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins` |
| flag | `redteam plugins --json` | `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| command | `redteam generate` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins` |
| flag | `redteam generate --purpose` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam generate --out` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam generate --model` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam generate --attack-file` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam generate --seed` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `authoring-deviation-classes`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam generate --json` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam generate --agent-family` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam generate --judge-family` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| command | `redteam grade` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins` |
| flag | `redteam grade --target` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam grade --judge` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam grade --cassette` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam grade --judge-id` | `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam grade --record` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam grade --agent-family` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| flag | `redteam grade --json` | `recipes-red-team-an-agent`, `redteam-overview`, `redteam-plugin-ascii-smuggling`, `redteam-plugin-bfla`, `redteam-plugin-bola`, `redteam-plugin-context-compliance-attack`, `redteam-plugin-cross-session-leak`, `redteam-plugin-data-exfiltration`, `redteam-plugin-debug-access`, `redteam-plugin-divergent-repetition`, `redteam-plugin-excessive-agency`, `redteam-plugin-hallucination`, `redteam-plugin-harm-copyright`, `redteam-plugin-harm-cybercrime`, `redteam-plugin-harm-graphic-content`, `redteam-plugin-harm-harassment-bullying`, `redteam-plugin-harm-hate`, `redteam-plugin-harm-illegal-drugs`, `redteam-plugin-harm-insults`, `redteam-plugin-harm-intellectual-property`, `redteam-plugin-harm-misinformation`, `redteam-plugin-harm-privacy`, `redteam-plugin-harm-profanity`, `redteam-plugin-harm-radicalisation`, `redteam-plugin-harm-self-harm`, `redteam-plugin-harm-specialised-advice`, `redteam-plugin-harm-violent-crime`, `redteam-plugin-hijacking`, `redteam-plugin-imitation`, `redteam-plugin-indirect-prompt-injection`, `redteam-plugin-overreliance`, `redteam-plugin-pii-disclosure`, `redteam-plugin-politics`, `redteam-plugin-prompt-extraction`, `redteam-plugin-rag-document-exfiltration`, `redteam-plugin-rbac`, `redteam-plugin-reasoning-dos`, `redteam-plugin-shell-injection`, `redteam-plugin-sql-injection`, `redteam-plugin-ssrf`, `redteam-plugin-tool-discovery`, `redteam-plugin-unverifiable-claims`, `redteam-plugins`, `recipes-compare-two-versions`, `recipes-red-team-an-agent`, `redteam-attack`, `redteam-crescendo`, `redteam-goat`, `redteam-indirect`, `redteam-overview`, `redteam-plugin-prompt-extraction`, `redteam-plugins` |
| command | `judge run` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-cassettes`, `judging-council`, `judging-criteria`, `judging-default-judge`, `judging-families`, `judging-judge-options`, `judging-judge-run`, `judging-overview`, `judging-self-tests` |
| flag | `judge run --verify` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --prompt-budget` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --criteria` | `recipes-benchmark-a-judge`, `judging-criteria`, `judging-judge-run`, `judging-overview`, `judging-criteria`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `judge run --cassette` | `recipes-benchmark-a-judge`, `judging-cassettes`, `judging-criteria`, `judging-judge-options`, `judging-judge-run`, `judging-overview`, `judging-cassettes`, `judging-criteria`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `judge run --mode` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-council`, `judging-judge-options`, `judging-judge-run`, `recipes-test-a-chat-agent`, `running-campaign-run`, `judging-calibration`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `judge run --agent-family` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-council`, `judging-families`, `judging-judge-options`, `judging-judge-run`, `running-campaign-run`, `judging-calibration`, `judging-council`, `judging-families`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `judge run --cascade` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-council`, `judging-judge-options`, `judging-judge-run`, `running-campaign-run`, `judging-calibration`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `judge run --assignments` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-council`, `judging-judge-options`, `judging-judge-run`, `running-campaign-run`, `judging-calibration`, `judging-council`, `judging-judge-run` |
| flag | `judge run --json` | `recipes-benchmark-a-judge`, `judging-judge-run`, `judging-self-tests`, `recipes-find-why-a-test-failed`, `running-campaign-run`, `judging-bench-floors`, `judging-bench-record`, `judging-bench-replay`, `judging-judge-calibrate`, `judging-judge-check`, `judging-judge-run`, `judging-self-tests` |
| flag | `judge run --judge-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --route-first` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --route-then` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --route-on` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --route-confidence` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --route-decide` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --panel-weights` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --panel-margin` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --reference-solve` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --reference-samples` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge run --reference-route` | `judging-judge-options`, `running-campaign-run` |
| command | `judge calibrate` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-cassettes`, `judging-criteria`, `judging-default-judge`, `judging-families`, `judging-judge-calibrate`, `judging-judge-options`, `judging-overview`, `judging-self-tests` |
| flag | `judge calibrate --verify` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge calibrate --prompt-budget` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge calibrate --criteria` | `recipes-benchmark-a-judge`, `judging-criteria`, `judging-judge-calibrate`, `judging-overview`, `judging-criteria`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `judge calibrate --labels` | `recipes-benchmark-a-judge`, `judging-criteria`, `judging-judge-calibrate`, `judging-overview`, `judging-criteria`, `judging-judge-calibrate`, `judging-queue` |
| flag | `judge calibrate --cassette` | `recipes-benchmark-a-judge`, `judging-cassettes`, `judging-criteria`, `judging-judge-calibrate`, `judging-judge-options`, `judging-overview`, `judging-cassettes`, `judging-criteria`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `judge calibrate --claude` | `recipes-benchmark-a-judge`, `judging-cassettes`, `judging-default-judge`, `judging-judge-calibrate`, `judging-overview`, `judging-cassettes`, `judging-default-judge`, `judging-judge-calibrate` |
| flag | `judge calibrate --judge` | `judging-criteria`, `judging-default-judge`, `judging-families`, `judging-judge-options`, `judging-overview`, `core-configuration`, `recipes-find-why-a-test-failed`, `running-campaign-run`, `judging-criteria`, `judging-default-judge`, `judging-evidence`, `judging-families`, `judging-machine-checks`, `judging-run-judge` |
| flag | `judge calibrate --claude-command` | `judging-judge-calibrate`, `judging-judge-calibrate` |
| flag | `judge calibrate --record` | `recipes-benchmark-a-judge`, `judging-cassettes`, `judging-judge-calibrate`, `judging-judge-options`, `running-campaign-run`, `judging-cassettes`, `judging-judge-calibrate` |
| flag | `judge calibrate --spend-cap-usd` | `recipes-benchmark-a-judge`, `judging-judge-calibrate`, `judging-overview`, `judging-bench-record`, `judging-judge-calibrate` |
| flag | `judge calibrate --cascade` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-judge-calibrate`, `judging-judge-options`, `running-campaign-run`, `judging-calibration`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `judge calibrate --assign` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-judge-calibrate`, `judging-calibration`, `judging-judge-calibrate` |
| flag | `judge calibrate --only` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-judge-calibrate`, `judging-calibration`, `judging-judge-calibrate` |
| flag | `judge calibrate --out` | `recipes-benchmark-a-judge`, `judging-judge-calibrate`, `judging-judge-options`, `judging-overview`, `recipes-find-why-a-test-failed`, `recipes-test-a-chat-agent`, `judging-judge-calibrate` |
| flag | `judge calibrate --repeats` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-judge-calibrate`, `recipes-find-why-a-test-failed`, `recipes-test-a-chat-agent`, `running-campaign-run`, `judging-calibration`, `judging-judge-calibrate` |
| flag | `judge calibrate --mode` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-judge-calibrate`, `judging-judge-options`, `recipes-test-a-chat-agent`, `running-campaign-run`, `judging-calibration`, `judging-council`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `judge calibrate --agent-family` | `recipes-benchmark-a-judge`, `judging-calibration`, `judging-families`, `judging-judge-calibrate`, `judging-judge-options`, `running-campaign-run`, `judging-calibration`, `judging-council`, `judging-families`, `judging-judge-calibrate`, `judging-judge-run` |
| flag | `judge calibrate --json` | `recipes-benchmark-a-judge`, `judging-judge-calibrate`, `judging-self-tests`, `recipes-find-why-a-test-failed`, `running-campaign-run`, `judging-bench-floors`, `judging-bench-record`, `judging-bench-replay`, `judging-judge-calibrate`, `judging-judge-check`, `judging-judge-run`, `judging-self-tests` |
| flag | `judge calibrate --judge-route` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge calibrate --route-first` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge calibrate --route-then` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge calibrate --route-on` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge calibrate --route-confidence` | `judging-judge-options`, `running-campaign-run` |
| flag | `judge calibrate --route-decide` | `judging-judge-options`, `running-campaign-run` |
| command | `judge check` | `recipes-benchmark-a-judge`, `judging-criteria`, `judging-judge-check`, `judging-overview`, `judging-self-tests` |
| flag | `judge check --json` | `recipes-benchmark-a-judge`, `judging-judge-check`, `judging-self-tests`, `recipes-find-why-a-test-failed`, `judging-bench-floors`, `judging-bench-replay`, `judging-judge-calibrate`, `judging-judge-check`, `judging-judge-run`, `judging-self-tests` |
| command | `validate` | `judging-self-tests`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --seed` | `judging-self-tests`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --seeds` | `judging-self-tests`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --hidden` | `judging-self-tests`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --json` | `judging-self-tests`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `judging-bench-floors`, `judging-bench-replay`, `judging-judge-check`, `judging-judge-run`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --check-floor` | `judging-self-tests`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `judging-bench-replay`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --raise` | `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `judging-bench-floors`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --evidence` | `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `judging-bench-floors`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --ladder-version` | `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --items` | `judging-self-tests`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --all-levels` | `judging-self-tests`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --blind` | `judging-self-tests`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --hardness` | `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --brief` | `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --fresh` | `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --journal` | `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --check-handover` | `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --branch` | `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| flag | `validate --base` | `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system`, `validate-estate`, `validate-executor-loop`, `validate-floors`, `validate-generator`, `validate-judges`, `validate-map`, `validate-mutants-and-rulings`, `validate-overview`, `validate-protect`, `validate-reading-items`, `validate-research-replays`, `validate-self-checks`, `validate-stats`, `validate-system` |
| command | `report` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `results-drift-recovery`, `results-report`, `results-scorecard` |
| flag | `report --store` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `results-drift-recovery`, `results-report`, `results-scorecard`, `core-getting-started`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `results-compare`, `results-drift-recovery`, `results-exports`, `results-report`, `results-scorecard`, `results-statistics`, `results-view` |
| flag | `report --out` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-red-team-an-agent`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `results-drift-recovery`, `results-report`, `results-scorecard`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `recipes-tests-from-past-conversations`, `results-drift-recovery`, `results-exports`, `results-report`, `results-scorecard`, `redteam-overview` |
| flag | `report --junit` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `results-drift-recovery`, `results-report`, `results-scorecard`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `results-drift-recovery`, `results-report`, `results-scorecard` |
| flag | `report --baseline` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `results-drift-recovery`, `results-report`, `results-scorecard`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-compare`, `results-drift-recovery`, `results-report`, `results-scorecard`, `results-statistics` |
| flag | `report --margin` | `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-drift-recovery`, `results-report`, `results-scorecard`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-compare`, `results-drift-recovery`, `results-report`, `results-scorecard`, `results-statistics` |
| flag | `report --min-goldens` | `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-drift-recovery`, `results-report`, `results-scorecard`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-compare`, `results-drift-recovery`, `results-report`, `results-scorecard`, `results-statistics` |
| flag | `report --strict` | `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-drift-recovery`, `results-report`, `results-scorecard`, `core-exit-codes`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-compare`, `results-drift-recovery`, `results-report`, `results-scorecard`, `results-statistics` |
| flag | `report --pilot` | `results-drift-recovery`, `results-report`, `results-scorecard`, `results-drift-recovery`, `results-report`, `results-scorecard` |
| flag | `report --by` | `results-drift-recovery`, `results-report`, `results-scorecard`, `results-drift-recovery`, `results-report`, `results-scorecard` |
| flag | `report --spread-mode` | `results-drift-recovery`, `results-report`, `results-scorecard`, `results-drift-recovery`, `results-report`, `results-scorecard` |
| flag | `report --max-runs` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `results-drift-recovery`, `results-report`, `results-scorecard`, `recipes-compare-two-versions`, `results-drift-recovery`, `results-report`, `results-scorecard` |
| flag | `report --withhold-incomplete` | `results-drift-recovery`, `results-report`, `results-scorecard`, `results-drift-recovery`, `results-report`, `results-scorecard` |
| flag | `report --json` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-red-team-an-agent`, `recipes-test-a-code-agent`, `results-drift-recovery`, `results-report`, `results-scorecard`, `core-getting-started`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-compare`, `results-drift-recovery`, `results-report`, `results-scorecard`, `results-statistics`, `redteam-overview` |
| flag | `report --config` | `recipes-gate-in-ci`, `results-drift-recovery`, `results-report`, `results-scorecard`, `core-configuration`, `recipes-gate-in-ci`, `results-drift-recovery`, `results-report`, `results-scorecard`, `results-view` |
| flag | `report --aggregate` | `recipes-gate-in-ci`, `results-drift-recovery`, `results-report`, `results-scorecard`, `core-configuration`, `recipes-gate-in-ci`, `results-drift-recovery`, `results-report`, `results-scorecard` |
| command | `compare` | `recipes-compare-two-versions`, `judging-pairwise`, `results-compare`, `results-statistics` |
| flag | `compare --baseline` | `recipes-compare-two-versions`, `results-compare`, `results-statistics`, `recipes-gate-in-ci`, `results-ci`, `results-compare`, `results-report`, `results-scorecard`, `results-statistics` |
| flag | `compare --candidate` | `recipes-compare-two-versions`, `results-compare`, `results-statistics`, `results-compare`, `results-statistics` |
| flag | `compare --rank` | MISSING |
| flag | `compare --store` | `recipes-compare-two-versions`, `results-compare`, `results-statistics`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `results-ci`, `results-compare`, `results-exports`, `results-monitor`, `results-report`, `results-scorecard`, `results-statistics` |
| flag | `compare --margin` | `recipes-compare-two-versions`, `results-compare`, `results-statistics`, `recipes-gate-in-ci`, `results-ci`, `results-compare`, `results-report`, `results-scorecard`, `results-statistics` |
| flag | `compare --min-goldens` | `recipes-compare-two-versions`, `results-compare`, `results-statistics`, `recipes-gate-in-ci`, `results-ci`, `results-compare`, `results-report`, `results-scorecard`, `results-statistics` |
| flag | `compare --strict` | `recipes-compare-two-versions`, `results-compare`, `results-statistics`, `core-exit-codes`, `recipes-gate-in-ci`, `results-ci`, `results-compare`, `results-report`, `results-scorecard`, `results-statistics` |
| flag | `compare --mode` | `recipes-compare-two-versions`, `results-compare`, `results-statistics`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `judging-council`, `results-ci`, `results-compare`, `results-statistics` |
| flag | `compare --q` | `recipes-compare-two-versions`, `results-compare`, `results-statistics`, `results-compare`, `results-statistics` |
| flag | `compare --json` | `recipes-compare-two-versions`, `results-compare`, `results-statistics`, `recipes-gate-in-ci`, `results-ci`, `results-compare`, `results-monitor`, `results-report`, `results-scorecard`, `results-statistics` |
| flag | `compare --pairwise` | `recipes-compare-two-versions`, `judging-pairwise`, `results-compare`, `results-statistics`, `results-compare`, `results-statistics` |
| flag | `compare --pairwise-judge` | `recipes-compare-two-versions`, `judging-pairwise`, `results-compare`, `results-statistics`, `judging-evidence`, `results-compare`, `results-statistics` |
| flag | `compare --pairwise-reference` | `recipes-compare-two-versions`, `judging-pairwise`, `results-compare`, `results-statistics`, `results-compare`, `results-statistics` |
| flag | `compare --pairwise-contract` | MISSING |
| flag | `compare --pairwise-presentation` | MISSING |
| flag | `compare --pairwise-items` | MISSING |
| flag | `compare --no-pairwise-audit` | MISSING |
| flag | `compare --pairwise-config` | MISSING |
| flag | `compare --judge-margin` | MISSING |
| flag | `compare --feature-margin` | MISSING |
| flag | `compare --min-failures` | MISSING |
| flag | `compare --pairwise-preference` | MISSING |
| flag | `compare --verify` | `results-ci` |
| flag | `compare --prompt-budget` | `results-ci` |
| flag | `compare --judge` | `judging-default-judge`, `judging-evidence`, `results-ci` |
| flag | `compare --judge-command` | `results-ci` |
| flag | `compare --judge-budget` | `results-ci` |
| flag | `compare --judges` | `results-ci` |
| flag | `compare --judge-route` | `results-ci` |
| flag | `compare --route-first` | `results-ci` |
| flag | `compare --route-then` | `results-ci` |
| flag | `compare --route-on` | `results-ci` |
| flag | `compare --route-confidence` | `results-ci` |
| flag | `compare --route-decide` | `results-ci` |
| flag | `compare --panel-weights` | `results-ci` |
| flag | `compare --panel-margin` | `results-ci` |
| flag | `compare --reference-solve` | `results-ci` |
| flag | `compare --reference-samples` | `results-ci` |
| flag | `compare --reference-route` | `results-ci` |
| flag | `compare --record` | `results-ci` |
| flag | `compare --agent-family` | `judging-council`, `results-ci` |
| command | `ci` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-rerun-what-a-change-touches`, `results-ci` |
| flag | `ci --specs` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `results-ci`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `running-not-run` |
| flag | `ci --target` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-rerun-what-a-change-touches`, `results-ci`, `core-configuration`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `running-not-run` |
| flag | `ci --route` | `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-rerun-what-a-change-touches`, `results-ci`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent` |
| flag | `ci --process-command` | `results-ci` |
| flag | `ci --baseline` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `results-ci`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `running-not-run`, `results-compare`, `results-statistics` |
| flag | `ci --store` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-rerun-what-a-change-touches`, `results-ci`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `running-not-run`, `results-compare`, `results-exports`, `results-statistics` |
| flag | `ci --margin` | `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-ci`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-compare`, `results-statistics` |
| flag | `ci --min-goldens` | `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-ci`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-compare`, `results-statistics` |
| flag | `ci --strict` | `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-ci`, `core-exit-codes`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `results-compare`, `results-statistics` |
| flag | `ci --mode` | `recipes-compare-two-versions`, `recipes-gate-in-ci`, `recipes-rerun-what-a-change-touches`, `results-ci`, `recipes-compare-two-versions`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `results-compare`, `results-radius`, `results-statistics` |
| flag | `ci --repeats` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `results-ci`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent` |
| flag | `ci --budget-usd` | `recipes-gate-in-ci`, `results-ci`, `core-configuration`, `recipes-gate-in-ci` |
| flag | `ci --faults` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `results-ci`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci` |
| flag | `ci --flag` | `recipes-gate-in-ci`, `results-ci`, `recipes-gate-in-ci` |
| flag | `ci --out` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-rerun-what-a-change-touches`, `results-ci`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `results-exports`, `results-radius` |
| flag | `ci --cache` | `recipes-gate-in-ci`, `results-ci`, `recipes-gate-in-ci` |
| flag | `ci --concurrency` | `recipes-gate-in-ci`, `results-ci`, `recipes-gate-in-ci` |
| flag | `ci --change` | `recipes-rerun-what-a-change-touches`, `results-ci`, `results-radius` |
| flag | `ci --agent-version` | `recipes-compare-two-versions`, `recipes-rerun-what-a-change-touches`, `results-ci`, `recipes-compare-two-versions`, `results-radius` |
| flag | `ci --audit` | `recipes-rerun-what-a-change-touches`, `results-ci`, `results-radius` |
| flag | `ci --audit-seed` | `recipes-rerun-what-a-change-touches`, `results-ci`, `results-radius` |
| flag | `ci --max-carry` | `recipes-rerun-what-a-change-touches`, `results-ci`, `results-radius` |
| flag | `ci --max-age` | `recipes-rerun-what-a-change-touches`, `results-ci`, `results-radius` |
| flag | `ci --max-not-run` | `results-ci`, `core-exit-codes`, `running-not-run` |
| flag | `ci --json` | `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-rerun-what-a-change-touches`, `results-ci`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `results-compare`, `results-radius`, `results-statistics` |
| flag | `ci --config` | `recipes-gate-in-ci`, `results-ci`, `core-configuration`, `recipes-gate-in-ci` |
| flag | `ci --aggregate` | `recipes-gate-in-ci`, `results-ci`, `core-configuration`, `recipes-gate-in-ci` |
| flag | `ci --verify` | `results-ci` |
| flag | `ci --prompt-budget` | `results-ci` |
| flag | `ci --judge` | `recipes-find-why-a-test-failed`, `results-ci`, `core-configuration`, `recipes-find-why-a-test-failed` |
| flag | `ci --judge-command` | `results-ci` |
| flag | `ci --judge-budget` | `recipes-find-why-a-test-failed`, `results-ci`, `recipes-find-why-a-test-failed` |
| flag | `ci --judges` | `results-ci` |
| flag | `ci --judge-mode` | `results-ci` |
| flag | `ci --assignments` | `results-ci` |
| flag | `ci --cascade` | `results-ci` |
| flag | `ci --weights` | `results-ci` |
| flag | `ci --judge-route` | `results-ci` |
| flag | `ci --route-first` | `results-ci` |
| flag | `ci --route-then` | `results-ci` |
| flag | `ci --route-on` | `results-ci` |
| flag | `ci --route-confidence` | `results-ci` |
| flag | `ci --route-decide` | `results-ci` |
| flag | `ci --panel-weights` | `results-ci` |
| flag | `ci --panel-margin` | `results-ci` |
| flag | `ci --reference-solve` | `results-ci` |
| flag | `ci --reference-samples` | `results-ci` |
| flag | `ci --reference-route` | `results-ci` |
| flag | `ci --record` | `results-ci` |
| flag | `ci --agent-family` | `results-ci` |
| flag | `ci --owner` | `results-ci` |
| flag | `ci --owner-file` | `results-ci` |
| flag | `ci --tool-policy` | `results-ci` |
| flag | `ci --embedder` | `results-ci` |
| command | `monitor` | `recipes-compare-two-versions`, `results-monitor` |
| flag | `monitor --store` | `recipes-compare-two-versions`, `results-monitor`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `results-ci`, `results-exports`, `results-statistics` |
| flag | `monitor --source` | `recipes-compare-two-versions`, `results-monitor` |
| flag | `monitor --from` | `results-monitor` |
| flag | `monitor --every` | `results-monitor` |
| flag | `monitor --prices` | `results-monitor` |
| flag | `monitor --metric` | `recipes-compare-two-versions`, `results-monitor` |
| flag | `monitor --window` | `recipes-compare-two-versions`, `results-monitor` |
| flag | `monitor --series` | `recipes-compare-two-versions`, `results-monitor` |
| flag | `monitor --json` | `recipes-compare-two-versions`, `results-monitor`, `recipes-gate-in-ci`, `results-ci`, `results-statistics` |
| command | `select` | `recipes-tests-from-past-conversations`, `results-select` |
| flag | `select --cover` | `recipes-tests-from-past-conversations`, `results-select` |
| flag | `select --specs` | `recipes-tests-from-past-conversations`, `results-select`, `results-ci`, `results-holdout` |
| flag | `select --out` | `recipes-tests-from-past-conversations`, `results-select`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `results-ci`, `results-holdout` |
| flag | `select --k` | `recipes-tests-from-past-conversations`, `results-select` |
| flag | `select --t` | `recipes-tests-from-past-conversations`, `results-select`, `recipes-test-a-chat-agent` |
| flag | `select --force` | `results-select`, `recipes-test-a-chat-agent`, `results-holdout` |
| flag | `select --json` | `results-select`, `recipes-test-a-code-agent`, `results-ci`, `results-compare`, `results-holdout` |
| command | `radius` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius` |
| flag | `radius --change` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius`, `results-ci`, `results-radius` |
| flag | `radius --mode` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `authoring-perturbations`, `authoring-prompt-sections`, `results-ci`, `results-compare`, `results-radius`, `results-statistics` |
| flag | `radius --explain` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius`, `results-radius` |
| flag | `radius --sections` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `authoring-prompt-sections` |
| flag | `radius --json` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `authoring-gate`, `authoring-generate`, `authoring-perturbations`, `authoring-prompt-sections`, `authoring-spec-format`, `authoring-task-families`, `results-ci`, `results-compare`, `results-radius`, `results-statistics` |
| command | `radius auto` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius` |
| flag | `radius auto --prompt` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius`, `recipes-test-a-chat-agent`, `authoring-prompt-sections`, `results-radius` |
| flag | `radius auto --map` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius`, `recipes-test-a-chat-agent`, `authoring-deviation-classes`, `authoring-generate`, `authoring-map`, `results-radius` |
| flag | `radius auto --source` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius`, `results-radius` |
| flag | `radius auto --from-version` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius`, `results-radius` |
| flag | `radius auto --to-version` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius`, `authoring-prompt-sections`, `results-radius` |
| flag | `radius auto --out` | `recipes-rerun-what-a-change-touches`, `authoring-blast-radius`, `results-radius`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `authoring-gate`, `authoring-generate`, `authoring-map`, `authoring-prompt-sections`, `authoring-task-families`, `results-ci`, `results-radius` |
| command | `radius sections init` | `authoring-prompt-sections` |
| flag | `radius sections init --id` | `authoring-prompt-sections` |
| flag | `radius sections init --prompt-version` | `authoring-prompt-sections` |
| flag | `radius sections init --level` | `authoring-prompt-sections` |
| flag | `radius sections init --out` | `authoring-prompt-sections`, `authoring-blast-radius`, `results-radius` |
| command | `radius sections check` | `authoring-prompt-sections` |
| flag | `radius sections check --prompt` | `authoring-prompt-sections`, `authoring-blast-radius`, `results-radius` |
| flag | `radius sections check --json` | `authoring-prompt-sections`, `authoring-blast-radius`, `authoring-spec-check`, `authoring-spec-format`, `results-radius` |
| command | `radius sections reanchor` | `recipes-rerun-what-a-change-touches`, `authoring-prompt-sections` |
| flag | `radius sections reanchor --prompt` | `recipes-rerun-what-a-change-touches`, `authoring-prompt-sections`, `recipes-test-a-chat-agent`, `authoring-blast-radius`, `results-radius` |
| flag | `radius sections reanchor --to-version` | `recipes-rerun-what-a-change-touches`, `authoring-prompt-sections`, `authoring-blast-radius`, `results-radius` |
| flag | `radius sections reanchor --out` | `recipes-rerun-what-a-change-touches`, `authoring-prompt-sections`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `authoring-blast-radius`, `results-radius` |
| flag | `radius sections reanchor --change-out` | `recipes-rerun-what-a-change-touches`, `authoring-prompt-sections` |
| flag | `radius sections reanchor --json` | `recipes-rerun-what-a-change-touches`, `authoring-prompt-sections`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `authoring-blast-radius`, `authoring-spec-check`, `authoring-spec-format`, `results-radius` |
| command | `radius localize` | `authoring-prompt-sections` |
| flag | `radius localize --store` | `authoring-prompt-sections` |
| flag | `radius localize --campaign` | `authoring-prompt-sections` |
| flag | `radius localize --sections` | `authoring-prompt-sections`, `authoring-blast-radius`, `authoring-spec-check` |
| flag | `radius localize --prompt` | `authoring-prompt-sections`, `authoring-blast-radius`, `results-radius` |
| flag | `radius localize --mode` | `authoring-prompt-sections`, `authoring-blast-radius`, `results-radius` |
| flag | `radius localize --counting` | `authoring-prompt-sections` |
| flag | `radius localize --top` | `authoring-prompt-sections` |
| command | `holdout seal` | `results-holdout` |
| flag | `holdout seal --specs` | `results-holdout`, `results-select` |
| flag | `holdout seal --out` | `results-holdout`, `results-select` |
| flag | `holdout seal --share` | `results-holdout` |
| flag | `holdout seal --seed` | `results-holdout` |
| flag | `holdout seal --force` | `results-holdout`, `results-select` |
| command | `holdout score` | `results-holdout` |
| flag | `holdout score --sealed` | `results-holdout` |
| flag | `holdout score --target` | `results-holdout` |
| flag | `holdout score --budget` | `results-holdout` |
| flag | `holdout score --json` | `results-holdout`, `results-select`, `results-statistics` |
| command | `queue create` | `recipes-benchmark-a-judge`, `judging-queue` |
| flag | `queue create --store` | `recipes-benchmark-a-judge`, `judging-queue`, `recipes-find-why-a-test-failed`, `recipes-test-a-chat-agent` |
| flag | `queue create --campaign` | `recipes-benchmark-a-judge`, `judging-queue`, `recipes-find-why-a-test-failed` |
| flag | `queue create --labels` | `recipes-benchmark-a-judge`, `judging-queue`, `judging-criteria`, `judging-judge-calibrate` |
| command | `queue list` | `recipes-benchmark-a-judge`, `judging-queue` |
| flag | `queue list --labels` | `recipes-benchmark-a-judge`, `judging-queue`, `judging-criteria`, `judging-judge-calibrate` |
| command | `queue vote` | `recipes-benchmark-a-judge`, `judging-queue` |
| flag | `queue vote --criterion` | `recipes-benchmark-a-judge`, `judging-queue` |
| flag | `queue vote --reviewer` | `recipes-benchmark-a-judge`, `judging-queue` |
| flag | `queue vote --label` | `recipes-benchmark-a-judge`, `judging-queue` |
| flag | `queue vote --labels` | `recipes-benchmark-a-judge`, `judging-queue`, `judging-criteria`, `judging-judge-calibrate` |
| command | `queue agreement` | `recipes-benchmark-a-judge`, `judging-queue` |
| flag | `queue agreement --labels` | `recipes-benchmark-a-judge`, `judging-queue`, `judging-criteria`, `judging-judge-calibrate` |
| command | `queue assign` | `recipes-benchmark-a-judge`, `judging-queue` |
| flag | `queue assign --criterion` | `recipes-benchmark-a-judge`, `judging-queue` |
| flag | `queue assign --reviewer` | `recipes-benchmark-a-judge`, `judging-queue` |
| flag | `queue assign --labels` | `recipes-benchmark-a-judge`, `judging-queue`, `judging-criteria`, `judging-judge-calibrate` |
| command | `view` | `recipes-benchmark-a-judge`, `recipes-find-why-a-test-failed`, `results-view` |
| flag | `view --store` | `recipes-benchmark-a-judge`, `recipes-find-why-a-test-failed`, `results-view`, `recipes-compare-two-versions`, `recipes-find-why-a-test-failed`, `recipes-gate-in-ci`, `recipes-test-a-chat-agent`, `results-compare`, `results-report`, `results-scorecard` |
| flag | `view --port` | `recipes-benchmark-a-judge`, `recipes-find-why-a-test-failed`, `results-view`, `recipes-find-why-a-test-failed` |
| flag | `view --labels` | `recipes-benchmark-a-judge`, `results-view` |
| flag | `view --labelled-by` | `recipes-benchmark-a-judge`, `results-view` |
| flag | `view --config` | `results-view`, `core-configuration`, `recipes-gate-in-ci`, `results-report`, `results-scorecard` |
| command | `import csv` | `authoring-import` |
| flag | `import csv --mapping` | `authoring-import` |
| flag | `import csv --out` | `authoring-import`, `authoring-intake`, `authoring-prefixes` |
| flag | `import csv --force` | `authoring-import`, `authoring-intake`, `authoring-prefixes` |
| flag | `import csv --json` | `authoring-import`, `authoring-intake`, `authoring-prefixes`, `authoring-spec-check`, `authoring-spec-format` |
| command | `import xlsx` | `authoring-import` |
| flag | `import xlsx --mapping` | `authoring-import` |
| flag | `import xlsx --out` | `authoring-import`, `authoring-intake`, `authoring-prefixes` |
| flag | `import xlsx --force` | `authoring-import`, `authoring-intake`, `authoring-prefixes` |
| flag | `import xlsx --json` | `authoring-import`, `authoring-intake`, `authoring-prefixes`, `authoring-spec-check`, `authoring-spec-format` |
| command | `import traces` | `recipes-tests-from-past-conversations`, `authoring-import`, `authoring-prefixes` |
| flag | `import traces --from` | `recipes-tests-from-past-conversations`, `authoring-import`, `authoring-prefixes`, `authoring-prefixes`, `running-campaign-run` |
| flag | `import traces --out` | `recipes-tests-from-past-conversations`, `authoring-import`, `authoring-prefixes`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-intake`, `authoring-prefixes` |
| flag | `import traces --prices` | `authoring-import`, `authoring-prefixes`, `core-configuration`, `authoring-prefixes`, `running-campaign-run` |
| flag | `import traces --no-redact` | `recipes-tests-from-past-conversations`, `authoring-import`, `authoring-prefixes`, `authoring-prefixes` |
| flag | `import traces --force` | `authoring-import`, `authoring-prefixes`, `recipes-test-a-chat-agent`, `authoring-intake`, `authoring-prefixes` |
| flag | `import traces --select` | `recipes-tests-from-past-conversations`, `authoring-import`, `authoring-prefixes`, `authoring-prefixes` |
| flag | `import traces --dataset` | `recipes-tests-from-past-conversations`, `authoring-import`, `authoring-prefixes`, `core-configuration`, `authoring-prefixes`, `running-campaign-run` |
| flag | `import traces --store` | `recipes-tests-from-past-conversations`, `authoring-import`, `authoring-prefixes`, `recipes-test-a-chat-agent`, `recipes-test-a-code-agent`, `authoring-prefixes`, `running-campaign-run` |
| command | `import approve` | `recipes-tests-from-past-conversations`, `authoring-import` |
| flag | `import approve --all` | `recipes-tests-from-past-conversations`, `authoring-import`, `recipes-test-a-chat-agent`, `authoring-intake` |
| command | `dataset push` | `results-registry` |
| flag | `dataset push --store` | `results-registry`, `results-compare`, `results-exports`, `results-report` |
| flag | `dataset push --note` | `results-registry` |
| flag | `dataset push --json` | `results-registry`, `results-compare`, `results-report` |
| command | `dataset list` | `results-registry` |
| flag | `dataset list --store` | `results-registry`, `results-compare`, `results-exports`, `results-report` |
| flag | `dataset list --json` | `results-registry`, `results-compare`, `results-report` |
| command | `dataset diff` | `results-registry` |
| flag | `dataset diff --store` | `results-registry`, `results-compare`, `results-exports`, `results-report` |
| flag | `dataset diff --dir` | `results-registry` |
| flag | `dataset diff --json` | `results-registry`, `results-compare`, `results-report` |
| command | `dataset restore` | `results-registry` |
| flag | `dataset restore --store` | `results-registry`, `results-compare`, `results-exports`, `results-report` |
| flag | `dataset restore --out` | `results-registry`, `results-exports`, `results-report` |
| flag | `dataset restore --force` | `results-registry` |
| flag | `dataset restore --json` | `results-registry`, `results-compare`, `results-report` |
| command | `prompt push` | `results-registry` |
| flag | `prompt push --store` | `results-registry`, `results-compare`, `results-exports`, `results-report` |
| flag | `prompt push --note` | `results-registry` |
| flag | `prompt push --json` | `results-registry`, `results-compare`, `results-report` |
| command | `prompt list` | `results-registry` |
| flag | `prompt list --store` | `results-registry`, `results-compare`, `results-exports`, `results-report` |
| flag | `prompt list --json` | `results-registry`, `results-compare`, `results-report` |
| command | `prompt diff` | `results-registry` |
| flag | `prompt diff --store` | `results-registry`, `results-compare`, `results-exports`, `results-report` |
| flag | `prompt diff --dir` | `results-registry` |
| flag | `prompt diff --json` | `results-registry`, `results-compare`, `results-report` |
| command | `prompt restore` | `results-registry` |
| flag | `prompt restore --store` | `results-registry`, `results-compare`, `results-exports`, `results-report` |
| flag | `prompt restore --out` | `results-registry`, `results-exports`, `results-report` |
| flag | `prompt restore --force` | `results-registry` |
| flag | `prompt restore --json` | `results-registry`, `results-compare`, `results-report` |
| command | `help` | `core-global-options`, `core-reading-help` |
| error | `BLOCK_NO_EXPECTATION` | MISSING |
| error | `BLOCK_STIMULUS_AMBIGUOUS` | `authoring-blocks` |
| error | `BLOCK_STIMULUS_MISSING` | `authoring-blocks` |
| error | `COUNT_RANGE_INVALID` | `authoring-blocks` |
| error | `CRITERION_DUPLICATE` | `judging-criteria` |
| error | `CRITERION_REF_INVALID` | `judging-criteria` |
| error | `CRITERION_UNDEFINED` | `authoring-blocks` |
| error | `CRITERION_UNRESOLVED` | MISSING |
| error | `DUPLICATE_BLOCK_ID` | MISSING |
| error | `DUPLICATE_PERTURBATION_ID` | MISSING |
| error | `FORBIDDEN_CELL` | MISSING |
| error | `GIVEN_CANONICAL_UNPAIRED` | MISSING |
| error | `GIVEN_CHAIN` | MISSING |
| error | `GIVEN_ORIGIN_WITHOUT_PREFIX` | `authoring-prefixes` |
| error | `GIVEN_SUMMARY_MISSING` | MISSING |
| error | `GIVEN_UNMET` | MISSING |
| error | `INVENTORY_DUPLICATE` | `authoring-inventory` |
| error | `INVENTORY_NOT_OBJECT` | `authoring-inventory` |
| error | `INVENTORY_PARSE` | `authoring-inventory` |
| error | `INVENTORY_UNKNOWN_BEHAVIOUR` | `authoring-inventory` |
| error | `INVENTORY_UNKNOWN_CHANNEL` | `authoring-inventory` |
| error | `KIND_MISMATCH` | MISSING |
| error | `LINK_BLOCK_UNKNOWN` | `authoring-prompt-sections` |
| error | `LINK_STALE` | MISSING |
| error | `LINK_TARGET_UNKNOWN` | MISSING |
| error | `MAP_DUPLICATE_ATOM` | MISSING |
| error | `MAP_HASH` | `validate-estate-scan` |
| error | `MAP_NOT_OBJECT` | MISSING |
| error | `MAP_PARSE` | MISSING |
| error | `MAP_QUOTE_DRIFT` | `validate-estate-scan` |
| error | `MAP_UNKNOWN_ATOM` | MISSING |
| error | `MAP_UNKNOWN_KIND` | `validate-estate-scan` |
| error | `MUST_CONFLICT` | MISSING |
| error | `PARENT_CYCLE` | MISSING |
| error | `PARENT_MISSING` | MISSING |
| error | `PERTURBATION_EMPTY` | `authoring-perturbations` |
| error | `PERTURBATION_NO_RECOVERY` | `authoring-perturbations`, `results-drift-recovery` |
| error | `PERTURBATION_OUT_OF_RANGE` | `authoring-perturbations` |
| error | `PLAN_DUPLICATE_ROW` | MISSING |
| error | `PLAN_NOT_OBJECT` | MISSING |
| error | `PLAN_PARSE` | MISSING |
| error | `PLAN_UNKNOWN_ROW` | MISSING |
| error | `PREFIX_PROSE_HISTORY` | `authoring-prefixes` |
| error | `PRIOR_EMPTY` | MISSING |
| error | `PROPOSAL_DUPLICATE` | `authoring-extract` |
| error | `PROPOSAL_EVIDENCE_MISSING` | `authoring-extract` |
| error | `PROPOSAL_NOT_OBJECT` | `authoring-extract` |
| error | `PROPOSAL_PARSE` | `authoring-extract` |
| error | `PROPOSAL_QUOTE_NOT_FOUND` | `authoring-extract` |
| error | `PROPOSAL_SOURCE_UNREADABLE` | `authoring-extract` |
| error | `PROPOSAL_UNKNOWN_DIMENSION` | `authoring-extract` |
| error | `PROPOSAL_UNKNOWN_SOURCE` | `authoring-extract` |
| error | `PROPOSAL_UNKNOWN_VALUE` | `authoring-extract` |
| error | `REGEX_INVALID` | `authoring-blocks` |
| error | `RETENTION_FACT_UNKNOWN` | `authoring-blocks` |
| error | `SPACE_AMBIGUOUS_VALUE` | `authoring-map` |
| error | `SPACE_DUPLICATE` | `authoring-map` |
| error | `SPACE_EMPTY_CONSTRAINT` | `authoring-map` |
| error | `SPACE_GRID_EMPTY` | `authoring-map` |
| error | `SPACE_KIND_REPEATED` | `authoring-map` |
| error | `SPACE_NOT_OBJECT` | `authoring-map` |
| error | `SPACE_PARSE` | `authoring-map` |
| error | `SPACE_PRIOR_INCOMPLETE` | `authoring-map` |
| error | `SPACE_PRIOR_SOURCE` | `authoring-map` |
| error | `SPACE_PRIOR_ZERO` | `authoring-map` |
| error | `SPACE_UNKNOWN_DEVIATION` | `authoring-map` |
| error | `SPACE_UNKNOWN_DIMENSION` | `authoring-map` |
| error | `SPACE_UNKNOWN_VALUE` | `authoring-map` |
| error | `SPEC_ALIAS_CONFLICT` | `authoring-spec-format` |
| error | `SPEC_NOT_OBJECT` | `authoring-spec-format` |
| error | `SPEC_PARSE` | `core-project-layout`, `authoring-spec-check`, `authoring-spec-format` |
| error | `SPEC_SCHEMA_VERSION` | MISSING |
| error | `STAGE_UNKNOWN` | `authoring-blocks`, `authoring-perturbations`, `judging-check-runtime` |
| error | `TASK_WITHOUT_OUTCOME` | MISSING |
| error | `TOOL_COUNT_CONTRADICTION` | `authoring-blocks` |
| error | `TOOL_FORBIDDEN_EXPECTED` | `authoring-blocks`, `judging-check-tools` |
| error | `UNKNOWN_BEHAVIOUR` | MISSING |
| error | `UNKNOWN_FLOW` | MISSING |
| error | `UNKNOWN_VALUE` | `authoring-map`, `authoring-space-coverage` |
| error | `UNLISTED_CHANNEL` | MISSING |
| error | `UNPLACED_SPEC` | MISSING |
| error | `WORKSPACE_PATH_TWICE` | MISSING |
| error | `bad_response` | MISSING |
| error | `config` | `judging-default-judge` |
| error | `empty` | MISSING |
| error | `exhausted` | MISSING |
| error | `http` | `running-tool-history` |
| error | `network` | MISSING |
| error | `refusal` | MISSING |
| error | `timeout` | `validate-estate-unit` |
| error | `truncated` | MISSING |

## Schema key inventory

The block and campaign schema test reads these keys from the live Zod objects.
The before column records the baseline topic; the after column records this change.

| Key | Before | After |
|---|---|---|
| `campaign.specs` | `running-campaign-config` | `running-campaign-config` |
| `campaign.dataset` | `running-campaign-config` | `running-campaign-config` |
| `campaign.prompts` | `running-campaign-config` | `running-campaign-config` |
| `campaign.targets` | `running-campaign-config` | `running-campaign-config` |
| `campaign.routes` | `running-campaign-config` | `running-campaign-config` |
| `campaign.modes` | `running-campaign-config` | `running-campaign-config` |
| `campaign.repeats` | `running-campaign-config` | `running-campaign-config` |
| `campaign.agent_version` | `running-campaign-config` | `running-campaign-config` |
| `campaign.store` | `running-campaign-config` | `running-campaign-config` |
| `campaign.cache` | `running-campaign-config` | `running-campaign-config` |
| `campaign.cache_suite` | `running-campaign-config` | `running-campaign-config` |
| `campaign.concurrency` | `running-campaign-config` | `running-campaign-config` |
| `campaign.budget_usd` | `running-campaign-config` | `running-campaign-config` |
| `campaign.process_command` | `running-campaign-config` | `running-campaign-config` |
| `campaign.driver` | `running-campaign-config` | `running-campaign-config` |
| `campaign.personas` | `running-campaign-config` | `running-campaign-config` |
| `campaign.recordings` | `running-campaign-config` | `running-campaign-config` |
| `campaign.model` | `running-campaign-config` | `running-campaign-config` |
| `campaign.agent_family` | `running-campaign-config` | `running-campaign-config` |
| `campaign.judge_families` | `running-campaign-config` | `running-campaign-config` |
| `campaign.retry` | `running-campaign-config` | `running-campaign-config` |
| `campaign.retry.max_attempts` | `running-campaign-config` | `running-campaign-config` |
| `campaign.retry.base_delay_ms` | `running-campaign-config` | `running-campaign-config` |
| `campaign.retry.max_delay_ms` | `running-campaign-config` | `running-campaign-config` |
| `blocks[].id` | `authoring-blocks` | `authoring-blocks` |
| `blocks[].parent` | MISSING | `authoring-parent-blocks` |
| `blocks[].when` | `authoring-blocks` | `authoring-blocks` |
| `blocks[].given` | `authoring-blocks` | `authoring-blocks` |
| `blocks[].expect` | `authoring-blocks` | `authoring-blocks` |
| `blocks[].budget` | `authoring-blocks` | `authoring-blocks` |
| `given.ledger` | `authoring-prefixes` | `authoring-prefixes` |
| `given.world` | `authoring-prefixes` | `authoring-prefixes` |
| `given.vars` | `authoring-prefixes` | `authoring-prefixes` |
| `given.summary` | `authoring-prefixes` | `authoring-prefixes` |
| `blocks[].given.prefix` | `authoring-prefixes` | `authoring-prefixes` |
| `blocks[].given.origin` | `authoring-prefixes` | `authoring-prefixes` |
| `blocks[].given.ledger` | `authoring-prefixes` | `authoring-prefixes` |
| `blocks[].given.world` | `authoring-prefixes` | `authoring-prefixes` |
| `blocks[].given.vars` | `authoring-prefixes` | `authoring-prefixes` |
| `blocks[].given.shared` | `authoring-prefixes` | `authoring-prefixes` |
| `blocks[].given.summary` | `authoring-prefixes` | `authoring-prefixes` |
| `given.world.tools` | `authoring-prefixes` | `authoring-prefixes` |
| `given.world.store` | `authoring-prefixes` | `authoring-prefixes` |
| `given.world.workspace` | `authoring-prefixes` | `authoring-prefixes` |
| `given.world.fixtures` | `authoring-prefixes` | `authoring-prefixes` |
| `given.world.workspace.from` | `authoring-prefixes` | `authoring-prefixes` |
| `given.world.workspace.files` | `authoring-prefixes` | `authoring-prefixes` |
| `given.world.workspace.binary` | MISSING | `authoring-parent-blocks` |
| `given.world.workspace.summary` | `authoring-prefixes` | `authoring-prefixes` |

## Coverage after edits

| Kind | Before | After |
|---|---|---|
| command | 88/88 | 88/88 |
| flag | 799/809 | 809/809 |
| error | 54/91 | 91/91 |

All previously missing registrations now map to a section:

| Item | Topic |
|---|---|
| `compare --rank` | `results-compare`, `results-compare` |
| `compare --pairwise-contract` | `results-compare`, `results-compare` |
| `compare --pairwise-presentation` | `results-compare`, `results-compare` |
| `compare --pairwise-items` | `results-compare`, `results-compare` |
| `compare --no-pairwise-audit` | `results-compare`, `results-compare` |
| `compare --pairwise-config` | `results-compare`, `results-compare` |
| `compare --judge-margin` | `results-compare`, `results-compare` |
| `compare --feature-margin` | `results-compare`, `results-compare` |
| `compare --min-failures` | `results-compare`, `results-compare` |
| `compare --pairwise-preference` | `results-compare`, `results-compare` |
| `BLOCK_NO_EXPECTATION` | `core-error-codes` |
| `CRITERION_UNRESOLVED` | `core-error-codes` |
| `DUPLICATE_BLOCK_ID` | `core-error-codes`, `authoring-parent-blocks` |
| `DUPLICATE_PERTURBATION_ID` | `core-error-codes` |
| `FORBIDDEN_CELL` | `core-error-codes` |
| `GIVEN_CANONICAL_UNPAIRED` | `core-error-codes` |
| `GIVEN_CHAIN` | `core-error-codes` |
| `GIVEN_SUMMARY_MISSING` | `core-error-codes` |
| `GIVEN_UNMET` | `core-error-codes` |
| `KIND_MISMATCH` | `core-error-codes` |
| `LINK_STALE` | `core-error-codes` |
| `LINK_TARGET_UNKNOWN` | `core-error-codes` |
| `MAP_DUPLICATE_ATOM` | `core-error-codes` |
| `MAP_NOT_OBJECT` | `core-error-codes` |
| `MAP_PARSE` | `core-error-codes` |
| `MAP_UNKNOWN_ATOM` | `core-error-codes` |
| `MUST_CONFLICT` | `core-error-codes` |
| `PARENT_CYCLE` | `authoring-parent-blocks` |
| `PARENT_MISSING` | `authoring-parent-blocks` |
| `PLAN_DUPLICATE_ROW` | `core-error-codes` |
| `PLAN_NOT_OBJECT` | `core-error-codes` |
| `PLAN_PARSE` | `core-error-codes` |
| `PLAN_UNKNOWN_ROW` | `core-error-codes` |
| `PRIOR_EMPTY` | `core-error-codes` |
| `SPEC_SCHEMA_VERSION` | `core-error-codes` |
| `TASK_WITHOUT_OUTCOME` | `core-error-codes` |
| `UNKNOWN_BEHAVIOUR` | `core-error-codes` |
| `UNKNOWN_FLOW` | `core-error-codes` |
| `UNLISTED_CHANNEL` | `core-error-codes` |
| `UNPLACED_SPEC` | `core-error-codes` |
| `WORKSPACE_PATH_TWICE` | `authoring-parent-blocks` |
| `bad_response` | `core-error-codes` |
| `empty` | `core-error-codes` |
| `exhausted` | `core-error-codes` |
| `network` | `core-error-codes` |
| `refusal` | `core-error-codes` |
| `truncated` | `core-error-codes` |

## Second pass: schema keys and stored records

Baseline: main at `8d775f2bb`. The first pass left commands, flags and errors at 88/88, 809/809 and 91/91.
This pass adds the classes the registered-surface test does not read. `help-schema-coverage.test.ts` reads each
class from the live Zod schema, so a key added later is listed without a hand-kept table.

| Class | Read from | Topics that own it | Gaps before | Gaps after |
|---|---|---|---|---|
| command | Commander tree | any topic that lists the command | 0 | 0 |
| flag | Commander tree | the topic of the command | 0 | 0 |
| error code | exported `*IssueCodes`, `*WarningCodes`, `*ErrorCodes` | `Common errors` sections | 0 | 0 |
| campaign config key | `CampaignConfig` | `running-campaign-config` | 0 | 0 |
| spec key (292 keys in 56 objects) | `Spec` | `authoring-spec-format`, `authoring-blocks`, `authoring-prefixes`, `authoring-parent-blocks`, `authoring-perturbations`, the `judging-check-*` topics | 4 | 0 |
| run record key | `RunResult`: root, block, provenance, rejudged, carried, blockRerun, succession, recovery, endState | `running-store` and the topics of each feature | 35 | 0 |
| campaign record key | `Campaign`: root, provenance, rejudged, radius | `running-store`, `running-change-carry` | 16 | 0 |
| block output key (138 keys in 23 objects of `observed`, `verdicts`, `events`) | `RunResult` | `running-store`, `running-retries`, `running-tool-history`, `running-process-and-sandboxes`, `judging-evidence`, `judging-council` | 37 | 0 |
| block status, `not_run` kind, link status, relation and creator | the enums | `running-not-run`, `running-outcomes`, `authoring-block-links` | 0 | 0 |

A key counts as documented when a topic of its owner names it in code: a code span or a fenced block.
A mention in prose does not count. Spec keys are read in `Inputs` and `Commands and every option`;
record keys are read in the whole topic, since a record is read as output.

Gaps closed in this pass:

* `criteria[]`: `answer_contract`, `repeat`, `per_turn`, `requirements[].requirement` (`authoring-spec-format`, which now lists every criterion key).
* Run record: `endVerdict`, `endStateValue`, `blockRerun.downstreamNotRerun`, `provenanceDigest`, the nine `provenance` fields, the block `provenance` and `carried.measuredAt`, the `rejudged` stamp, all five `succession` fields and the five `recovery` fields that had none.
* Campaign record: `targets`, `repeats`, `provenance.endStateSnapshots`, `provenance.adapters[]`, `rejudged[]`, `radius.fromVersion`, `radius.toVersion`.

* Block output: `observed` (segments, tool calls, runtime, workspace diff, executions and their approval, sandbox, cost, retries, history normalizations, raw), `verdicts` with their judge votes, and the six `events` types, in "Block record: observed, verdicts and events" of `running-store`.

Total gaps before this pass: 92 (55 and 37). After: 0.

## Third pass: a key is named in the section of its object

The second pass looked for a key anywhere in the owning topics, so a key added to one object passed when another
object of the same topic already named that word (a new run key `reason` passed because `blockRerun.reason` is
documented). `help-schema-coverage.test.ts` now finds the units that document each object and reads only those:

* a heading that names the object (`### \`criteria\` (one entry)`): its text, and the first cell of each table row;
* a table whose label line ends in a colon and names the object (`\`observed\` fields:`): the whole table;
* a table row that opens with the object's key: that row, for an object kept inside one entry of its parent;
* an explicit entry in the test for an object none of these finds (the roots, the prefix message, the vote);
* otherwise the units of the nearest ancestor key. A pinned entry that no longer resolves fails the test.

The docs gained what the check needed:

| Topic | Added |
|---|---|
| `authoring-blocks` | `count` as `{ min?, max? }` on `skills`, `guards`, `references`, `subagents` and `cards`; the keys of `when.injection` (`class`, `user`) are read from the paragraph that defines the injection form |
| `running-store`, run record | `endState` (`match`, `diff[]`), `realizedTextStripped`, the corrected `provenanceDigest`, `safeAction` and `clarified` conditions |
| `running-store`, block | its own paragraph: `parent`, `specIndex`, `injected`, `realized`, `realizedTextStripped`, `provenance`, `ledgerCheck.ok`, `ledgerCheck.contradictions`, `status`, `notRun`, `blocked`; and the block `provenance` with `endState`, `artifacts[]` and `carried.measuredAt` |
| `running-store`, campaign | `campaignId`, `specs[]`, `modes`, `budgetUsd`, `judge`, `createdAt`, `agentVersion`, `sources[]`, and the keys inside `radius` (`whole`, `refused[]`, `audit.missed[]`) |

A target (`target`, `targets[]`) is documented once, as the `target` of a spec.

## Verification contract

`help-coverage.test.ts` discovers the Commander tree and exported error-code arrays on each run.
It refuses undocumented commands, flags and errors, including new registries in new packages.
Mutation cases add an undocumented command, flag and error; a separate case adds a new registry file.
`help-schema-coverage.test.ts` reads the block, Given, world, workspace and campaign keys from their schemas.
`help-topics.test.ts` runs every worked example, including all fictional fixtures added here.
The required PR docs check runs the coverage guards. The longer PR check runs every help example even for Markdown-only changes.
