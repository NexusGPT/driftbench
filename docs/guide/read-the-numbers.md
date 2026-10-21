# Read the numbers

This part teaches you to read a pass rate and to trust it only as far as it deserves. You plan a run, run a baseline, read its scorecard, compare two versions of an agent, gate a change, and watch a series of runs. Every command below is run by a test on GitHub, and every output shown is what the command printed. Nothing calls a model and nothing is paid for. Two things are the exception, and the page says so where they appear: a script that needs the driftbench packages, and a viewer that runs until you stop it.

The examples use the Acme Telecom sales assistant that ships in `examples/acme`, tested by its golden suite of 10 tests. All data is fictional. In a clone of this repository, run `pnpm install` and put `pnpm` in front of every `driftbench` below.

## Words used in this part

| Word | Plain meaning | Example |
|---|---|---|
| Rate | The share of runs that pass. | 18 passes in 20 runs is a rate of 90%. |
| Interval | The range in which the true rate probably lies, given how many runs you made. | 90% with an interval of 69.9% to 97.2%. |
| Wilson interval | A standard way to compute that range. It stays sensible for small counts and for rates near 0% or 100%. | The interval above is a Wilson interval. |
| Repeat | Running the same test again, because an agent can answer differently each time. | `--repeats 5` runs each test 5 times. |
| Golden | One test in one mode, with every repeat of it. It passes when every repeat passes. | `acme-order-loose-confirmation` in mode F. |
| Rho | How much the repeats of one test resemble each other, from 0 to 1. 0 means they are independent. | `--rho 0.3`. |
| Design effect | How many times fewer independent runs your runs are worth, because repeats resemble each other. It is `1 + (repeats - 1) * rho`. | 5 repeats at rho 0.3 give 1 + 4 * 0.3 = 2.2. |
| Minimum detectable effect | The smallest drop in pass rate that a campaign can tell apart from luck. | 36.4 points. |
| Baseline | The version of the agent you trust, and compare against. | The campaign `v1`. |
| Candidate | The version you want to check. | The campaign `v3`. |
| Paired | Compared golden by golden: the same test on both versions, each against itself. | Golden A passes on `v1` and fails on `v3`. |
| Margin | The largest drop in pass rate you accept, in points. A point is one percentage point. | 28 points. |
| Non-inferior | Not worse than the baseline by more than the margin, with the evidence to say so. | Verdict `NON-INFERIOR`. |
| Regression | Evidence that the candidate is worse. | Verdict `REGRESSION`. |
| Scorecard | One HTML page that shows every number of a campaign with its interval. | `v1.html`. |

## 1. Why one score is not enough

**Why you do this.** "8 of 10 passed" sounds firm. It is not. Another 10 runs may give 6 or 10. Before you compare anything, you need to see how wide the doubt is.

**You need.** Six goldens, each run a few times. Here is how many runs passed in each:

| Golden | Runs that passed |
|---|---|
| 1 and 2 | 5 of 5 |
| 3 | 4 of 5 |
| 4 | 0 of 5 |
| 5 | 2 of 5 |
| 6 | 2 of 2 |

In all, 18 of 27 runs passed: a rate of 66.7%.

**Relevant commands.**

- `npx tsx headline.ts`: runs a short script that computes three intervals for those numbers · `headline.ts` is the script below · it prints three lines, one per interval. The guide tests do not run it, because it imports the driftbench packages and so needs a project that installed them. The repository checks it in `tools/docs/readme-yaml.test.ts`, which runs the script and compares its output with the lines shown here.

```ts
// file: headline.ts
import { hierarchicalBetaBinomial, wilson, wilsonEffective } from '@agent-nexus/driftbench-stats';

// Six goldens: k of n runs passed in each.
const goldens = [
  { n: 5, k: 5 },
  { n: 5, k: 5 },
  { n: 5, k: 4 },
  { n: 5, k: 0 },
  { n: 5, k: 2 },
  { n: 2, k: 2 },
];
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const show = (i: { estimate: number; lower: number; upper: number }) =>
  `${pct(i.estimate)} [${pct(i.lower)}, ${pct(i.upper)}]`;

// Too narrow: 18 of 27 runs read as independent samples.
console.log(`Naive Wilson:    ${show(wilson(18, 27))}`);
// The runs a rate over goldens is worth, once the spread between goldens is measured.
const runs = wilsonEffective(goldens);
console.log(`Wilson on n_eff: ${show(runs)}, n_eff ${runs.effectiveN.toFixed(1)}`);
// The suite headline: the mean over goldens, each golden weighing the same.
console.log(`Hierarchical:    ${show(hierarchicalBetaBinomial(goldens))}`);
```

