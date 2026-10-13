# Verify execution checkpoint

- Pushed execution amendment: 34f76183. Branch research/ledger-verify.
- Active runtime: ee96e47757aa837860fe. Recording namespace stays 2869d4d1f750545a2c7d.
- Owner pacing: Luna eight plain HTTP calls, Gemini two, Haiku two; no global four-call limit.
- Actual provider timeout is 300 seconds; API reasoning medium; global money cap 40 USD includes unresolved holds.
- Gemini is STOPPED after 20 explicit HTTP 402 rejections. Owner says wait for top-up, then resume missing-only.
- evidence/billing-reconciliation.json releases only those 20 rejection holds, totaling 20 USD. Unknown network holds remain.
- Gemini noise-1 retains its stopped report and twenty no-answer records. Archive that partial before recovery; remove only proven no-answer records from the active cassette, preserving their archive. Never retry returned answers.
- Luna noise-1 briefly stopped because rejection holds consumed the conservative cap. Its partial is noise-1/gpt-6-luna.pre-billing-release.partial.json. Two returned answers remain cached.
- Luna missing-only continuation runs in exec session 1821, then starts supervise.py for noise-2 and TEST. Eight HTTP workers observed.
- Haiku supervisor remains alive from session 22934, PID 39438; its current phase is noise-0. Two native calls observed.
- Gemini supervisor has exited. Do not restart until owner signals prepaid credit replenishment.
- No TEST has started at 09:39 UTC. Both strict and product-final scoring were frozen before TEST.
- Official and audited tables remain pending. Strict output-limit errors are headline; product-final includes existing fallback.
- Three pilots and all mutation checks are finished. Every model/contestant has 12/12 preserve, 12/12 flip, zero injection changes.
- Free replay verifies eight finished phases with identical decisions and zero new calls.
- Four native output-limit envelopes observed so far; three await attribution until Haiku noise-0 finishes. Two historical native error causes remain unclassified.
- status.py is read-only. trace-requests.ts --all, output_limits.py, check-replays.py, summarize.py and render_report.py complete reporting without provider calls.
- Final target: /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/dossier-ledger-verify.md.
- Keep running both unblocked models through all 379 units unless the cap is reached. Do not report completion while their phases are pending.
- All writes stay in this worktree, the named report, and append-only spend-ledger rows. No other key files or worktrees may be written.

## 10:05 UTC checkpoint

- First TEST starts at 09:57:23.443 UTC for gpt-6-luna, 221 sealed items, runtime ee96e47757aa837860fe.
- Scoring implementation hashes match the pre-TEST freeze; evidence/test-entry-check.json proves chronology.
- Luna completes all three noise repeats. Noise changes: cascade 4/30, promptfoo 9/30; both have two items with a missing state.
- Haiku noise-0 finishes with all 30 final verdicts per contestant. Noise-1 starts at 10:00:56.558 UTC.
- Six confirmed native output-limit envelopes are all ours: one pilot, five noise-0. These affect one pilot item and three noise-0 items. Zero unmapped confirmed limits.
- Two historical native error bodies remain unclassified. No TEST output-limit error is observed at this checkpoint.
- Last pushed code commit acac98d2; live receipts and reports remain uncommitted until a stable checkpoint or final handoff.
- Gemini remains stopped, awaiting the owner top-up signal. No Gemini restart is authorized before that signal.

## 10:21 UTC Gemini top-up recovery

- Owner confirms prepaid credit replenishment. One missing request probe returns an answer for 0.00151125 USD.
- Probe receipt 4be8c338-3566-4b4f-8eb7-b860b6cc0050 is preserved for free same-phase recovery. It must not be called again.
- Recovery archives original noise-0 and noise-1 reports/cassettes before removing only 5 network no-answer entries and 20 proven billing rejections. All returned answers remain cached.
- Gemini driver exec session 64488 resumes those two phases, then supervises noise-2 and TEST at two concurrent requests.
- Gemini uses medium and 300-second provider attempts; quota waits remain 60/120/240 seconds; HTTP 402 still stops the model.
- No unknown-charge hold is released. Runtime and scoring hashes stay unchanged. See evidence/gemini-topup-resume.json.
- Luna remains in sealed TEST at eight requests. Haiku is in noise-1 at two native processes.

## Automatic offline completion

- finish.py --wait runs as exec session 40010, PID 48739. It waits for all three supervisors to finish every phase, then runs attribution, strict limits, exact replay, statistics and report generation without provider keys.
- It validates all 18 phases and 379 units per model before generating the full report. It does not commit or push; review and git remain the main worker's next action.
- The cheater margin is not established on the pilot. evidence/cheater-gate-audit.json records the exact comparison and bounds mutation validity. The final report includes that disclosure without changing TEST scoring.
