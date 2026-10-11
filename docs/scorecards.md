# Example scorecards

`driftbench report` writes a scorecard as one HTML page. These were written from stored campaigns of the Acme example: everything ran in process or in a local sandbox, no model was called and nothing was billed. Fictional data only.

* [Acme campaign](../examples/acme/reports/acme.html): the Acme agents on both targets, modes T, F and P, 3 repeats.
* [Acme campaign with faults](../examples/acme/reports/acme-faults.html): the same campaign with two faults standing in for the agents, read against the first one, with the variance pilot.
* [Variance pilot](../examples/acme/reports/pilot-acme-random.html): the spread view on a small pilot campaign of a seeded random control, with per-cell intervals, wording ranges and the noise floor.

How each one was made, and what it shows, is in the [reports README](../examples/acme/reports/README.md). The commands are on the [running](running.md) page.
