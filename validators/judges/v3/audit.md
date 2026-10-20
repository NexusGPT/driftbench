# Independent audit: judges v3

The rows below are copied verbatim from the independent auditors' reports.
They describe frozen checkpoint `6579b72536697bc99bccb5c138d007d4e3a4a44d`,
with hidden seed `703475557`. Mutation tests identify source hashes and seed 71.

| Check | Verdict | Evidence |
|---|---|---|
| blind pilot | fail | Baseline `results/round-00.feedback.json`: 0/334, level 0. Round 10 `results/round-10.feedback.json`: 327/334, level 3. Hardness requirements fail. |
| cheater | pass | 19 attacks; 334 items; seeds 1..20 plus hidden 703475557. |
| cause review | fail | All 7 failures reviewed. Exact 7; partial 0; prerequisite 0; unsupported 0. Repair-tag agreement 1.0. Two inferred repair groups versus seven author tags. Population below 30; 100 distinct actual causes unestablished. |
| planted bugs | pass | 26/26 satisfy edge and bank kill requirements; 26/26 lose bank items; original baseline 334/334, unchanged bound-copy baseline 334/334 items pass at seed 71. |

## Reports and boundaries

- [Blind pilot](evidence/audits/blind-pilot.md): baseline plus ten actual repairs,
  327/334 at round ten, score 0.979041916168, forecast 0.214067278287. Its protocol
  caveats are retained, including the public alpha-field clarification.
- [Cheater](evidence/audits/cheater.md): all 19 attacks pass zero items and zero
  item-seed observations. The separate bank regression checks every period 1–8
  and phase offset on seeds 1–20 and the hidden seed.
- [Final cause review](evidence/audits/final-causes.md): all seven remaining
  failures reviewed before tags. Seven exact repair matches do not establish
  seven independent defects. Two capability groups are inferred; the underlying
  independent root-cause count remains unestablished.
- [Planted bugs](evidence/audits/mutants.md): 26 advanced semantic mutants each
  fail an independent witness and lose actual bank items. The combined run also
  passes the existing 20 mutation tests, for 46/46. Both unchanged advanced-audit
  baselines pass 334/334.

The [separate baseline cause diagnostic](evidence/audits/baseline-causes.md)
reviews thirty failures: 22 exact, three partial and five prerequisite matches.
Its exact agreement is 0.7333. It cannot substitute for the final population.
The raw measurement reports retain seven author tags; neither the journal nor
this report promotes those tags to seven independently certified causes.

All auditors use the inherited Codex runtime because the prescribed Sonnet
runtime is unavailable. No live model runs inside the deterministic bank.
The pilots use procedural access boundaries and immutable source snapshots;
they do not claim operating-system isolation. The cheat audit covers its
request boundary, not arbitrary JavaScript filesystem access.

The [provisional delivery bar](GATE.md) does not overwrite these verdicts.
Original hardness and independent-audit requirements remain unmet. Earlier
finished-code and protocol-excluded experiments remain in [history](history/README.md)
and do not contribute to this pilot's forecast.
