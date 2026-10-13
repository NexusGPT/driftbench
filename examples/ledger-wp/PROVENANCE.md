# Writing data provenance

## Final model disposition

Gemini 3.8: dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score. Flash Lite stays the Gemini result. The withdrawal supersedes the historical Gemini 3.8 authorization below. It changes no sealed input, label, contestant prompt or scoring formula. Raw recordings and prior freezes remain intact; `results/gemini-3.8-owner-drop.json` records their hashes.

The data is WritingPreferenceBench by Shuangshuang Ying and coauthors, from the [dataset repository](https://github.com/WritingPreferenceBench/Writing-Preference-Bench), [Hugging Face release](https://huggingface.co/datasets/m-a-p/Writing-Preference-Bench), and [paper](https://arxiv.org/html/2510.14616v2). The fetched source hashes and URLs are in `sources/receipts.json` and `sources/hf-receipts.json`.

## Licence

Both fetched dataset READMEs identify the Open Data Commons Attribution License, [ODC-BY](https://opendatacommons.org/licenses/by/). They describe research and educational use and require author attribution and respect for referenced data licences. This study retains that attribution. The project website's separate code licence is not used as the dataset licence. Source: `sources/wp-readme.md` and `sources/README.md`, License sections.

## Label provenance

The paper, section 2.1, describes expert scoring of generated writing and preference selection from those scores. It states that retained pairs require agreement from at least two of three annotators and a score gap of at least one. Released records identify the request, chosen and rejected responses, source models and human quality scores. The chosen field supplies the benchmark preference. We do not use model-generated judge labels as gold.

The downloaded release holds 1,800 records. Three Chinese records have chosen and rejected scores of zero. Those records are excluded before selection; their content hashes and source indices are in `seals/manifest.json`. We have not independently recovered individual annotator ballots. Thus the paper supports the label provenance; the distributed aggregate scores support the operational label mapping.

## Overlap and sealing

`prepare.py` scans the recording files in the worktrees named by the brief and also the writing research worktree. The exact inventory and hashes are in `seals/recording-inventory.json`; the recorded ID union is separate. Two named worktrees are absent and remain explicitly unverified. No absence claim is made about inaccessible recordings or model pretraining.

The LongJudge file contains 263 pairs sharing 158 request IDs. All exact LongJudge pairs, all their request IDs and exact question hashes, and every recorded ID are excluded. This conservatively removes 494 original release pairs sharing LongJudge requests. After excluding the three ambiguous labels, 1,303 fresh candidate pairs remain. Values and executable derivation: `seals/manifest.json` and `prepare.py`.

The test seal selects 173 pairs by seeded SHA-256 ranks and proportional language allocation. It contains 122 English and 51 Chinese pairs, with 146 request clusters. No contestant outcome enters selection. The complete original pool remains available through the hashed downloads; the seal is a predefined sample, not the full benchmark.

Pilot and dev use previously evaluated LongJudge dev requests. They are request-disjoint from each other and from the new test pool. Separate commits seal each pool before any call, as the owner confirms. No dev or pilot result can change the sealed test roster.

## Contestant provenance

The promptfoo select-best template is copied verbatim from the existing attributed port, pinned to `801428268b5e421b2f6994332f6a06f86b27bb1f`. `vendor/NOTICE` retains the MIT notice. The writing criterion and wrapper match the original benchmark adapter. A deterministic test compares rendered prompts.

The opt-in reader-first row uses the source tree at `c50b2dc3`, PR 157. It chooses the longer response unless its frozen machine and judged defect conditions justify an override. It is labelled as length-aware and is never merged into the pair-ledger row or the primary cross-benchmark family. Both source orders feed one decision, so its two scored games are the same normalized choice.

The pair-ledger row must use the pushed core contract. Its source, dialect and reasoning hashes join the run freeze before any model call. The holistic `better_piece` row is the primary quality criterion. Only explicit request excerpts can introduce hard length, language, form or named-element rows. The request compiler is conservative and is not claimed to extract every possible implicit requirement.

Anthropic, OpenAI and Google model families also appear among source response generators in this sealed test pool. This is a same-model contestant comparison, not evidence of family-independent deployment performance.

## Preregistered interpretation

This writing row targets no significant loss; a win is not assumed. Scores use both presentation games, with ties and unparsed games wrong. Single rates use Wilson intervals. Paired differences use a language-stratified bootstrap over request clusters. Exact two-sided game McNemar is reported as requested, with its within-request dependence caveat. Holm adjustment waits for the full primary cell family; reader-first is exploratory and separate.

The longer-wins, constant-FIRST and refusal-wins controls are reported on the identical sealed pool. The dev noise check uses three independently keyed repetitions. Model errors, partial coverage, frozen validity failures and spend cutoff remain visible. Gemini initially remains pending billing. Before any paid call, the owner confirms billing on `gemini-driftbench.key` and authorizes that file with `openai.key`; Gemini joins the same frozen protocol.
