# Estate lexical removal inventory

Baseline: `astra-askwords-base` (`9ad6ae952`). Line references below name that baseline unless marked current. Scope: validators estate path and generator estate path. Fixed rendering templates, schema/act/tool IDs, bank case IDs, and fixture output pools are not prose classifiers.

## Validator findings

| Location | Forbidden read | Structured replacement |
|---|---|---|
| `packages/validators/src/ladders/estate/bank/genquality.ts:50,58,75,76,92` | TASK_VERBS, SKIP, TEMPLATES, QUESTION, inline negation words judge an ask | Resolve carried map act ID; check trace against that act, and exact rendering from frame/shape IDs |
| `packages/validators/src/ladders/estate/bank/askfrom.ts:29,43,86` | suffix list, imported ASK_FRAME_WORDS and a bag of source words accept lexical overlap | Exact source spans/act IDs plus frame re-render equality; no stemming/word pool |
| `packages/validators/src/ladders/estate/bank/task-span.ts:25,82,85,86` | LEADING_OPERATORS and English clause derivation regexes | Parser sentence/list/quoted spans or carried source span coordinates; whole-clause equality |
| `packages/validators/src/ladders/estate/bank/task-check.ts:163` | Finds a TOOL_ACTS phrase by shape prefix | Shape/frame ID maps to structured act kind/name; exact re-render permitted |
| `packages/validators/src/ladders/estate/bank/loop.ts:445` | skill/agent/helper alternation classifies asks | Map reference/dispatch act ID and matching trace call |
| `packages/validators/src/ladders/estate/operation-witnesses.ts:26,27,28,29,31,46,91` | Derived read/destructive/order word sets and command regexes classify synthetic labels/commands | Preclassified complete witness records carrying expected operation class and provenance; preserve every harmful/benign ID |
| `packages/validators/fixtures/estate/operation-vocabulary.json:7,29,42,43,45` | toolWords, readWords, orderVerbs, orderNouns, commandRules read through witness helper | Replace recognizer fixture with complete classified witness records |
| `packages/validators/test/estate/operation-vocabulary.ts:165,194,230` | Derives recognizer vocabulary from product AST | Frozen complete witness records pinned to their source hash; no runtime prose classification |
| `packages/validators/src/ladders/estate/completion-contract.ts:45` | Exact approved phrase identity lookup | Allowed provenance/fixture lookup per clarified scope; retain to keep oracle independent of removable metadata |
| `packages/validators/src/ladders/estate/completion-contract.ts:192,196` | English re-read/this(file/document) regex infers rereads (machine file-extension grammar alone is allowed) | Map reference_read evidence or typed recovery.reread targets; no prose inference |

## Generator findings

| Location | Forbidden read | Structured replacement |
|---|---|---|
| `packages/generate/src/estate/asks.ts:469,667,669,672,692,705,758,762,769,775,895,926,933,939,950,954,956,959,961,1042,1048,1066,1070,1123,1188,1228,1399,1421` | COMMON, INTERROGATIVES, COPULAS, DIRECTIVE, MECHANICS, CONNECTIVE, STATEMENT_OPENERS, SUBORDINATORS, CLAUSE_WORDS, DETERMINERS, DANGLING, FUNCTION_WORDS, STATIVE, OPENING_DETERMINERS, LEAD_ADVERBS, IRREGULAR, NOUN_LINK, NOUN_ENDING, PREPOSITIONS, AUXILIARIES, LEAD_CONNECTIVE, SUBJECT_PRONOUN, RULE_WORDS, ASK_FRAME_WORDS, TRAILING_WORDS, HOOK_NOUNS, VERBS, KEEP | Delete lexical derivation; render carried typed acts from source spans and fixed frame/shape IDs; unknown act/source evidence produces a gap |
| `packages/generate/src/estate/asks.ts:394,398,433,434,435,436,437,532,534,538,541,613,629,699,719,732,864,867,868,869,879,1080,1092,1174,1217,1244,1257,1292,1312,1356,1359,1377,1454,1476` | Inline English read/negation/subject/condition/conjunction/exception/plural rules, abbreviation-aware sentence cutting | Parser boundaries and explicit act IDs/source spans; no words select cuts or acts |
| `packages/generate/src/estate/frames.ts:153,178` | ASKED_PATTERNS and pronounDerivation interpret English clauses | Rendering-only frame registry plus source parser spans |
| `packages/generate/src/estate/recovery.ts:13,15,31,35,37,57,62,67` | OBJECT_END, POINTER, recovery verbs, negation/modals/articles, this-file, and conjunctions infer recovery work | Typed recovery evidence (reread paths/rerun commands), fail closed for missing evidence |
| `packages/generate/src/estate/then.ts:524,736` | SAME_FILE_ACT edit/pronoun regex and file-extension alternatives infer target | act.target/reference evidence and structured recovery fields |
| `packages/generate/src/estate/unit.ts:130,159` | FORBIDS/OBLIGES English polarity patterns classify source examples | Explicit typed guard verdict/evidence and fixture example classification |