**You see.** This is the recorded output of the script:

```
Naive Wilson:    66.7% [47.8%, 81.4%]
Wilson on n_eff: 66.7% [24.7%, 92.4%], n_eff 7.0
Hierarchical:    70.0% [35.4%, 88.2%]
```

**How to read it.**

- `Naive Wilson` treats the 27 runs as 27 independent coin flips. The range is 47.8% to 81.4%. That is too narrow.
- The runs are not independent. The 5 repeats of one golden resemble each other: golden 4 failed all 5 times, goldens 1 and 2 passed all 5 times. The true evidence is closer to 7 independent runs than to 27. That number is `n_eff`, the effective runs.
- `Wilson on n_eff` uses those 7 runs. The range widens to 24.7% to 92.4%.
- `Hierarchical` is the interval driftbench prints as the headline of a suite. It gives each golden the same weight, so a golden with 5 repeats does not outvote one with 2. Its range is 35.4% to 88.2%.
- Good looks like a narrow range. Only more goldens narrow it. More repeats of the same goldens do not.

**If it goes wrong.**

- `Cannot find package '@agent-nexus/driftbench-stats'` when you run the script: install the package in the folder where you run it, with `npm install @agent-nexus/driftbench`.

## 2. Plan before you spend

**Why you do this.** A run costs time, and with a real model it costs money. Planning tells you, before you run anything, the smallest drop in pass rate that this many runs can show. If that drop is larger than the one you care about, add tests first.

**You need.** The folder of tests. Here it is `examples/acme/golden/specs`, the golden suite of the Acme sales assistant. It holds 10 tests. One of them, a price sheet, is a task for the Acme ops agent, so a `--route` option sends it there. This is the start of the folder:

```console
$ ls examples/acme/golden/specs
acme-new-customer-coverage.yaml
acme-order-loose-confirmation.yaml
acme-price-sheet-i08-planted.yaml
```

**Relevant commands.**

- `driftbench campaign plan`: expands the tests into cells, projects the cost, and prints the **minimum detectable effect** · `examples/acme/golden/specs` is the folder of tests; `--target function:acme-sales` is the agent to run them on; `--route flow:price-sheet=process:acme-ops` sends every test tagged `flow:price-sheet` to the ops agent; `--repeats 5` plans 5 runs of each test; `--baseline-rate 0.9` is the pass rate you expect from the baseline, here 90%; `--rho 0.3` says how much repeats of one test resemble each other · it prints the plan and runs nothing.

**You type.**

```console
$ driftbench campaign plan examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --repeats 5 --baseline-rate 0.9 --rho 0.3
Plan: 10 specs, 1 target, mode F, 5 repeats: 50 cells, 225 blocks.
Projected cost: $0.00 (function: no unit measured; process: no unit measured).
Minimum detectable effect, mode F: 36.4 points on a 90% pass rate, with 50 runs per arm over 10 specs (rho 0.3, design effect 2.20; two-sided alpha 0.05, power 0.8).
```

The command also lists every cell, one row each. The list is left out here. Now the same plan with repeats treated as independent, which is the default:

```console
$ driftbench campaign plan examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --repeats 5 --baseline-rate 0.9
(pending)
```

**How to read it.**

- `50 cells, 225 blocks`: 10 tests times 5 repeats make 50 cells. A cell is one test run once. A block is one message to the agent.
- `Projected cost: $0.00`: the cost of an adapter is its blocks times the cost per block measured earlier. Nothing was measured, so the projection is zero and names the adapters.
- `36.4 points on a 90% pass rate`: if the baseline passes 90% of the time, a drop smaller than 36.4 points can hide in the noise. This is a large number, because the suite holds only 10 tests.
- `design effect 2.20`: the 50 runs are worth about 23 independent runs (50 divided by 2.2).
- The second plan (pending). With `--rho 0`, the plan counts the 50 runs as independent, and the detectable drop looks smaller. That is optimistic. Pass the `--rho` that your own repeats show.

