---
title: The text a driver sent
summary: 'When a simulated user or an attacker sends other text than the spec block wrote, the block result records `realized`: the hash of the sent text, and the text itself with `campaign run --record-realized-text`, for audit and replay.'
commands: []
see_also:
  - running-simulate
  - running-campaign-run
  - running-campaign-resume
  - judging-campaign-rejudge
  - judging-pairwise
  - running-store
  - results-report
  - results-view
  - running-campaign-export-import
next:
  - running-simulate
---

## What it is

A spec block writes the user's text. Most runs send that text as written. Two kinds of driver send other text in its place:

* a simulated user (`campaign run --driver simulated`), which writes each turn from a persona;
* a red-team attacker, which writes each turn from its attack.

The block result then says what was really sent. Its field `realized` holds:

| Field | Always there | Holds |
|---|---|---|
| `hash` | yes | the SHA-256 of the sent text, as 64 hex characters |
| `text` | only with `--record-realized-text` | the sent text itself |

The sent text is the user messages the agent received in that block, joined by newlines. The hash is taken over that text written as a JSON string, the way every provenance hash is.

By default only the hash is kept. What a driver writes may be private, such as a persona's email or an attacker's payload. A stored campaign then holds no plain text a driver wrote. `--record-realized-text` keeps the text too.

Rules:

* A block that sends the text the spec wrote records no `realized`. So a scripted run records none, and its records stay as they were.
* Only the text counts. The same text sent in another form, such as an injection instead of a user turn, records nothing. The block's `injected` field says that.
* The provenance digest of a run covers `realized`. A baseline whose sent text was edited later no longer passes the provenance check.
* A run without `realized` keeps the digest it always had. Cache keys, Given hashes and spec hashes do not change.
* A campaign remembers the choice as `provenance.realizedText: true`. `campaign resume` reads it, so a resumed campaign keeps the text, or keeps only the hash, as it started.
* A copy into another campaign follows the choice of that campaign, not the choice of its source. A carried run, a block rerun, a re-judged run, a store write and an import drop `realized.text`. The new campaign must ask to keep it. `campaign export` applies the choice of the campaign it exports in the same way.
* A dropped text leaves the hash. The copy records `realizedTextStripped`: `fromRun`, and `fromCampaign` when it is known. The provenance digest of the copy covers that record and is computed again.
* Text that was never stored is never rebuilt. A copy cannot get back what its source did not hold.