`predicates.ts:34–36` writes secret-prefix and currency-code machine-format assertions. Owner explicitly permits machine formats (key prefixes, hex IDs, email, phone, IBAN, currencies with digits) and requires secret/privacy checks retained. These are allowed and must not be removed.

## False positives / allowed

- `bank/common.ts:13,31` NOUNS/VERBS and `bank/blind/util.ts:180–181` PLACES/THINGS only WRITE fictional fixture text. They interpret no source.
- `frames.ts:19,33,43,61,79` TOOL_ACTS/TRIGGER_VARIANTS/ASK_FRAMES/ACT_SHAPES/CONTEXT_SHAPES WRITE rendering templates; exact re-render comparison is explicitly permitted.
- `bank/causes.ts` regex groups read structured bank IDs, not English prose; preserve existing IDs and causes.
- `completion.ts:343` deny/block and `situations.ts:291` Edit/Write match verdict/tool IDs. Prefer exact typed identity checks to avoid misleading lexical appearance.
- Test-type, evidence-kind, tool-name, artifact-kind, schema-key enums are structured IDs, not verb lists.

## Outside estate: inventory only (not this edit scope)

- `src/ladders/judges/v2/rules.ts:11,13–21`: PRICE/HOME_PLAN/CONFIRM/BILLING/INSTRUCTION/failure/CONCEDED/DECLINED/PROMISED text classifiers.
- `src/ladders/judges/pool.ts:260,262`: HOME_PLAN/BILLING text classifiers.
- `src/ladders/generator/bank.ts:2191,2197`: phrase alternatives classify failure detail text.
- `src/ladders/map/levels.ts:158`: refusal-reason phrase alternatives.
- `src/ladders/map/bank/perfect.ts:129`: `or`-word split extracts relation IDs from prose.
- `src/ladders/map/render.ts:44`: SYNONYMS; `src/ladders/judges/transforms.ts:43,44,69,76`: PEOPLE/STREETS/INJECTIONS/LOOSE_YES; `src/ladders/map/bank/styled.ts:28,42,58,68,83`: VERBS/OBJECTS/QUALIFIERS/SEGMENTS/MOMENTS; `src/ladders/judges/v2/bank.ts:190`: FILLER_WORDS. Rendering/test output pools; inspect usages if scope later expands.
- `src/ladders/stats/bank/degenerate.ts:275`: ENGLISH_WORDS (`a`) filters generated hexadecimal statistical fixture symbols.
- `src/hardness.ts:257`: pass/fail/pending grammar for a report field; structured status enum.
- `src/ladders/system/bank/claims/breaker2.ts:1515,2303,2943,4550`, `robust.ts:3598`, `breaker.ts:1465`, `exits.ts:167`: message/ask/error text alternatives used by system-test assertions.

A final read-only sweep at `a18d19251` found no forbidden semantic English list or alternation regex in either estate source tree. The inventory alone claims no fixture gap count.