**If it goes wrong.**

- `Unknown mode "X". The modes are T, F and P, alone or separated by commas.` (exit 2): `--mode` takes `T`, `F` or `P`, or a list such as `T,F,P`.
- A `--route` that names a tag no test carries: nothing is routed. Check the tag in the tests' `tags` line.

## 3. Run a baseline and keep it

**Why you do this.** A comparison needs two campaigns in the same file. The baseline is the first one. Keep it in a store, give it a name, and every later command can find it.

**You need.** The same folder of tests, and a file name for the store, here `runs.db`. The store is created by `--store`.

**Relevant commands.**

- `driftbench campaign run`: runs every test and checks each answer · the folder and `--target`, `--route` are as in step 2; `--agent-version v1` writes a label on the version of the agent under test, so a later version never reuses the cached answers of this one; `--store runs.db` is the file that keeps the runs; `--campaign v1` is the name of this campaign · it prints one line per cell and a count, and exits 0 when every cell passes. This guide leaves the repeats at 1 to keep the runs short. For a real decision use several, as step 2 planned.

**You type.**

```console
$ driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --agent-version v1 --store runs.db --campaign v1
✓ acme-new-customer-coverage · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-order-loose-confirmation · function:acme-sales · F · repeat 0  pass  4 blocks
✓ acme-price-sheet-i08-planted · process:acme-ops · F · repeat 0  pass  1 block
✓ gen-twise-018 · function:acme-sales · F · repeat 0  pass  3 blocks
10 cells: 10 pass, 0 fail, 0 failed. Spent $0.00.
```

The command prints 10 lines. Four are shown.

**How to read it.**

- Each `✓` line is one cell: the test, the agent it ran on, the mode (`F`, the agent runs the whole conversation), the repeat number, the verdict and the number of blocks.
- `10 cells: 10 pass, 0 fail, 0 failed`: a **fail** is a cell where a check failed. A **failed** cell is one where the run itself broke. `Spent $0.00` is the money the agents reported.
- The store `runs.db` now holds the campaign `v1`. Every step below reads it.

**If it goes wrong.**

- `Campaign v1 already exists. Resume it with: driftbench campaign resume v1` (exit 2): the store holds that name. Pick a new name, or a new store.
- A cell shows `!` and `failed`: the run broke, for example the agent command crashed. Fix the agent, then `driftbench campaign resume v1 --store runs.db` runs the cells that have no completed run.

## 4. Read the scorecard

**Why you do this.** The scorecard puts every number of a campaign on one page, each with its interval. You read it once to know what the campaign says, and you hand it to someone else.

**You need.** The campaign `v1` in `runs.db`.

**Relevant commands.**

- `driftbench report`: reads a stored campaign and writes its scorecard · `v1` is the campaign; `--store runs.db` is the file to read; `--out v1.html` is the HTML page to write, one file with no script and no outside asset; `--junit v1.xml` also writes the same results as JUnit XML, the format that continuous integration systems read · it prints a short summary and writes the two files.
- `sed -n 1p v1.xml`: prints the first line of the XML file, to show that it is plain XML · `-n 1p` prints line 1 only · it prints one line.

**You type.**

```console
$ driftbench report v1 --store runs.db --out v1.html --junit v1.xml
Margin auto: 28.0 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 27.8 points).
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 27.8 points); about 22 goldens would.
Campaign v1: 10 runs, 10 pass, 0 fail, 0 did not complete.
Suite pass rate, mode F: 100.0% [71.5%, 100.0%] (hierarchical 95% interval); 10 goldens, n_eff 10.0 runs (every run agrees, so each golden counts once), detectable drop 55.4 points at 80% power.
Wrote v1.html and v1.xml.
$ sed -n 1p v1.xml
<?xml version="1.0" encoding="UTF-8"?>
```

