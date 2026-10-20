# Stub pilot evidence

Each executor directory contains eleven immutable candidate snapshots and full
compressed bank reports and stripped feedback, plus its own notes and red/green regression evidence.
The candidate and bank SHA-256 values in each report bind the measurement to
the source. `pilot.json` indexes all rounds; `journal.jsonl` carries the shared
validator schema. Commits in executor notes identify separate local histories;
the snapshots preserve their measured contents independently of those histories.

The `.ts.txt` suffix preserves measured source bytes without formatter changes.
To reproduce, restore a snapshot as TypeScript and follow `../PILOT.md` at the
recorded repository revision. Self-authored tests import `candidate.ts`; restore
that file beside them. Full reports are gzip-compressed JSON, not live-model
recordings. Executors received only the separate stripped failing-item feedback.

Host paths in executor notes and self-test logs are normalized to placeholders. Candidate snapshots
and compressed reports are copied byte for byte. Bank timing is measured; repair
timing is supplied only where the executor recorded it. A journal token estimate
of zero means usage was unavailable, not that executor reasoning had no cost.
