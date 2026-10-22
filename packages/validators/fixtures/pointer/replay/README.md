# Independently authored replay fixtures

The three JSONL cassettes have matching JSON sidecars. The sidecars contain public fictional files, explicit unit boundaries and labels, canonical requests, and the corresponding cassette rows. Labels were assigned in the source recipe before any reader ran. No reader, reference implementation, cutter, model, or recording run produces these assets.

Each arm has the same three files and nine units. Each file has one `rule`, one `prohibition`, and one `example`. `expected` names every unit by file and exact source text. A successful replay must return every label, not merely a nonempty ledger.

`makeFixture` in `src/ladders/pointer/kit/fixture.ts` serializes these authored units. Tests reconstruct each asset and compare it byte-for-data with the committed asset, then check SHA-256 of every canonical wire request. This independent construction also supports planted dynamic inputs; it never consumes SUT output.

The wire schema is pinned to [the reviewed reader revision](https://github.com/achammah/driftbench/tree/5ad1e263a/packages/estate/src/pointer): `labeler.ts` supplies the published model request representation, `cassette.ts` supplies canonical hashing and readable metadata, and `cut.ts` supplies the cassette digest representation. These are compatibility formats, not expected labels. The suite imports none of those implementation modules.

The JSON sidecar contains public fixture source text and canonical requests for audit. The nested `cassette` contains only hashes, readable metadata, labels/probabilities and receipts; it contains no file text.

All twelve legacy `replay.fixture-*` IDs retain their identities. Each performs an exhaustive positive replay before changing exactly one readable field. Keys and answers stay unchanged. This tests the contract that readable metadata must agree with the current request even on a key hit. Prompt/schema versions and cut digests are outside the wire payload, so changing them cannot honestly be represented by flipping the key.

Four former unchanged-replay items now probe `part.messages`, `part.state`, `path`, and `window`. Their cause changes from `cassette:fixture-replays` to `cassette:miss-names-field`; the PR body records each item. Every remaining fixture ID keeps its cause.

Recording-format items still inspect recording outputs. A bank-wide replay test corrupts every emitted recording key and requires every replay-family item to pass: no later input may depend on those outputs.

Key and runs. A row's key is the SHA-256 of the canonical `{ wire, readable }`; `readable` carries `cls` (`system2` for the Haiku arm, `system1` for the Jev arms) and `run`. The reader asks a system 2 window for five runs, so the Haiku fixture holds the same recorded answer under `run` 1 to 5 for each window; a Jev window is asked once. The Jev request is one choice question per unit (`u<n>`), its options the labels of the set and `none`. The keys of every row were checked equal to the keys the pointer reader derives for the same files, sets and windows.