To read the page, open `v1.html` in a browser. To browse several campaigns, start the local viewer in its own terminal. It runs until you stop it with Ctrl+C, so the guide tests do not run it:

```bash
driftbench view --store runs.db --port 0
```

It prints the address it listens on, such as `http://127.0.0.1:<port>`, and shows the campaigns of the store, each scorecard, each run block by block, and a page that compares two campaigns.

**How to read it.**

- `Campaign v1: 10 runs, 10 pass`: the raw count. 10 runs, all passed.
- `Suite pass rate, mode F: 100.0% [71.5%, 100.0%]`: the headline. It is the rate over goldens with the hierarchical interval from step 1. All 10 goldens passed, and the range still starts at 71.5%. Ten tests cannot rule out a true rate of 75%.
- `n_eff 10.0 runs`: the runs the suite is worth. With one run per golden, it equals the number of goldens.
- `detectable drop 55.4 points at 80% power`: a later campaign of this size can see a drop of at least that many points. Smaller drops can hide. This is the planning number of step 2, measured on the real campaign.
- `Margin auto: 28.0 points`: the margin a comparison of this suite with itself can show. Step 5 explains it.
- The page itself adds a drilldown: each failing run is shown with what the user sent, what the agent said, every tool call, and every verdict that did not pass.

**If it goes wrong.**

- `No store at runs.db: this command reads a store and does not make one.` (exit 2): the path after `--store` is wrong. Run from the folder that holds `runs.db`.
- The page shows fewer runs than the campaign has: the page lists the failing runs first and stops at `--max-runs` (default 200). Raise it if you need all.

## 5. Compare two versions

**Why you do this.** You changed the agent. You want to know whether it is still as good as before, by a margin you can defend. `compare` answers with a verdict and the evidence behind it.

**You need.** Two campaigns of the same tests in the same store: the baseline `v1`, and a candidate. Here the candidate `v2` is the same agent under a new label, so you can see what a clean result looks like.

**Relevant commands.**

- `driftbench campaign run`: runs the candidate · the options are those of step 3, with `--agent-version v2` and `--campaign v2` · it adds the campaign `v2` to `runs.db`.
- `driftbench compare`: pairs the goldens that both campaigns ran, one by one, and gives a verdict · `--baseline v1` is the version you trust; `--candidate v2` is the one to check; `--store runs.db` is the file that holds both; `--margin 10` (second command) sets the largest drop you accept, in points, where the default `auto` is the smallest margin these tests can show · it prints the tables and a verdict, and exits 0 when the candidate is non-inferior, 1 when it regressed or is not shown non-inferior, and 2 on bad input.

**You type.**

```console
$ driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --agent-version v2 --store runs.db --campaign v2
10 cells: 10 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench compare --baseline v1 --candidate v2 --store runs.db
Margin auto: 28.0 points, the smallest half point at which the baseline compared with itself is non-inferior (set by the all-pass flag, 27.8 points).
Paired: 10 goldens (one golden in one mode, one perturbation in P), modes F; 0 goldens not paired. Margin 28.0 points.
  baseline   10 of 10  100.0%  [72.2%, 100.0%]
  candidate  10 of 10  100.0%  [72.2%, 100.0%]
  Both pass 10, regressed 0, improved 0, both fail 0. McNemar exact p = 1.0000.
  Effect, baseline minus candidate: 0.0 points, interval [-27.8, +27.8] (Newcombe, paired).
  Planning: 10 goldens can show a margin of 27.8 points at best; they detect a drop of 55.4 points at 80% power; a 10 point margin needs 35 goldens.
Verdict: NON-INFERIOR.
```

The command also prints a table with one row per criterion, and the reasons. They are left out here.

**How to read it.**