The report pages show both texts. A block with `realized` shows "User, as written" (the spec's text) and "User, as sent". A block without it shows one "User".

### Where the sent text is read

* `compare --pairwise` judges two replies only when both blocks have the same verifiable sent text. It uses the stored `realized.text`. For a hash-only block it uses the spec's own text only when that text has the stored hash. Other pairs are skipped and counted as `differentStimulus` ("different stimulus" in the text output). Topic judging-pairwise.
* A label saved in `driftbench view` uses the sent text in its transcript. When that text is not available, the label saves `flags: ["sent text not stored"]`. Calibration leaves such a label out. Topic results-view.

## When to use it

* Audit a simulated or attacked run: read what the agent was really told before you blame the agent.
* Replay a stored simulated run with the exact turns it got.
* Check that two campaigns sent the same text, by comparing the hashes, without storing the text.

Use `--record-realized-text` only when the store may hold what the driver wrote. Leave it off when personas or attacks carry private data, or when the store is shared. The hash alone still tells you whether two runs sent the same text.

You do not need it for scripted runs: they send what the spec wrote, and record no `realized` at all.

## Commands and every option

| Option | Command | Default | Effect |
|---|---|---|---|
| `--record-realized-text` | `campaign run` | off | store `realized.text` beside `realized.hash` on every block whose driver sent other text than the spec wrote. Off, each such block keeps only the hash. |
| `--record-realized-text` | `campaign rejudge` | off | keep the `realized.text` the source runs hold in the new campaign. Off, the copies keep only the hash, even when the baseline recorded text. |

Rules for the option:

* It is a setting of one run. It has no key under `campaign:` in `driftbench.yaml`.
* `campaign resume` has no such option. It reads the choice the campaign was created with.
* It changes nothing for a scripted run.
* `campaign rejudge` only keeps text its source already holds. No command stores text that no run recorded. In code, the same switch is the run option `recordRealizedText`.

## Inputs

A campaign with a driver that writes its own turns. The free way, with no model call, is a simulated user replayed from a recording:

```text
driftbench campaign run <spec> --driver simulated --persona <persona.yaml> --recording <recording.yaml> --store <file> [--record-realized-text]
```

The recording holds the answers the persona gives, one per turn. Topic running-simulate describes personas and recordings.

## Outputs and how to read them

The command prints its usual cell lines. `realized` shows in three places:

1. The run record in the store, and in a bundle `campaign export` writes (`runs/<run>.json`): `blocks[].realized`.

   ```text
   "realized": {
     "hash": "<64 hex characters>",
     "text": "Sure, it's sam.rivera@example.com"
   }
   ```

   No `realized`: the agent got the spec's own text. `hash` without `text`: other text was sent, and the run kept only its hash. `hash` and `text`: other text was sent, and here it is.

2. The campaign record (`campaign.json` in a bundle): `provenance.realizedText: true` when the campaign keeps the text. Absent when it keeps only hashes.

3. The scorecard page `driftbench report` writes, and the run page of `driftbench view`. Each block with `realized` shows "User, as written" and "User, as sent". When only the hash was kept, "User, as sent" reads: `(other text than the spec wrote; not stored, only its hash <first 12 hex characters>. campaign run --record-realized-text stores it)`.

To check whether a text you hold is the one that was sent, hash it as a JSON string and compare with `realized.hash`. The worked example does this.

## Worked example

The plan-upgrade conversation, played by Sam from the hand-written recording, three times into one store: with only hashes, with the text, and scripted. No model is called.

```sh
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --no-cache --store sim.db --campaign sim-hash
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --record-realized-text --no-cache --store sim.db --campaign sim-text
driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --no-cache --store sim.db --campaign scripted
driftbench campaign export sim-hash --store sim.db --out out
driftbench campaign export sim-text --store sim.db --out out
driftbench campaign export scripted --store sim.db --out out
driftbench report sim-text --store sim.db --out sim-text.html
driftbench report sim-hash --store sim.db --out sim-hash.html
```

```text
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --no-cache --store sim.db --campaign sim-hash
Driver: simulated, persona sam-upgrader on acme-plan-upgrade, recording hand-written.
Campaign sim-hash: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --driver simulated --persona examples/acme/personas/sam-upgrader.yaml --recording examples/acme/personas/recordings/sam-upgrader.yaml --record-realized-text --no-cache --store sim.db --campaign sim-text
Driver: simulated, persona sam-upgrader on acme-plan-upgrade, recording hand-written.
Campaign sim-text: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
$ driftbench campaign run examples/acme/specs/conversations/plan-upgrade.yaml --no-cache --store sim.db --campaign scripted
Campaign scripted: 1 cell, 4 at a time. Checks: tools, tools_offered, forbidden, must, must_not, regex, exact, injection, length, markup, starts_with, finish_reason, json, tool_f1, refusal, rouge_l, bleu, sql, similarity, relevancy, knowledge_retention, lang, pii, cards, stage, skills, guards, references, subagents, execution, workspace, safety, artifacts, schema_strict, budget, end_state, custom.
Not judged: 2 criteria in 3 blocks of 1 spec (one_question_per_turn, no_invented_data), 1 of them gating. This campaign loads no judge, so these criteria have no verdict and count in no pass or fail. See docs/concepts/judges.md.
✓ acme-plan-upgrade · function:acme-sales · F · repeat 0  pass  5 blocks
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
(exit 0)
$ driftbench campaign export sim-hash --store sim.db --out out
Exported campaign sim-hash to out/sim-hash: 1 runs, 1 specs, 0 sources.
(exit 0)
$ driftbench campaign export sim-text --store sim.db --out out
Exported campaign sim-text to out/sim-text: 1 runs, 1 specs, 0 sources.
(exit 0)
$ driftbench campaign export scripted --store sim.db --out out
Exported campaign scripted to out/scripted: 1 runs, 1 specs, 0 sources.
(exit 0)
$ driftbench report sim-text --store sim.db --out sim-text.html
Margin auto: 79.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 79.3 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 79.3 points); about 22 goldens would.
Campaign sim-text: 1 runs, 1 pass, 0 fail, 0 did not complete.
Suite pass rate, mode F: 100.0% no interval: one cluster (one golden); 1 golden.
Wrote sim-text.html.
(exit 0)
$ driftbench report sim-hash --store sim.db --out sim-hash.html
Margin auto: 79.5 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 79.3 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 79.3 points); about 22 goldens would.
Campaign sim-hash: 1 runs, 1 pass, 0 fail, 0 did not complete.
Suite pass rate, mode F: 100.0% no interval: one cluster (one golden); 1 golden.
Wrote sim-hash.html.
(exit 0)
```

This script reads the exported bundles. For each block it prints the hash start, the text when kept, and whether the text hashes to the stored hash:

```js file=show-realized.mjs
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

for (const folder of process.argv.slice(2)) {
  const campaign = JSON.parse(readFileSync(`${folder}/campaign.json`, 'utf8'));
  console.log(`${folder}: realizedText ${campaign.provenance?.realizedText === true}`);
  for (const file of readdirSync(`${folder}/runs`)) {
    const run = JSON.parse(readFileSync(`${folder}/runs/${file}`, 'utf8'));
    for (const block of run.blocks) {
      const realized = block.realized;
      if (!realized) {
        console.log(`  block ${block.index}: no realized`);
        continue;
      }
      const shown = realized.text === undefined ? 'text not stored' : JSON.stringify(realized.text);
      const check =
        realized.text === undefined
          ? ''
          : `, hash matches: ${createHash('sha256').update(JSON.stringify(realized.text)).digest('hex') === realized.hash}`;
      console.log(`  block ${block.index}: hash ${realized.hash.slice(0, 12)}, ${shown}${check}`);
    }
  }
}
```

```sh setup
node show-realized.mjs out/sim-hash out/sim-text out/scripted
grep -c "User, as sent" sim-text.html
grep -o "not stored, only its hash [0-9a-f]*" sim-hash.html
```

```text
$ node show-realized.mjs out/sim-hash out/sim-text out/scripted
out/sim-hash: realizedText false
  block 0: hash 66538defdf1b, text not stored
  block 1: hash 64a3dd6aaa9c, text not stored
  block 2: hash 0b27c5b6b5ba, text not stored
  block 3: no realized
  block 4: hash d0c594beb29f, text not stored
out/sim-text: realizedText true
  block 0: hash 66538defdf1b, "Hello! I'm already an Acme customer and my phone keeps running out of data before the month ends.", hash matches: true
  block 1: hash 64a3dd6aaa9c, "Sure, it's sam.rivera@example.com", hash matches: true
  block 2: hash 0b27c5b6b5ba, "I'll take the unlimited one, please.", hash matches: true
  block 3: no realized
  block 4: hash d0c594beb29f, "No, that's all. Thanks a lot!", hash matches: true
out/scripted: realizedText false
  block 0: no realized
  block 1: no realized
  block 2: no realized
  block 3: no realized
  block 4: no realized
(exit 0)
$ grep -c "User, as sent" sim-text.html
4
(exit 0)
$ grep -o "not stored, only its hash [0-9a-f]*" sim-hash.html
not stored, only its hash 66538defdf1b
not stored, only its hash 64a3dd6aaa9c
not stored, only its hash 0b27c5b6b5ba
not stored, only its hash d0c594beb29f
(exit 0)
```

How to read it:

* `sim-hash` and `sim-text` give each block the same hash: the recording sent the same text both times.
* Only `sim-text` holds the text, and each text hashes to its stored hash.
* Block 3 has no `realized` in either simulated run: the recording sent the spec's own text there.
* `scripted` has no `realized`: the spec's own text was sent.
* The `sim-text` page shows "User, as sent" with the text. The `sim-hash` page says the text was not stored and gives the start of its hash.

## Common errors

| Message or symptom | Cause | Fix |
|---|---|---|
| `<path>: campaign: Unrecognized key: "record_realized_text"` (exit 2) | the setting is written under `campaign:` in `driftbench.yaml` | it is a setting of one run: pass `--record-realized-text` on the command line |
| `error: unknown option '--record-realized-text'` (exit 2) | the option on another command, such as `campaign resume` or `simulate` | only `campaign run` and `campaign rejudge` take it; a resumed campaign keeps its own choice |
| A page reads `(other text than the spec wrote; not stored, only its hash ...)` | the run kept only the hash | run the campaign again with `--record-realized-text`; a stored run cannot get its text back |
| A carried or re-judged run has the hash but no text, and the baseline had the text | the new campaign did not ask for the text, so the copy dropped it. `realizedTextStripped` names the source run | run the new campaign with `--record-realized-text` (`campaign rejudge --record-realized-text` for a re-judge) |
| `Skipped <n> pairs: different stimulus.` in the `compare --pairwise` summary | the two replies have no same verifiable sent text, so the pair is not judged | record the text on both campaigns, or compare runs that sent the same text |
| No `realized` on any block | the run was scripted, or the driver sent the spec's own text | expected: nothing differs, so nothing is recorded |
| `the baseline has no execution provenance`, and `campaign run --change --from` reruns the whole suite | the baseline's runs fail the provenance check, for example a `realized` edited by hand | use the stored baseline as it was written, or run a new full campaign as the baseline |
| `Legacy campaign has missing, incomplete or inconsistent execution provenance; run a new full campaign before re-judging.` | `campaign rejudge --from` on a campaign that fails the same check | run a new full campaign, then re-judge it |
| An older driftbench refuses a stored run with a schema error on `realized` | the store's schema version stays 2, so an older reader sees an unknown key, not a version message | read the store with this driftbench or a newer one |
