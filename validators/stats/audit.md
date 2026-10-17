# Stats validator: independent audit (docs/validators.md section 12.7)

Each verdict below is written by the audit helper that ran the check, in its own words; the builder of the bank does not write them. A row reads `pending` until its helper has finished. The evidence of each check is in `validators/stats/audit-evidence/`.

blind pilot: pass 10 iterations done, 54 distinct items fixed (23, 6, 4, 3, 4, 2, 4, 3, 3, 2 per iteration, mean 5.4), 432 to 485 of 1326 items passing on seeds 1, 2 and hidden and 426 to 482 on all 21 seeds, level still 1.

cheater: fail Reading roadmap.json at run time lifted the bank from 430 to 1059 of 1326 and a blanket RangeError wrapper added 44 more, with the statistics unchanged.

cause review: pass agreement 30/30 with the builder tags; 133 reviewed distinct causes against 132 declared.

planted bugs: pass 20 of 20 planted bugs were caught, each losing at least one bank item (fewest 1, most 26), over 20 functions in 12 files.