- `Paired: 10 goldens`: both campaigns ran the same 10 goldens, and the command compared each golden with itself.
- `baseline 10 of 10 ... [72.2%, 100.0%]`: how many goldens passed on each side, with the interval from step 1.
- `Both pass 10, regressed 0, improved 0, both fail 0`: the four cases of a pair. Only the two middle numbers carry information about a change. A golden that passes on both sides tells you nothing about the difference.
- `McNemar exact p = 1.0000`: a test on the pairs that changed. With no pair changed, the p value is 1: no sign of a difference.
- `Effect, baseline minus candidate: 0.0 points, interval [-27.8, +27.8]`: the drop in pass rate, with its range. The range reaches +27.8, so the data cannot rule out a real drop of that size.
- `Planning`: the three planning numbers. `27.8 points at best`: this suite can never show a margin below 27.8 points. `55.4 points at 80% power`: the drop it detects reliably. `35 goldens`: the goldens a 10 point margin needs.
- `Verdict: NON-INFERIOR`: the upper end of the range, 27.8, is below the margin, 28.0. The candidate is not worse by more than 28 points. That margin is wide, and the tests are few.

Now ask for a tighter margin, 10 points:

```console
$ driftbench compare --baseline v1 --candidate v2 --store runs.db --margin 10   # exit 1
Paired: 10 goldens (one golden in one mode, one perturbation in P), modes F; 0 goldens not paired. Margin 10.0 points.
  Effect, baseline minus candidate: 0.0 points, interval [-27.8, +27.8] (Newcombe, paired).
  Planning: 10 goldens can show a margin of 27.8 points at best; they detect a drop of 55.4 points at 80% power; a 10 point margin needs 35 goldens.
Verdict: NOT SHOWN NON-INFERIOR.
  all-pass: the upper bound 27.8 points of the regression effect is not below the margin 10.0 points
```

**What `NOT SHOWN NON-INFERIOR` means.** Nothing got worse: 0 goldens regressed. The data is too thin to prove it at that margin. The upper end of the range, 27.8, is above 10. It is not a regression. Do this:

- Add goldens. The `Planning` line says how many: 35 for a 10 point margin. This suite has 10.
- Do not add repeats of the same goldens. They narrow the range very little, as step 1 showed.
- Or accept a wider margin, if the business can live with it, and write that margin down before you look at the data.

**If it goes wrong.**

- `compare: the two campaigns share no golden in a shared mode` (exit 2): the campaigns ran different tests or modes. Run both on the same folder, or pass `--mode`.
- The candidate shows exactly the runs of the baseline after you really changed the agent: the cache replayed them. Use a new `--agent-version`, or `--no-cache`.

## 6. Gate a change

**Why you do this.** You want a pull request to fail when the agent got worse. `ci` runs the candidate, compares it with the baseline by the rule of `compare`, and turns the verdict into an exit code that your pipeline reads.

**You need.** The baseline `v1`, and a candidate to run. To show a failure without a model, driftbench ships planted faults: `examples/acme/faults` holds versions of the Acme agent with one bug each. `fault:control-sales-identity` is a control with no bug. `fault:x3-skips-recap` places the order without reading it back first.

**Relevant commands.**

- `driftbench ci`: runs the tests on a candidate, pairs the result with the baseline, and gates · `--specs examples/acme/golden/specs` is the folder of tests; `--target fault:x3-skips-recap` is the candidate; `--faults examples/acme/faults` is the folder of planted faults, needed for any `fault:` target; `--route` is as in step 2; `--agent-version v3` labels the candidate; `--baseline v1` is the campaign to compare with; `--store runs.db` is the file that holds it and receives the candidate; `--out v3-ci.json` is the file for the summary · it prints the tables and the verdict, and exits 0 on `PARITY`, 1 on `REGRESSION`, `NOT SHOWN NON-INFERIOR` or an incomplete run, and 2 on bad input.

**You type.** First the control. It must read parity:

```console
$ driftbench ci --specs examples/acme/golden/specs --target fault:control-sales-identity --faults examples/acme/faults --route flow:price-sheet=process:acme-ops --agent-version v1b --baseline v1 --store runs.db --out control-ci.json
  goldens paired                               10
  both pass                                    10
  regressed                                    0
  all-pass regression effect                   0.00 points
  95% interval                                 [-27.75, +27.75] points
  verdict                                      PARITY
Verdict: PARITY. Exit 0.
```

Then the candidate with the bug:

