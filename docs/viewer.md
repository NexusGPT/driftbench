# The viewer and hand labels

`driftbench view` serves a store as a local website: the campaigns, each campaign's scorecard, every run block by block, and the comparison of two campaigns. Under every block, a person can mark the block pass or fail on a criterion, with a note. The label goes to the folder that [`driftbench judge calibrate --labels`](concepts/judges.md) reads. The judges are calibrated against those labels.

The viewer listens on `127.0.0.1` only. Its pages use the scorecard's renderer and style, in light and dark, at phone width. They load no external asset. A content security policy allows only the optional keyboard scripts described below and the font faces the scorecard embeds as data; all forms work without JavaScript.

Requests must use the exact `127.0.0.1:<port>` address printed at startup. Other Host headers are refused to block DNS rebinding. Writes also require the viewer's own Origin, or a same-origin Referer when Origin is absent, and a hidden form token generated at each start. The token is 32 random bytes from the system's cryptographic generator (64 hex characters), generated at each start and never written to disk; an old token is refused after a restart. Rejected requests return HTTP 403 with a plain message and write nothing. The write routes (`/labels` and `/queue/assign`) accept POST only; after the Host and origin checks, PUT, DELETE, PATCH, HEAD and OPTIONS return HTTP 405 and write nothing. Any other method is refused and writes nothing. GET returns HTTP 404, TRACE returns HTTP 405, and Node closes CONNECT without an HTTP response before it reaches the viewer's request handler. Reload an old form after restarting the viewer. These checks need no JavaScript.

POST, PUT, PATCH and DELETE with a foreign Origin or Host return 403 before route handling, even with a valid form token. GET skips the Origin check but still requires the exact Host; its page behavior is unchanged.

## Start it

```sh
pnpm driftbench view --store driftbench.db --labels examples/acme/labels --labelled-by "your name"
```

```
driftbench view at http://127.0.0.1:4317
Store /path/to/driftbench.db, labels in /path/to/examples/acme/labels. Stop with Ctrl+C.
```

| Flag | Default | Meaning |
|---|---|---|
| `--store <file>` | `driftbench.db` | the store to read; the command stops with exit 2 when it is missing |
| `--port <n>` | `4317` | the port; `0` picks a free one |
| `--labels <dir>` | `labels` | the labels folder labels are written to |
| `--labelled-by <name>` | `a reviewer, in driftbench view` | written as `labelled_by` in a new labels file |

The command runs until Ctrl+C. Exit 0 after a stop, 2 when the store is missing, the port is not a number, or the port cannot be opened. With a store that is not there, it prints this and exits 2:

```text
No store at <your folder>/missing.db. Give one with --store <file>.
```

## The pages

