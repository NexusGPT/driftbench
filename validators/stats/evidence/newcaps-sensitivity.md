# New capabilities: each function's items reject a 0.2 percent nudge and a throw

`packages/validators/test/stats/newcaps-sensitivity.test.ts` checks the 117 functions of the nine
`newcaps-<group>.json` fixtures. For each function it requires:

* the values item and the domain item pass the implementation under test;
* the values item fails when every number of the output is multiplied by 1.002 (a returned decision label
  is swapped for another label the function returns), and that change touched at least one output;
* the values item and the domain item fail when the function throws an `Error`;
* the domain item fails when the function throws a `RangeError` on every input.

Two implementations were measured, with `pnpm exec vitest run --maxWorkers=2` on that file.

| Implementation | Functions passing all checks |
|---|---|
| Fixture stand-in (default in CI: the documented answer per case, no method) | 117 of 117 |
| Implementations written from the pages alone, one per group (`NEWCAPS_REFERENCE`, run per group with `NEWCAPS_GROUP`) | 117 of 117 (bayes 14, classification 8, descriptive 10, design 14, distance 16, effectsize 11, exacttests 13, multiplicity 15, sequential 16) |

Red first: on the domain item before it required the value cases to return, all 117 functions fail the
refuse-everything check (234 assertions, one per run of the domain item).

The implementations written from the pages are kept out of the repository: they would hand an executor the
solution to every new-capability cause, which section 12.7 counts as reading the oracle.