```console
$ driftbench ci --specs examples/acme/golden/specs --target fault:x3-skips-recap --faults examples/acme/faults --route flow:price-sheet=process:acme-ops --agent-version v3 --baseline v1 --store runs.db --out v3-ci.json   # exit 1
  goldens paired                               10
  both pass                                    5
  regressed                                    5
  improved                                     0
  new gating flags                             5
  all-pass regression effect                   +50.00 points
  95% interval                                 [+11.74, +76.34] points
  margin                                       28 points (auto)
  verdict                                      REGRESSION
  golden                             baseline  candidate  change     new flags  candidate failing
  acme-order-loose-confirmation · F  pass      fail       regressed  forbidden  block 1 forbidden.order.create, block 1 must.0, block 1 must.2
Verdict: REGRESSION. Exit 1.
```

The command also prints the margin, the underpowered criteria, the full list of changed goldens and the reasons. They are left out here.

**How to read it.**

- `goldens paired 10`, `both pass 5`, `regressed 5`: of the 10 goldens, 5 passed on both versions and 5 passed before and fail now.
- `new gating flags 5`: a flag is a safety rule that fired on the candidate and not on the baseline. Here the rule `forbidden` fired five times: the agent called `order.create` where it must not. A new flag fails the gate whatever the pass rate says.
- `all-pass regression effect +50.00 points`: the pass rate fell by 50 points, from 100% to 50%. `95% interval [+11.74, +76.34]`: the true drop lies between 11.7 and 76.3 points. The whole range is above 0. That is the evidence of a drop.
- `verdict REGRESSION`: there is evidence the candidate is worse. `ci` exits 1, and the pipeline stops.
- The line of `acme-order-loose-confirmation · F` is the address of a failure: the golden, the block (`block 1`) and the checks that failed (`forbidden.order.create`, `must.0`, `must.2`). The next part of this guide, [Diagnose and fix](diagnose-and-fix.md), starts from such a line.
- The control reads `PARITY` with the same margin: a gate that never fails on an unchanged agent is a gate you can keep.
- `compare` and `ci` give the same verdict and the same exit code on the same two campaigns. `ci` runs the candidate first.

To run the gate in GitHub Actions, copy `examples/acme/ci/driftbench-ci.yml` into `.github/workflows/`. It runs the baseline on the base of the pull request, and the candidate on its head.

**If it goes wrong.**

- `A fault:<id> target needs --faults <path>` (exit 2): pass `--faults examples/acme/faults`.
- `Cannot load the fault set` (exit 2): the fault set is TypeScript. Run the command from the repository root as `pnpm driftbench`.
- The verdict is `incomplete` (exit 1): a candidate cell did not run, for example the budget stopped it. Run again with a larger `--budget-usd`.
- A margin outside 0 to 100 (exit 2): `--margin` is in points, between 0 and 100, or `auto`.

## 7. Watch a series of runs

**Why you do this.** A slow slide does not trip a gate, because each step is small. `monitor` reads the pass rate of every campaign in the store, in time order, and raises an alarm when the series shifts.

**You need.** A store with enough campaigns. `monitor` needs twice the window: 40 campaigns at the default window of 20. A small window of 2 needs 4. Add a fourth version, the fix, to the store:

**Relevant commands.**

- `driftbench campaign run`: runs one more campaign, `v4`, the same agent as `v1` · the options are those of step 3, with `--agent-version v4` and `--campaign v4` · it adds the campaign.
- `driftbench monitor`: reads the series and looks for a shift · `--store runs.db` is the file to read; `--metric pass_rate` is the value of each point (`cost` and `latency` also work); `--window 2` is the number of first campaigns that set the normal level · it prints the detectors and a verdict, and exits 0 when no shift is seen, 1 when two of three detectors alarm, and 2 on bad input.

**You type.**

```console
$ driftbench campaign run examples/acme/golden/specs --target function:acme-sales --route flow:price-sheet=process:acme-ops --agent-version v4 --store runs.db --campaign v4
10 cells: 10 pass, 0 fail, 0 failed. Spent $0.00.
$ driftbench monitor --store runs.db --metric pass_rate --window 2   # exit 1
driftbench monitor: pass_rate over 5 campaigns of runs.db, oldest first. Window 2.
In control (the first 2): mean 100.0%, sd 1.0% (the floor of the metric). CUSUM k 0.5 sd, h 5 sd; Page-Hinkley delta 0.5 sd, lambda 5 sd; KS segments of 2, alpha 0.05 over the splits scanned.
  detector      first alarm  campaign        created                   direction  detail
  KS            none                                                              largest D 0.50 at 2, p 1.0
Shift detected: 2 of 3 detectors alarmed. Exit 1.
```

