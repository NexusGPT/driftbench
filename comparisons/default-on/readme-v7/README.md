# default-on-v7 on the README judge rows (preregistered)

`PREREGISTRATION.json` fixes the items, the model, the product commit, the run freeze, the analysis and the budget. It was committed before the first model call of the run.

The earlier README rows were measured with `claude -p` and prompts from pinned old judge versions. This run calls `createDefaultJudge` (policy default-on-v7) over the Anthropic Messages API with the same model, claude-haiku-5-5, on the same held-out items. The other tools' answers are the recorded ones; they are not called again.

* `builders/build-*.mts` rebuild each lane's input manifest from committed files, with no network call. Each request is rendered with the pinned `buildPrompt` of the original run and compared with the recorded prompt or request hash (`builders/CHECKS-*.json`).
* `combine.py` joins the three lane manifests into the driver manifest.
* `bench_spend_import.py` turns the bench re-record spend into the shared meter's import format, so one cap covers both.
* `offline_check.py` runs two items per dataset through the frozen driver with a fake Messages API, then `analyze.py`.
* `analyze.py` scores the run with the README rule and the secondary tests named in the preregistration.