| Address | Shows |
|---|---|
| `/` | every campaign of the store, newest first, with its modes, specs, runs and how many pass |
| `/campaign/<id>` | the campaign's [scorecard](scorecards.md), spread view included; every run in the drilldown links to its own page |
| `/campaign/<id>/run/<runId>` | one run: its timeline first, every event in order (a model call with its start, end, tokens and cost, when the adapter reports them; plain HTML, no script), then every block in full: what the user sent, the reply, the tool calls with their results, every verdict that did not pass and every judged verdict with its evidence and reasoning; a label form under each block |
| `/compare` | two campaigns picked from the store and a margin; the result is the paired comparison of [`driftbench compare`](concepts/statistics.md#comparing-a-baseline-and-a-candidate) with its verdict |

## Review queue

A review queue is the list of blocks a reviewer still has to label, kept as `<labels>/queue.json` beside the labels. Each item is one block and one criterion, open, assigned to a reviewer, or done.

```text
driftbench queue create --store driftbench.db --campaign c-acme-x3 --labels labels
driftbench queue list --labels labels
driftbench queue assign <runId>.b<index> --criterion <name> --reviewer <name> --labels labels
```

`queue create` queues each block of the campaign once per criterion of its spec, skipping blocks already labelled. The viewer's `/queue` page lists the items. "Take" assigns an item to the viewer's reviewer, "Label it" opens its block, and saving the label there marks the item done. Another reviewer cannot take or label an item held by someone else. A label written from the queue is the same label file `judge calibrate` reads.

A second reviewer records a view of a block with `driftbench queue vote`, which does not write the labels file. `driftbench queue agreement` then prints, over the items with two votes, how many agree and Cohen's kappa between the first two reviewers. The queue page shows that agreement line too. On the queue page only, `j` and `k` move focus between the items, and Enter opens or takes the focused one. That one script is allowed by the hash of its exact text in the page's Content-Security-Policy, and nothing else on the viewer runs script. The label form on a block page has the same kind of keys, also by script hash: 1 checks pass, 2 checks fail (not while typing in the note), Cmd or Ctrl+Enter saves. ArrowDown and ArrowUp move between blocks on a block page. Every page links to `/keys`, a plain cheatsheet with no script; `?` opens it too. Every action works without script: each one is a link or a form that posts to the viewer, and the browser journey checks a label saved with script off. The exported HTML scorecard stays script-free.

## Labelling a block

The form under a block offers the judged criteria of its spec, and any judged criterion that voted on the block. Pick one, choose pass or fail, write why, and save. The page comes back on the same block with "Label saved". The label shows under the block, and the labelling section counts the labels per criterion.

The saved transcript uses `realized.text` when stored. A hash-only block uses the authored message only when its hash matches. Otherwise the label omits the user message and saves `flags: ["sent text not stored"]`; the viewer marks it as excluded from calibration. Both normal and cascade calibration ignore these labels, even when supplied directly through the SDK. Message anchors refer to the saved transcript.

One label is one block of the criterion's labels file, `<labels>/<criterion>.yaml`, in the format `judge calibrate` reads:

* `id` is `<runId>.b<block>`.
* The transcript holds the user turn, each tool call and its result, and the reply.
* Labelling the same block on the same criterion again replaces its label. Every other block, and the file's `labelled_by`, stay as they were.

A label saved from a run of the Acme campaign with the fault that skips the recap, as the file holds it. The run id in `id` differs in your store:

```text
criterion: checks_before_promising
labelled_by: a reviewer
blocks:
  - id: e0e9d0a17cada34e.b3
    label: fail
    note: Order placed with no recap.
    transcript:
      - role: user
        text: Dana Brooks, dana.brooks@example.com
      - role: tool_call
        text: '{"type":"new","plan_id":"mobile-m","customer":{"name":"Dana Brooks","email":"dana.brooks@example.com"},"port_number":"+12025550150"}'
        tool: order.create
      - role: tool_result
        text: '{"order_id":"ORD-831EE0","status":"pending","plan_id":"mobile-m","monthly_usd":25}'
        tool: order.create
      - role: agent
        text: "Done. Your order ORD-831EE0 is placed: Acme Mobile M. Your number +1 202 555 0150 moves to Acme one business day after the order."
```

`judge calibrate` needs at least one pass and one fail label per criterion, or kappa has nothing to measure. The labelling section says when a criterion still lacks one of the two.

From code, `saveLabel(dir, criterion, block, labelledBy)` and `readLabelFile(dir, criterion)` of `@agent-nexus/driftbench-judges` write and read the same files.

## Anchors on a label

The label form has an anchor select. Its options are each line of the block's transcript, by index, and each tool call, by name and occurrence. The label file keeps the chosen anchor, and `judge calibrate` reads it. An anchor the block does not have is refused with a 400 response, and no label is written. Choose no anchor to label the whole block.

## Field, span and score

The anchor select also offers a field of a tool output (`field:<tool>:<path>`, the dot path of a leaf of its JSON output) and a runtime event of the block (`span:<guard|skill>:<name>`). A call that the run recorded with its trace span id (an OpenTelemetry span, when the adapter has one) is offered as `span:<span id>`, so the label names that span. A timeline call without a span id is offered as `span:event:<position>`. A span cannot be checked against the transcript, so its label stands as written. The label form has a score box, which is kept on the reviewer's vote when the label completes a queue item. Its range is the criterion's scale in the config file (`--config`, default `driftbench.yaml` when it exists, set with `scales:` per criterion, `min` below `max`), and 0 to 1 when the criterion has none. A score outside that range is refused with a 400 and nothing is saved.