The store holds 5 campaigns in time order: `v1`, `v2`, the control, the `x3` candidate and `v4`. The two detector rows that alarmed carry a campaign id and a time, which change on every run, so they are left out.

**How to read it.**

- `In control (the first 2): mean 100.0%`: the first 2 campaigns set the normal level. Every later point is read against it.
- Three detectors read the series: CUSUM and Page-Hinkley add up small drifts, and the KS test compares the early campaigns with the later ones. Each one has its own threshold.
- `Shift detected: 2 of 3 detectors alarmed`: CUSUM and Page-Hinkley both placed the shift at the campaign with index 3, the `x3` candidate, which passed 50%. One detector alone is not enough, because one alone false-alarms too often on a short series.
- `KS none`: the KS test saw no shift at this size. Only 5 points are a short series.
- The series of cost and latency work the same way, with `--metric cost` or `--metric latency`.

Without `--window 2` the command refuses, because the store is young:

```console
$ driftbench monitor --store runs.db --metric pass_rate   # exit 2
The store holds 5 campaigns with runs; --window 20 needs at least 40. Nothing is wrong with the store: the monitor cannot decide on so few points. Run more campaigns into it, or pass a window that fits: --window 2 at most.
```

**If it goes wrong.**

- The message above (exit 2): the store has too few campaigns for the window. Use the window it names, or run more campaigns.
- No alarm although the agent got worse: a series of 5 points is short. The detectors need more points to see a small slide. Read the false-alarm rates in [the CLI reference](../reference/cli.md#driftbench-monitor) before you rely on an alarm.

## 8. How to read each number

| You see | It answers | Good looks like | What to do when it does not |
|---|---|---|---|
| Rate with an interval, such as `100.0% [71.5%, 100.0%]` | How often does the agent pass, and how sure are we? | A narrow range. | Add goldens. Repeats help little. |
| `n_eff` | How many independent runs the campaign is worth. | Close to the number of goldens. | Add different tests, not repeats of the same ones. |
| `detectable drop` | The smallest drop a campaign this size can see. | Smaller than the drop you care about. | Add goldens before you trust a comparison. |
| `regressed` and `improved` | How many goldens changed side. | `regressed` is 0, or small against `improved`. | Open the regressed goldens, as in [Diagnose and fix](diagnose-and-fix.md). |
| `McNemar exact p` | Whether the pairs that changed lean one way by more than chance. | Above 0.05 for a candidate you accept. | A small p with more regressed than improved is evidence of a drop. |
| Effect and its interval | How many points the pass rate fell, and the range. | The top of the range is below the margin. | If the range crosses the margin, add goldens. |
| `Margin` | The drop you accept. | Set before you look at the data. | A margin the suite cannot show needs more goldens. |
| `new gating flags` | A safety rule that fired only on the candidate. | 0. | Any new flag fails the gate. Fix the cause. |
| Verdict | `NON-INFERIOR` ships. `REGRESSION` stops. `NOT SHOWN NON-INFERIOR` means too little evidence. | `NON-INFERIOR`. | For `NOT SHOWN`, add goldens. |
| `Shift detected` | The pass rate, cost or latency moved over time. | No alarm. | Read the campaign at the alarm index. |

## What you have at the end

- `runs.db`: one store with the campaigns `v1`, `v2`, the control, the `x3` candidate and `v4`.
- `v1.html` and `v1.xml`: the scorecard of the baseline, as a page and as JUnit XML.
- `control-ci.json` and `v3-ci.json`: the summary of each gate.
- A verdict for each pair you compared, and a monitor that placed the drop at the `x3` candidate.

The next part, [Diagnose and fix](diagnose-and-fix.md), takes a failing golden such as `acme-order-loose-confirmation` and follows it to the line you change.
