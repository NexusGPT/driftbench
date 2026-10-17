# Stats validator: independent audit (docs/validators.md section 12.7)

Each verdict below is written by the audit helper that ran the check, in its own words; the builder of the bank does not write them. A row reads `pending` until its helper has finished. The evidence of each check is in `validators/stats/audit-evidence/`.

blind pilot: pending

cheater: fail Reading roadmap.json at run time lifted the bank from 430 to 1059 of 1326 and a blanket RangeError wrapper added 44 more, with the statistics unchanged.

cause review: pass agreement 30/30 with the builder tags; 133 reviewed distinct causes against 132 declared.

planted bugs: pending
