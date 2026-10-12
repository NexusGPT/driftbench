# Hard-set loss census

Replayed from the existing Haiku recordings. No model calls.

| Cause | Pairs | IDs |
|---|---|---|
| Unsupported extra vs fully correct | 8 | h006, h010, h016, h052, h076, h082, h092, h105 |
| Unit mismatch vs fully correct | 1 | h014 |
| Unit mismatch vs two wrong facts | 1 | h037 |
| One wrong price vs two wrong facts | 4 | h040, h060, h088, h106 |

All 14 shipped losses are ties. Thirteen disagree by order; h016 is inconclusive in both orders. No recorded non-tie winner is wrong. The competitor loses only h089, one unit mismatch versus two wrong requested facts.

The shipped prompt names unsupported claims as defects, but the rubric only asks for the three requested facts. The outcomes show inconsistent application of that rule. The old recordings do not contain reasoning, so a psychological explanation is an inference.

The audit variant states an explicit policy: fewer wrong or missing requested facts wins, then fewer unsupported additions breaks equal factual coverage. This matches the requested criterion without using item IDs, generated error counts, answer lengths, or labels.

Caution: the long-fluent generator labels only its availability error; its prose also contains unsupported claims. Requested-fact priority is a disclosed policy, not a universal severity rule. This set cannot validate a policy that counts every unsupported claim equally with requested-fact errors.

## Audit-label errors and the structured fallback

The primary audit scores 119/120 on hard and 110/120 on easy. All remaining losses are order disagreements. In each observed failed order, its reasoning identifies the better candidate but its outcome says pass for Candidate A. This is visible in the retained primary reasoning.

The checked procedure recovers h058 on hard and q007, q015, q039, q047, q068, q082, q084, q099, q112, q118 on easy. It extracts a fact-status ledger in both orders, then computes the relative winner in code. It scores 120/120 on both sets with no unanswered calls. The fixture audit-tie.json preserves the observed h058 failure and both fallback calls for the integration test.

The model still chooses the fact decomposition. For q047, q082 and q112, one order combines the price into one fact while the other separates amount, currency and period. For q007, a fallback also lists a wrong requested claim as an unsupported addition. These differences do not affect the observed winners because the wrong requested-fact counts already differ. They limit how far this result can be generalized.
