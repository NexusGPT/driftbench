# The viewer and scorecards

This is a hands-on guide to the two ways to read a stored campaign. `driftbench report` writes the **scorecard**, one HTML page you can mail or attach to a CI job. `driftbench view` serves a **viewer**, a local website where you browse campaigns, read each run block by block and label a block by hand. You run a campaign, write a scorecard, break the agent on purpose, read the failing run and put a label on it. It uses the Acme Telecom sample agent, so nothing calls a model and nothing is paid for. Every command below is run by a test on GitHub, except the viewer itself, which runs until you stop it. The full detail is in the [viewer reference](../viewer.md), the [scorecard reference](../scorecards.md) and the [CLI reference](../reference/cli.md).

## Before you start

**Why you do this.** A pass rate is only a number. The scorecard puts an interval on it and shows which tests failed. The viewer shows what the agent said in a failing block, so you can decide whether the agent or the test is wrong.

**You need.**

- Node 22.13 or newer, and driftbench installed from a clone, as the [guide index](index.md#install) shows. That gives you the command `driftbench`. Run this page from the root of the clone.
- The folder `examples/acme` of the repository. Its **specs** (test files) are the tests. Acme is a made-up phone company, and its sales assistant is a small program.
- A web browser, for the viewer. The tests of this page do not open one.

**Ten words first.**

- A **campaign** runs many tests on one agent and keeps every result.
- A **store** is one file, a SQLite database, that keeps campaigns and their runs.
- A **run** is one test, on one agent, in one mode, once.
- A **block** is one exchange inside a run: what the user says and what the agent must answer.
- A **check** is a rule that code tests on a reply.
- A **verdict** is the pass or fail that one check gives on one block.
- A **scorecard** is the HTML page of one campaign.
- A **zone** is one of the three big parts of the scorecard: Pass rates, Tests and Runs. A **case** is one test in one mode. The statistics call it a golden.
- A **label** is a pass or fail that a person puts on a block, with a note.
- A **review queue** is the list of blocks that still wait for a label.

## 1. Run a campaign and keep it

**Why you do this.** The scorecard and the viewer read a store. This step makes one, with a campaign of twelve runs.

**You need.** The folder `examples/acme/specs/conversations`. It holds six specs.

**Relevant commands.**

- `driftbench campaign run`: sends each block of each spec to the agent, checks each answer and keeps the runs · `examples/acme/specs/conversations` is the folder of specs. `--mode T,F` runs each spec in two modes. `--store acme.db` is the file that keeps the runs. `--campaign c-acme` names the campaign · it prints one line per run and a count, and writes `acme.db`.

**You type.**

```console
$ driftbench campaign run examples/acme/specs/conversations --mode T,F --store acme.db --campaign c-acme
✓ acme-new-customer-coverage · function:acme-sales · T · repeat 0  pass  4 blocks
✓ acme-tool-failure · function:acme-sales · F · repeat 0  pass  3 blocks
12 cells: 12 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.**

- A line shows a mark, the spec, the agent, the mode, the repeat, the state and the number of blocks. `✓` is a pass.
- Mode `T` feeds the agent the recorded history. Mode `F` lets it carry its own earlier replies. The page [Campaigns](campaigns.md) explains both.
- `12 cells` is six specs in two modes. The command prints twelve lines. This page shows two.
- Before the lines, driftbench prints a `Not judged:` note. Some criteria need a model to read the answer, and this campaign loads none. [Judge answers](judge-answers.md) adds one.

**If it goes wrong.**

- `Campaign c-acme already exists. Resume it with: driftbench campaign resume c-acme` with exit 2: the store holds that name. Pick another `--campaign`, or delete `acme.db`.

## 2. Write the scorecard

**Why you do this.** The scorecard is the page you hand to someone else. It is one file. It loads nothing from the network, so it opens the same in a mail attachment or a CI artifact.

**You need.** The store `acme.db` and the campaign `c-acme` of step 1.

**Relevant commands.**

- `driftbench report`: reads one stored campaign and writes its scorecard · `c-acme` is the campaign. `--store acme.db` is the file to read. `--out card.html` is the page to write. `--junit card.xml` also writes the results as JUnit XML, the format that CI systems read · it prints a summary and writes the two files. It exits 0 when written and 2 on bad input.
- `grep`: finds text in a file · `-o` prints only the part that matches. The pattern picks the headings of the three zones · it prints one line per heading. `-c` prints the number of matching lines, and the pattern `<script` shows whether the page holds a script.

**You type.**

```console
$ driftbench report c-acme --store acme.db --out card.html --junit card.xml
Campaign c-acme: 12 runs, 12 pass, 0 fail, 0 did not complete.
Suite pass rate, mode T: 100.0% [59.0%, 100.0%] (hierarchical 95% interval); 6 goldens, n_eff 6.0 runs (every run agrees, so each golden counts once), detectable drop 72.7 points at 80% power.
Wrote card.html and card.xml.
$ grep -o '<h2 id="h-[a-z]*">[^<]*</h2>' card.html
<h2 id="h-charts">Pass rates</h2>
<h2 id="h-tests">Tests</h2>
<h2 id="h-runs">Runs</h2>
<h2 id="h-details">All details</h2>
$ grep -c '<script' card.html   # exit 1
0
```

**How to read it.**

- `12 runs, 12 pass`: the raw count. Twelve runs, all passed.
- `Suite pass rate, mode T: 100.0% [59.0%, 100.0%]`: the headline of mode T. All six tests passed, and the range still starts at 59.0%. Six tests cannot rule out a true rate of 60%.
- `6 goldens` counts the tests in the mode. `n_eff 6.0 runs` is the number of independent runs the suite is worth. With one run per golden it equals the number of goldens.
- `detectable drop 72.7 points`: a later campaign of this size can only show a drop of at least that many points. Add tests to shrink it.
- The four headings are the zones of the page. The first three are what you read. `All details` folds every table behind the numbers.
- `grep -c '<script'` prints `0` and exits 1, because `grep` exits 1 when it finds no match. The page holds no script. Its controls are radio buttons and links.
- Open `card.html` in a browser. It is dark by default. The Light button at the top switches the theme.

**If it goes wrong.**

- `No store at acme.db: this command reads a store and does not make one.` with exit 2: you ran `report` before `campaign run`, or in another folder.
- `No campaign nope in acme.db.` with exit 2: the campaign name is wrong. Leave it out to read the latest campaign of the store.

## 3. Read the scorecard, zone by zone

**Why you do this.** The page has a fixed order. Knowing it lets you find a failing run in a few clicks.

**You need.** The page `card.html` of step 2, open in a browser.

Read it from top to bottom.

| Part | What it shows |
|---|---|
| Overview | The campaign id and its facts: when it ran, the number of targets and modes, the money spent. Then three tiles: cases passing, runs passing, blocks passing. A line under the tiles counts tests, cases, runs, blocks and checks. |
| Versions | Only with a baseline. The baseline and the candidate side by side, with the change between them. Step 4 shows how to get it. |
| Zone 1, Pass rates | Three bar charts: cases passing by test, runs passing by mode with the 95% interval, and failed checks by check type. Hover a bar for its numbers. |
| Zone 2, Tests | One row per test, worst first. A pass or fail chip, the title, the cases and runs passing, and the failed checks by family. Filters: All, Failing, Passing, and Regressed with a baseline. Open a row to see its cases. |
| Zone 3, Runs | One row per run, failing runs first. A click opens the **panel** of the run, with three tabs. |
| All details | Every table behind the numbers, folded: reliability per golden, the succession of blocks, the compounding index, recovery after a deviation, the spread, and how each number is made. |

A case passes when every repeat of it passes.

The panel of a run has three tabs.

- **Conversation**: every block in order. It shows what the user sent, the reply, each tool call with its input and output, and every check that did not pass.
- **Checks**: every verdict with its evidence, and the place where a verdict stopped the run.
- **Run data**: the agent, the mode, the repeat, the status, the cost, the first drift and the end state.

Two more facts help.

- A run has its own address, `#run-<runId>`. A link to that address opens the panel of that run.
- The Runs zone lists 200 runs at most, failing runs first. Raise `--max-runs` for more.

## 4. Break the agent and read a regression

**Why you do this.** A scorecard of all passes shows little. This step runs a faulty copy of the Acme assistant, compares it with the baseline and writes a scorecard that has something to read.

**You need.** The store `acme.db`, with the baseline `c-acme`. The fault `fault:x3-skips-recap` is a copy of the Acme assistant with a bug planted on purpose. It places an order without the recap that asks the customer to confirm.

**Relevant commands.**

- `driftbench ci`: runs the specs on a candidate agent and compares the result with a baseline campaign · `--specs examples/acme/specs/conversations` is the folder of specs. `--target fault:x3-skips-recap` is the faulty agent. `--faults examples/acme/faults` is the folder that defines it. `--mode T,F` is the modes. `--baseline c-acme` is the campaign to compare with. `--store acme.db` holds both. `--out x3.json` is the summary file · it prints the comparison and a verdict. It exits 0 on parity, 1 on a regression or a comparison that does not show parity, and 2 on bad input.
- `driftbench report`: as in step 2 · without a campaign name it reads the latest campaign of the store, which is the one `ci` just stored. `--baseline c-acme` adds the Versions zone and the regressed counts · it writes `x3.html` and `x3.xml`.

**You type.**

```console
$ driftbench ci --specs examples/acme/specs/conversations --target fault:x3-skips-recap --faults examples/acme/faults --mode T,F --baseline c-acme --store acme.db --out x3.json   # exit 1
Verdict: REGRESSION. Exit 1.
Summary: x3.json
$ driftbench report --store acme.db --baseline c-acme --out x3.html --junit x3.xml
Against baseline c-acme: regressed, margin 24.5 points.
Wrote x3.html and x3.xml.
```

**How to read it.**

- `Verdict: REGRESSION`: six of the twelve goldens passed on the baseline and fail on the candidate. None improved.
- `Against baseline c-acme: regressed, margin 24.5 points`: the **margin** is the largest drop you accept. Here driftbench chose it itself, as the smallest drop these tests can show. The comparison fails even so.
- The new scorecard has a Versions zone with the two campaigns side by side. Zone 2 has a Regressed filter. Use it to list the six goldens that changed.
- Open `x3.html`, click the Failing filter in Zone 2, and open a failing row. The three failing tests are number porting, a plan upgrade and an order that waits for confirmation.

**If it goes wrong.**

- `error: unknown option '--campaign'` with exit 2: `ci` names its candidate campaign itself. Leave `--campaign` out, and read the latest campaign with `report`.
- An `Underpowered` line in the `ci` output: some checks were decided on fewer than 30 goldens. They are left out of the parity test. `--strict` puts them back.

## 5. Open the viewer

**Why you do this.** The scorecard is a file. The viewer is a website that lists every campaign of a store, opens any run and compares two campaigns. It is also the place where you label blocks.

**You need.** The store `acme.db` of step 4, with two campaigns.

**Relevant commands.**

- `driftbench view`: serves the store as a local website and runs until you stop it · `--store acme.db` is the store to read. `--port 0` picks a free port, and the default is 4317. `--labels labels` is the folder that labels are written to, the one `judge calibrate --labels` reads. `--labelled-by "your name"` is written in a new label file · it prints the address and the two folders.

**You type.** The command never ends, so our tests do not run it. Run it in its own terminal:

```bash
driftbench view --store acme.db --port 0 --labels labels --labelled-by "your name"
```

**You see.** The first lines look like this. The port differs at every start:

```
driftbench view at http://127.0.0.1:59144
Store /path/to/acme.db, labels in /path/to/labels. Stop with Ctrl+C.
```

I recorded these two lines from a real start. Our tests did not print them.

**How to read it.**

- Open the exact address on the first line, such as `http://127.0.0.1:59144`, in a browser.
- The viewer listens on `127.0.0.1` only. Nobody else on your network can reach it.
- Press Ctrl+C in the terminal to stop it. It exits 0 after a stop.
- Use the number the line prints. A request for `localhost` gets the page `Forbidden: untrusted Host.` The viewer refuses other host names to block a web trick named DNS rebinding.

**The pages of the viewer.**

| Address | What it shows |
|---|---|
| `/` | Every campaign of the store, newest first. It shows the modes, the specs, the runs and how many pass. |
| `/campaign/<id>` | The scorecard of the campaign, the same page as `report` writes. Each run in the Runs zone links to its own page. |
| `/campaign/<id>/run/<runId>` | One run: a timeline, then every block in full, with a label form under each block. |
| `/compare` | Two campaigns picked from the store and a margin. The result is the paired comparison of `driftbench compare`, with its verdict. |
| `/queue` | The review queue, with one row per block and criterion. |
| `/keys` | A plain cheatsheet of the keyboard keys. |

Two refusals you can check without a browser:

```console
$ driftbench view --store missing.db   # exit 2
No store at missing.db. Give one with --store <file>.
$ driftbench view --store acme.db --port 70000   # exit 2
--port takes a whole number from 0 to 65535, not "70000".
```

**If it goes wrong.**

- `No store at missing.db. Give one with --store <file>.` with exit 2: the default store is `driftbench.db` in the current folder. Name your store.
- `Cannot serve the viewer: ...` with exit 2: the port is taken. Pass another port, or `--port 0`.
- `Forbidden: invalid form token.` after a save: you restarted the viewer. Reload the page and save again.

## 6. Read a run page

**Why you do this.** The run page shows what the agent really did, block by block. It is the page to open when a test fails.

**You need.** The viewer open on `acme.db`. In the list of campaigns, open the faulty campaign. In its Runs zone, open the run of `acme-number-porting` in mode T.

First, find the failing block in the terminal.

**Relevant commands.**

- `driftbench campaign status`: prints the state of every run of a stored campaign · `--store acme.db` is the file. Without a campaign name it reads the latest one. `--json` prints every verdict with its evidence in place of the lines · it prints one line per run. It exits 1 while a run fails.

**You type.**

```console
$ driftbench campaign status --store acme.db   # exit 1
✓ acme-new-customer-coverage · fault:x3-skips-recap · T · repeat 0  pass  4 blocks
✗ acme-number-porting · fault:x3-skips-recap · T · repeat 0  fail  block 3 forbidden.order.create, block 3 must.0, block 3 must.1, block 3 stage.reached
12 cells: 6 pass, 6 fail, 0 failed. Spent $0.00.
$ driftbench campaign status --store acme.db --json   # exit 1
```

The second command prints every verdict of every block as JSON. This is the evidence of the first failing check:

**How to read it.**

- The failing line names block 3 and four checks: `forbidden.order.create`, `must.0`, `must.1` and `stage.reached`. The part before the first dot names the kind of check.
- Open that run in the viewer, and scroll to block 3.

**The run page, from top to bottom.**

- **Labelling.** A line says where labels go and whether the folder holds any yet.
- **Timeline.** Every event of the run in order, each with its time. The events are the start of a block, each tool call, and the end of a block with its verdict. A model call shows its tokens and cost when the agent reports them. This timeline is the trace of the run.
- **Blocks.** For each block, the page shows what the user sent and what the agent replied. It lists the tool calls with their input and output, and the stage the agent reached.
- **Verdicts.** Every verdict that did not pass, and every judged verdict, with its evidence. The checks that passed are listed in one line.
- **Label form.** A form under each block, to put a label on it.

```text
              "evidence": "order.create called 1 time (call-1); the block expects it 0 times"
```

In block 3, the user sent a name and an email. The agent called `order.create` and answered "Done. Your order is placed". The verdicts say why this fails:

- `forbidden.order.create` fails. The block expects zero calls to `order.create`, because the order must wait for a recap and a confirmation.
- `must.0` and `must.1` fail. The reply holds neither the recap of the number nor the word `CONFIRM`.
- `stage.reached` fails. The agent reached the stage `order_placed`, and the block expects the stage `recap`.
- Block 4 passes, because the customer then writes "Confirm". The fault only skipped the recap.

**If it goes wrong.**

- The page shows fewer runs than the campaign has: the Runs zone stops at 400 runs in the viewer. Open a run from the Tests zone.

## 7. Label a block by hand

**Why you do this.** A judge is a model that reads an answer. You trust a judge only as far as it agrees with people. Hand labels are what it is compared with.

**You need.** The run page of step 6, open on block 3.

**What you do in the browser.**

- Under the block, pick a **criterion** in the form. A criterion is the question you answer, such as `checks_before_promising`: does the agent check before it promises?
- Choose pass or fail. Write why in the note. Press Save label.
- The page comes back on the same block with "Label saved". The labelling section counts the labels per criterion.
- Optionally, pick an **anchor**: a line of the block, a tool call or a field of a tool output. The label then points at that place. Choose "no anchor" to label the whole block.
- Optionally, write a score between the bounds of the criterion. A score out of range is refused with HTTP 400 and nothing is saved.
- With script on, `1` marks pass and `2` marks fail. Cmd or Ctrl+Enter saves. ArrowDown and ArrowUp move between blocks. Every action also works with script off.

**What it writes.** One file per criterion, `labels/checks_before_promising.yaml`. This is the file that a real save of this block wrote:

```yaml
criterion: checks_before_promising
labelled_by: your name
blocks:
  - id: 48d92ce0d10c6c2a.b3
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

This file was recorded from a real save in the viewer. Our tests cannot click a button.

**How to read it.**

- `id` is the run id, a dot, and `b` with the block number. Label the same block on the same criterion again, and the new label replaces the old one. Every other block stays.
- The `transcript` holds the user turn, each tool call with its result, and the reply. It is what a judge would read.
- The file has the format that `judge calibrate` reads. That command needs at least one pass and one fail label per criterion, or there is nothing to measure.
- The folder `examples/acme/labels` holds a ready set of hand labels. The command `head -2` shows the start of one file:

```console
$ head -2 examples/acme/labels/checks_before_promising.yaml
# Hand-labelled blocks for checks_before_promising. Fictional numbers in the reserved 555-01xx range.
criterion: checks_before_promising
```

**The review queue.** When several people label, a queue stops two of them from taking the same block. The next commands make the queue, take one item and read the agreement.

**Relevant commands.**

- `driftbench queue create`: lists every block of a campaign that has no label, once per criterion of its spec · `--store acme.db` is the store. `--campaign c-acme` is the campaign. `--labels labels` is the folder where `queue.json` is kept · it prints how many items it queued.
- `driftbench queue assign`: gives one item to one reviewer · `46214b315db4a5c4.b1` is the run id, a dot and the block. `--criterion checks_before_promising` is the question. `--reviewer reviewer-a` is the person. `--labels labels` is the folder · it prints who holds the item.
- `driftbench queue agreement`: prints how often the first two reviewers agree, with Cohen's kappa, over the items that two people voted on · `--labels labels` is the folder · it prints one line.

**You type.**

```console
$ driftbench queue create --store acme.db --campaign c-acme --labels labels
Queued 98 items in labels.
$ ls labels
queue.json
$ driftbench queue assign 46214b315db4a5c4.b1 --criterion checks_before_promising --reviewer reviewer-a --labels labels
46214b315db4a5c4.b1 (checks_before_promising) is assigned to reviewer-a.
$ driftbench queue assign 46214b315db4a5c4.b1 --criterion checks_before_promising --reviewer reviewer-b --labels labels   # exit 2
46214b315db4a5c4.b1 is assigned to reviewer-a
$ driftbench queue agreement --labels labels
No item has two votes yet: no agreement to report.
```

**How to read it.**

- `Queued 98 items`: the campaign holds 52 blocks. Each block is queued once for every judged criterion of its spec, so the count is larger.
- The second `assign` exits 2. The item belongs to `reviewer-a`, so `reviewer-b` cannot take it or label it.
- The `/queue` page of the viewer lists the same items. `Take` assigns one to you, and `Label it` opens its block. Saving the label marks the item done.
- A second reviewer records a view with `driftbench queue vote`, which does not write the labels file. Then `queue agreement` has votes to compare. If two people rarely agree, the question is unclear. Rewrite it before you ask a judge to agree with them.

**If it goes wrong.**

- `queue create` exits 2 with an unknown campaign: the id is not in that store. Check the name after `--campaign`.
- `Forbidden: invalid form token.` after a save: the form token changes at every start of the viewer. Reload the page.
- `judge calibrate` says a criterion lacks labels: it needs at least one pass and one fail label for that criterion.

## What you have now

- A scorecard of a campaign, with an interval on every rate and a page for every failing run.
- A comparison of two campaigns, written as a scorecard with a Versions zone.
- A local viewer on `127.0.0.1`, with a timeline for each run, and a label file that `judge calibrate` reads.
- A review queue that keeps two reviewers off the same block.

To go further, [Judge answers](judge-answers.md) calibrates a judge against your labels. [Read the numbers](read-the-numbers.md) explains the intervals and the margin. [Traces](traces.md) shows how a recorded session becomes a draft test.
