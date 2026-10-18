# Separate dialect variant

Uses the same sealed cases and frozen criterion-ledger requirements. Core buildDialectRequest runs verbatim from its committed source, with native dependencies. Candidate OpenAI output uses strict JSON schema; candidate Haiku gets scratchpad then last JSON. Peers keep their pinned template bytes and plain output. Both Luna contestants explicitly use medium reasoning. The provider-default primary remains separate.

No parsed content is retried. Unanswered transport failures have at most three attempts with 10/30-second backoff. Luna uses four calls, dropping to two if unanswered failures exceed 5% in any rolling 50 attempts. Haiku has its own queue. Primary and dialect calls share the USD 10 measured-spend cap. The default-goal and equal-evidence goal results are both retained.
