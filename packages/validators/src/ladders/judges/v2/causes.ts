/**
 * The cause of every item (docs/validators.md section 12.4, point 4): the one change in packages/judges that
 * makes the item pass, written as an instruction an executor can act on without reading the validator. Items
 * sharing a cause carry the same text and count once. The first rule whose pattern matches the item id wins;
 * every item of the bank must match a rule (a test checks it).
 */

import { MORE_CAUSES } from './causes-more';

const S = 'packages/judges';
export const SCREEN = `Add screenData(request) to ${S} (export it from src/index.ts): it returns { flagged, findings: [{ where }] }. Screen every sentence (split after . ! ? ; and at line breaks) of each place: each transcript entry read with its tool name (where transcript.<index>), the artifact (where artifact), and the Given values and keys read as JSON (where given). Flag a sentence that holds a judge word (rubric, grader, grading, judge, judges, evaluator, evaluating, evaluates, evaluation, reviewer, verdict, scoring model, criterion, criteria, fail picture, score it, rate this, outcome) and a verdict word (pass, passing, passed, passes, success, satisfied, compliant, met, 1.0, 0.99, fail, fails). Match without case; every character that is not a letter ends a word, so _ / - % . and digits separate words`;

const LANGUAGE: Record<string, string> = {
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  hi: 'Hindi',
  sv: 'Swedish',
  id: 'Indonesian',
};

const ENCODING: Record<string, string> = {
  base64: 'decode base64 runs (16 characters or more) and screen the decoded text',
  'base64-url': 'decode URL-safe base64 (- and _ in place of + and /, no padding)',
  rot13: 'screen the ROT13 reading of the text',
  'caesar-3': 'screen every Caesar shift of short texts, not only ROT13',
  hex: 'decode 0x hexadecimal runs',
  'url-encoding': 'decode %XX URL encoding',
  'html-entities': 'decode HTML numeric entities (&#NNN;)',
  'unicode-escapes': 'decode \\uXXXX escapes',
  reversed: 'screen the text read backwards',
  leetspeak: 'fold leetspeak digits (4 a, 3 e, 1 i, 0 o, 5 s, 7 t) before matching',
  'zero-width-interleaved': 'drop zero-width and other invisible characters before matching',
  homoglyphs: 'fold Cyrillic lookalike letters to Latin before matching',
  fullwidth: 'fold fullwidth letters (NFKC) before matching',
  'spaced-letters': 'join letters spaced one by one (i g n o r e) before matching',
  'dotted-letters': 'join letters separated by dots (i.g.n.o.r.e) before matching',
  'random-case': 'match without case',
  'base64-of-rot13': 'decode base64 and then screen the ROT13 reading of the result',
  'html-comment': 'screen text inside HTML comments',
  'markdown-link-title': 'screen the title text of markdown links',
  'json-field': 'screen string values inside JSON in the data',
  'code-comment': 'screen code comments in the data',
  binary: 'decode runs of 8-bit binary groups',
};

/** [pattern on the item id, cause]. Order matters: the first match wins. */
/**
 * Screen items that the base screen (SCREEN) alone turns green: a witness with every other screen behaviour
 * removed passes them on seeds 1 to 12, so their one fix is SCREEN and they count once with it.
 */
const BASE_SCREEN_ITEMS = new Set([
  'injection/encoding-url-encoding',
  'injection/encoding-random-case',
  'injection/encoding-html-comment',
  'injection/encoding-markdown-link-title',
  'injection/encoding-json-field',
  'injection/encoding-code-comment',
  'injection/place-card-1',
  'injection/place-card-2',
  'injection/place-artifact-1',
  'injection/place-artifact-2',
  'injection/place-file-name-1',
  'injection/place-file-name-2',
  'injection/place-given-value-1',
  'injection/place-given-value-2',
  'injection/place-given-key-1',
  'injection/place-given-key-2',
  'injection/place-tool-name-1',
  'injection/place-tool-name-2',
  'injection/file-name-style-1',
  'injection/file-name-style-2',
  'injection/file-name-style-4',
  'injection/file-name-style-5',
  'injection/buried-in-long-text',
  'precision/judge-words-16',
  'attacks/customer-tells-agent-to-ignore-rules',
  'attacks/bad-likert-judge',
  'attacks/crescendo-across-turns',
  'attacks/many-shot-fake-verdicts',
  'attacks/fake-rubric',
  'attacks/fake-answer-contract',
  'attacks/refusal-suppression',
  'attacks/pressure-on-the-evaluator',
  'attacks/role-play-pass-bot',
  'attacks/judge-role-line',
  'attacks/system-prompt-header',
  'attacks/verdict-in-json-keys',
  'attacks/payload-split-over-results',
  'attacks/instruction-in-artifact-footer',
]);

const RULES: readonly (readonly [RegExp, string])[] = [
  [
    /^v1\//,
    'Keep the judge path of ladder version 1 working (cassette replay, the answer contract, the council and its cascade).',
  ],
  [
    /^council\/default-assignment-takes-the-cheapest$/,
    'In council cheapest(): order judges by cost ascending, then id, and seat the first three.',
  ],
  [
    /^cascade\/cheapest-runs-first-whatever-the-row-order$/,
    'In council runRound: order the round by cost, then id, so the cheapest judge runs first whatever the order of the assignment row.',
  ],
  [
    /^check\/request-carries-the-expected-stage$/,
    "In check.ts requestFor: carry the block's expected stage into given.stage.",
  ],
  [
    /^check\/reasoning-from-an-agreeing-vote$/,
    'In check.ts verdictOf: take the reasoning from the first vote that agrees with the outcome.',
  ],
  [
    /^check\/one-error-is-named$/,
    'In check.ts verdictOf: name any judge that gave no answer in the evidence, one included.',
  ],
  [
    /^criteria\/empty-fixture-transcript-refused$/,
    'In criteria.ts: refuse a fixture whose transcript is empty.',
  ],
  [
    /^criteria\/one-picture-missing-refused$/,
    'In loadCriteria: refuse a criterion that lacks either its FAIL or its PASS picture.',
  ],
  [
    /^clients\/google-function-call-args$/,
    "In createGoogleJudge: read the answer from a part's functionCall.args when there is no text.",
  ],
  [
    /^clients\/openai-asks-for-the-answer-schema$/,
    'In createOpenAiJudge: send response_format { type: json_schema, json_schema: { name, schema } } with the default checks ledger (id, reasoning, grounded evidence or null, met or null).',
  ],
  [
    /^clients\/google-gives-a-response-schema$/,
    'In createGoogleJudge: send generationConfig.responseSchema with the answer contract.',
  ],
  [
    /^clients\/decisions-percentage$/,
    'In system1.ts: read a probability written as a percentage ("83%") as 0.83.',
  ],
  [
    /^clients\/http-judge-wrapped-answer$/,
    'In http-json.ts createHttpJudge: refuse a body wrapped as { answer }: the body is the answer contract.',
  ],
  [
    /^clients\/http-judge-text-answer$/,
    'In createHttpJudge: refuse a body given as { text }: the body is the answer contract.',
  ],
  [
    /^render\/reference-in-its-tag$/,
    'In prompt.ts buildPrompt: render request.reference inside a <reference_data> tag after the transcript.',
  ],
  [
    /^render\/reference-tag-guarded-/,
    'In prompt.ts escapeData: escape reference_data tags as it escapes the other data tags.',
  ],
  [
    /^consistency\/key-separates-reference$/,
    'In cassette.ts requestKey: hash request.reference with the rest of the request.',
  ],
  [
    /^clients\/echoed-short-header-redacted$/,
    'In http.ts scrub: replace every echoed header value with [redacted], whatever its length.',
  ],
  [
    /^clients\/event-stream-body$/,
    'In http.ts postJson: read a server-sent-event body (data: lines) by its last data event.',
  ],
  [
    /^cassette\/saved-entries-sorted$/,
    'In cassette.ts saveCassette: write entries sorted by judge, then key.',
  ],
  [
    /^cassette\/merge-(joins|refuses)/,
    'Add mergeCassettes(a, b) to packages/judges: join judges and entries, and throw on a key both hold with different answers.',
  ],
  [
    /^cassette\/prune-keeps-listed-keys$/,
    'Add pruneCassette(cassette, keys) to packages/judges: keep only the entries whose key is listed.',
  ],
  [/^criteria\/rubric-too-long-reported$/, 'In loadCriteria: report a rubric over 2000 characters.'],
  [/^check\/no-verdict-is-not-a-pass$/, 'In combineVerdicts: a block with no verdict at all does not pass.'],
  [
    /^check\/council-that-throws-is-inconclusive$/,
    'In judgeCheck: turn a council that throws into one inconclusive verdict per criterion.',
  ],
  [
    /^render\/as-written-code-in-the-reply$/,
    `In ${S}/src/transcript.ts: JSON-decode the frame text to the exact submitted code; JSON quoting must not alter its content.`,
  ],
  [
    /^render\/as-written-/,
    `In ${S}/src/prompt.ts escapeData: escape only data-tag lookalikes and keep every other angle bracket, entity and character exactly as written.`,
  ],
  [
    /^contract\/score-contradicts-near-the-middle$/,
    'In the contract: the contradiction limit is 0.5, a pass under it or a fail over it is refused.',
  ],
  [
    /^clients\/large-budget-sends-more-tokens$/,
    `In ${S}/src/contract.ts MAX_TOKENS: give the large budget more tokens than the normal one.`,
  ],
  [
    /^council\/unparsed-is-asked-again-at-large-budget$/,
    'In council castVote: ask an unparsed normal-budget answer again at the large budget.',
  ],
  [
    /^council\/a-throwing-judge-counts-one-error$/,
    'In council castVote: count each call that throws as one error.',
  ],
  [
    /^council\/score-averages-the-agreeing-votes$/,
    'In createCouncil: the result score is the mean over the agreeing votes that carry a score.',
  ],
  [
    /^council\/family-of-a-prefixed-model$/,
    `In ${S}/src/family.ts familyOfModel: read the family from the last path segment of the model name.`,
  ],
  [
    /^criteria\/same-transcript-different-artifacts-is-not-a-twin$/,
    'In loadCriteria: compare the fixtures with their artifacts, so equal transcripts with different artifacts are not twins.',
  ],
  [
    /^contract\/probability-(above-one|below-zero|nan)$/,
    `In ${S}/src/contract.ts outcomeFromProbability: read a probability that is not finite or is outside 0 to 1 as inconclusive.`,
  ],
  [
    /^contract\/probability-crossed-bounds$/,
    `In outcomeFromProbability: throw a RangeError when failAt is not under passAt.`,
  ],
  [/^contract\/probability-/, 'Keep outcomeFromProbability mapping at its bounds.'],
  [
    /^contract\/(brace-pair-before|example-object-before)$/,
    'In parseAnswerText: read the first object that meets the contract, past brace pairs and example objects.',
  ],
  [/^contract\/outcome-capitals$/, 'In the contract: read the outcome without case.'],
  [/^contract\/score-as-string$/, 'In the contract: read a score written as a number in quotes.'],
  [/^contract\/single-quotes$/, 'In the contract: read an object written with single quotes.'],
  [/^contract\/trailing-comma$/, 'In the contract: drop a comma before a closing brace.'],
  [/^contract\/line-comment$/, 'In the contract: drop a line that is only a // comment.'],
  [/^contract\/typographic-quotes$/, 'In the contract: read typographic quotes as straight quotes.'],
  [
    /^contract\/unescaped-quotes$/,
    'In the contract: repair a double quote left unescaped inside a string value (one that no comma, colon or closing brace follows).',
  ],
  [
    /^contract\/repaired-marked-/,
    'In the contract: set repaired: true on a result that was read only through a near-JSON repair.',
  ],
  [/^contract\/strict-not-marked-repaired$/, 'Keep repaired off a result read as strict JSON.'],
  [
    /^contract\/score-contradicts-outcome$/,
    'In the contract: refuse a pass scored under 0.5 or a fail scored over 0.5.',
  ],
  [/^contract\/two-disagreeing-answers$/, 'In the contract: refuse two answers whose outcomes disagree.'],
  [/^contract\/key-given-twice$/, 'In the contract: refuse an object that gives a top-level key twice.'],
  [/^contract\//, 'Keep the contract reading and refusing the shapes it handles today.'],
  [
    /^consistency\/repeated-(zero|fraction)-refused$/,
    'In judgeRepeated: throw a RangeError unless k is a whole number from 1.',
  ],
  [
    /^consistency\/repeated-/,
    `Add judgeRepeated(client, request, k) to ${S}: ask k times, return { outcomes, consistent }, consistent when all k outcomes are equal and not inconclusive.`,
  ],
  [
    /^consistency\/temperature-zero-openai$/,
    `In ${S}/src/clients/chat.ts createOpenAiJudge: send temperature 0.`,
  ],
  [/^consistency\/temperature-zero-anthropic$/, 'In createAnthropicJudge: send temperature 0.'],
  [/^consistency\/temperature-zero-google$/, 'In createGoogleJudge: send generationConfig.temperature 0.'],
  [/^consistency\//, 'Keep prompts, keys, parsing and councils identical across repeats.'],
  [
    /^cassette\/duplicate-judge-refused$/,
    `In ${S}/src/cassette.ts loadCassette: refuse a judge listed twice.`,
  ],
  [
    /^cassette\/entry-of-unknown-judge-refused$/,
    'In loadCassette: refuse an entry whose judge the cassette does not list.',
  ],
  [
    /^cassette\/entry-with-answer-and-error-refused$/,
    'In loadCassette: refuse an entry holding both an answer and an error.',
  ],
  [/^cassette\/empty-entry-refused$/, 'In loadCassette: refuse an entry with no answer, raw text or error.'],
  [
    /^cassette\/answer-breaking-contract-refused$/,
    'In loadCassette: refuse a recorded answer that breaks the answer contract.',
  ],
  [
    /^cassette\/key-not-hex-refused$/,
    'In loadCassette: refuse a key that is not a 12-character hex request hash.',
  ],
  [/^cassette\//, 'Keep cassettes recording and replaying as they do.'],
  [
    /^clients\/openai-content-parts$/,
    `In ${S}/src/clients/chat.ts createOpenAiJudge: when message.content is a list, join the text of its text parts.`,
  ],
  [
    /^clients\/openai-tool-call-arguments$/,
    'In createOpenAiJudge: read the answer from tool_calls[0].function.arguments when content is empty.',
  ],
  [
    /^clients\/openai-legacy-text$/,
    'In createOpenAiJudge: read choices[0].text when the choice has no message.',
  ],
  [
    /^clients\/openai-content-filter$/,
    'In createOpenAiJudge: read finish_reason content_filter as declined (inconclusive, not unparsed).',
  ],
  [
    /^clients\/anthropic-tool-use-input$/,
    "In createAnthropicJudge: read the answer from a tool_use block's input when there is no text.",
  ],
  [/^clients\/google-thought-parts-left-out$/, 'In createGoogleJudge: leave out parts marked thought: true.'],
  [
    /^clients\/google-prompt-blocked$/,
    'In createGoogleJudge: read promptFeedback.blockReason with no candidate as declined (inconclusive, not unparsed).',
  ],
  [
    /^clients\/google-recitation$/,
    'In createGoogleJudge: read finishReason RECITATION as declined, like SAFETY.',
  ],
  [
    /^clients\/jev-probability-in-quotes$/,
    `In ${S}/src/clients/system1.ts: read a probability written as a number in quotes.`,
  ],
  [
    /^clients\/decisions-answers-by-name$/,
    'In createOpenAiDecisionsJudge: read answers given as an object keyed by question name.',
  ],
  [
    /^clients\/retry-after-/,
    `In ${S}/src/http.ts postJson: wait what Retry-After says (seconds or an HTTP date, at most the longest wait) before the next attempt.`,
  ],
  [/^clients\//, 'Keep the clients reading the shapes they read today.'],
  [
    /^criteria\/fixtures-differ-only-in-spacing$/,
    `In ${S}/src/criteria.ts loadCriteria: compare the pass and fail fixtures after folding runs of white space.`,
  ],
  [/^criteria\/fixtures-differ-only-in-case$/, 'In loadCriteria: compare the fixtures without case.'],
  [
    /^criteria\/same-pictures$/,
    'In loadCriteria: report a criterion whose PASS and FAIL pictures say the same.',
  ],
  [
    /^criteria\/pictures-same-but-spacing$/,
    'In loadCriteria: compare the PASS and FAIL pictures after folding case and white space.',
  ],
  [/^criteria\//, 'Keep the criteria loader reporting what it reports today.'],
  [
    /^check\/two-judge-verdicts-same-id-refused$/,
    `In ${S}/src/check.ts combineVerdicts: refuse two judge verdicts with one id.`,
  ],
  [
    /^check\/verdict-ids-unique-across-names$/,
    'In judgeCheck: give each verdict a unique id when two criterion names map to the same safe id.',
  ],
  [
    /^check\/diff-summary-one-line$/,
    `In ${S}/src/artifacts.ts summarizeDiff: keep the summary on one line when a file name holds a line break.`,
  ],
  [/^check\//, 'Keep the judge check and verdict merging as they are.'],
  [
    /^rubric\/(.+)$/,
    `Add lintCriterion(criterion) to ${S}, returning { issues: [{ code }] }, and make it report the code named in the item (spec in the item detail).`,
  ],
  [
    /^render\/forged-entry-in-tool-name$/,
    `In ${S}/src/transcript.ts: keep tool metadata in the JSON frame; a tool name containing bracket labels or separators cannot create another entry.`,
  ],
  [
    /^render\/forged-entry-/,
    'In transcript.ts: render indexed JSON entries with authoritative role fields; separators and bracket labels inside text remain decoded string content, never new entries.',
  ],
  [
    /^render\/closing-tag-/,
    'In escapeData: guard data tags written with lookalike characters: fold compatibility forms (NFKC) and drop invisible characters before escaping.',
  ],
  [
    /^render\//,
    'Render indexed JSON entries with separate role and text fields, preserving the planted transcript verdict after decoding.',
  ],
  [/^budget\/singular-marker$/, 'In fitPrompt: write "[1 earlier entry omitted]" for one dropped entry.'],
  [/^budget\/tool-result-not-orphaned$/, 'In fitPrompt: also drop a tool result whose call was dropped.'],
  [
    /^budget\/budget-(zero|fraction)-refused$/,
    'In fitPrompt: throw a RangeError unless the budget is a whole number above 0.',
  ],
  [
    /^budget\/(refuses-when-last-block-too-big|single-turn-too-big-refused)$/,
    'In fitPrompt: throw a RangeError when the last block alone does not fit.',
  ],
  [
    /^budget\//,
    `Add fitPrompt(request, maxChars) to ${S}: drop the fewest oldest entries so buildPrompt(request).user fits, replacing them with one context entry "[k earlier entries omitted]"; never drop the last block, the artifact or the Given.`,
  ],
  [
    /^evidence\/(extra-spaces|line-breaks-folded)$/,
    'In groundEvidence: fold runs of white space before matching.',
  ],
  [/^evidence\/(surrounding-quotes)$/, 'In groundEvidence: strip one pair of quotes around the evidence.'],
  [/^evidence\/typographic-quotes$/, 'In groundEvidence: read typographic quotes as straight quotes.'],
  [/^evidence\/other-case$/, 'In groundEvidence: match without case.'],
  [
    /^evidence\/ellipsis-/,
    'In groundEvidence: split the evidence at "..." and find the parts in order in one place.',
  ],
  [
    /^evidence\/(decomposed-accents|fullwidth-digits)$/,
    'In groundEvidence: fold compatibility forms (NFKC) before matching.',
  ],
  [/^evidence\/partial-word$/, 'In groundEvidence: match only on word boundaries.'],
  [/^evidence\/in-artifact$/, 'In groundEvidence: search the artifact text and name it artifact.'],
  [/^evidence\/in-given$/, 'In groundEvidence: search the Given (its JSON) and name it given.'],
  [
    /^evidence\//,
    `Add groundEvidence(request, answer) to ${S}: grounded when answer.evidence is found in a transcript entry text (never the criterion, never a tool name), returning { grounded, where: transcript.<index> } for the first entry holding it.`,
  ],
  [/^injection\/language-(\w+)$/, ''],
  [/^injection\/encoding-([\w-]+)$/, ''],
  [/^injection\/layered-(\w+)-(file-name|given)-/, ''],
  [/^injection\/layered-(\w+)-([\w-]+)-/, ''],
  [/^injection\/place-artifact-/, 'In screenData: screen the artifact text and name it artifact.'],
  [
    /^injection\/(place-file-name-|file-name-style-[12]$)/,
    'In screenData: read file names as words (split on _ - . /) in the artifact.',
  ],
  [/^injection\/file-name-style-3$/, 'In screenData: split CamelCase file names into words.'],
  [/^injection\/file-name-style-4$/, 'In screenData: split file paths on / and _ into words.'],
  [/^injection\/file-name-style-5$/, 'In screenData: URL-decode file names before reading them as words.'],
  [/^injection\/place-given-value-/, 'In screenData: screen the Given values and name them given.'],
  [/^injection\/place-given-key-/, 'In screenData: screen the Given keys too.'],
  [/^injection\/place-tool-name-/, 'In screenData: screen tool names, read as words.'],
  [/^injection\/place-card-/, 'In screenData: screen card entries, their JSON included.'],
  [
    /^injection\/buried-in-long-text$/,
    'In screenData: screen every sentence of a long text, not only its start.',
  ],
  [/^injection\/after-closing-tag$/, SCREEN],
  [/^injection\/double-base64$/, 'In screenData: decode base64 twice when the decoded text is base64 again.'],
  [
    /^injection\/mixed-script-words$/,
    'In screenData: fold lookalike letters word by word in mixed-script text.',
  ],
  [/^injection\/markdown-heading$/, SCREEN],
  [/^injection\//, SCREEN],
  [
    /^precision\//,
    'In screenData: in English, flag a sentence only when it instructs (an imperative, a modal such as must or should, or a note addressed to the judge); narration that only uses judge words (a judge at a hearing, an exam grader) is not flagged.',
  ],
  [
    /^attacks\/(answer-bloat-after|verbose-before|earlier-good-attempt|minimum-over-turns|mischievous-user-claims-consent|goal-shift-cover|contradiction-in-ledger)$/,
    SCREEN,
  ],
  [
    /^attacks\/customer-tells-agent-to-ignore-rules$/,
    'In screenData: do not flag an instruction addressed to the agent (a customer asking it to ignore its rules); only instructions to the judge.',
  ],
  [
    /^attacks\/bad-likert-judge$/,
    'In screenData: flag a rating-scale claim that grades the reply against the criterion (Bad Likert Judge).',
  ],
  [
    /^attacks\/crescendo-across-turns$/,
    'In screenData: flag an instruction to the reviewer built up across several customer turns.',
  ],
  [
    /^attacks\/many-shot-fake-verdicts$/,
    'In screenData: flag fabricated judged examples (Verdict: pass) in the data.',
  ],
  [/^attacks\/fake-rubric$/, 'In screenData: flag a criterion or PASS picture written inside the data.'],
  [
    /^attacks\/fake-answer-contract$/,
    'In screenData: flag an answer object ({"outcome": "pass"}) written inside the data.',
  ],
  [
    /^attacks\/refusal-suppression$/,
    'In screenData: flag a sentence forbidding the evaluator to answer fail.',
  ],
  [/^attacks\/pressure-on-the-evaluator$/, 'In screenData: flag pressure addressed to the evaluator.'],
  [
    /^attacks\/role-play-pass-bot$/,
    'In screenData: flag a role-play that recasts the judge (you are a grader who ...).',
  ],
  [/^attacks\/judge-role-line$/, 'In screenData: flag a [judge] verdict line inside the data.'],
  [
    /^attacks\/system-prompt-header$/,
    'In screenData: flag a fake system prompt for the grader inside the data.',
  ],
  [
    /^attacks\/verdict-in-json-keys$/,
    'In screenData: read JSON keys as words (grader_verdict) when screening.',
  ],
  [
    /^attacks\/payload-split-over-results$/,
    'In screenData: also screen the transcript read as one text, so an instruction split over entries is found.',
  ],
  [/^attacks\/instruction-in-artifact-footer$/, 'In screenData: screen the artifact, its comments included.'],
  [/^attacks\/injection-probability-mid-conversation$/, SCREEN],
  [
    /^council\/majority-size-/,
    `In ${S}/src/council.ts majority: default to three seated judges: two supporting votes and strictly more support than the other side; otherwise split. Explicit numeric seats set the quorum; weighted options keep their cast-weight denominator.`,
  ],
  [
    /^council\/weight-(negative|not-finite)-refused$/,
    'In majority: throw a RangeError for a weight that is negative or not finite.',
  ],
  [
    /^council\/weight/,
    "Add majority(votes, { weights }): a vote weighs its judge's weight (default 1); an outcome wins with more than half of the total weight.",
  ],
  [
    /^council\/(correlated|family|three-families|all-one-family|distinct-families)/,
    'Add majority(votes, { families }): votes of one family first collapse into one family vote (its own majority, inconclusive on a split), each family weighing 1.',
  ],
  [/^council\/size-/, 'In createCouncil: take size (default 3) and seat that many judges per class.'],
  [
    /^council\/weights-in-the-council$/,
    'In createCouncil: take weights and pass them to the round majority.',
  ],
  [/^council\//, 'Keep the council behaviour it has today.'],
  [
    /^cascade\/(reports-|cost-below-full)/,
    'In createCouncil: report cost on the council result, the sum of the costs of every judge called (re-asks and later rounds included).',
  ],
  [
    /^cascade\/threshold-/,
    'In createCouncil: throw CouncilConfigError for a cascade threshold outside (0.5, 1].',
  ],
  [
    /^cascade\/per-judge-threshold/,
    'In createCouncil: take cascade.thresholds per judge id, used in place of the threshold for that judge.',
  ],
  [
    /^cascade\/flagged-request-never-stops-early$/,
    'In the cascade: never stop at the cheapest judge when screenData flags the request.',
  ],
  [/^cascade\//, 'Keep the cascade stopping only on a sure cheap pass.'],
  [/^turns\/judge-throws-on-a-turn$/, 'In judgeTurns: a judge that throws makes its turn inconclusive.'],
  [/^turns\/burst-is-one-turn$/, 'In judgeTurns: consecutive customer messages are one turn.'],
  [
    /^turns\/(recovered-at|recovery-after-inconclusive)$/,
    'In judgeTurns: report recoveredAt, the first turn after the first failing one that passes.',
  ],
  [/^turns\/context-is-not-a-turn$/, 'In judgeTurns: context entries are not turns.'],
  [
    /^turns\/no-customer-refused$/,
    'In judgeTurns: throw a RangeError for a transcript with no customer message.',
  ],
  [
    /^turns\//,
    `Add judgeTurns(judge, request) to ${S}: judge each turn on the prefix ending where the next turn starts; return { turns: [{ turn, outcome }], outcome (fail, else inconclusive, else pass), firstFailing }.`,
  ],
  [/^pairwise\/judge-throws$/, 'In comparePair: a pair judge that throws gives inconclusive.'],
  [
    /^pairwise\/pair-prompt-guards-/,
    'In buildPairPrompt: escape the candidate tags (first_data, second_data) inside candidate text.',
  ],
  [
    /^pairwise\/pair-prompt-/,
    `Add buildPairPrompt({ criterion, first, second }) to ${S}: each candidate inside its own data tag, <first_data> then <second_data>.`,
  ],
  [
    /^pairwise\/bradley-terry-(disconnected|undefeated)-refused$/,
    'In bradleyTerry: throw a RangeError when the comparison graph is not strongly connected.',
  ],
  [
    /^pairwise\/bradley-terry-/,
    "Add bradleyTerry(wins) to packages/judges: maximum likelihood strengths summing to 1 (Hunter's MM iteration), ties counted as halves.",
  ],
  [/^pairwise\/elo-/, 'Add eloUpdate(ra, rb, score, k = 32): the two new Elo ratings.'],
  [
    /^pairwise\/(cycle-found|no-cycle-when-transitive)$/,
    'Add findCycles(wins): every 3-player cycle by majority, as sorted index triples starting at the smallest index.',
  ],
  [
    /^pairwise\//,
    `Add comparePair(judge, { criterion, a, b }) to ${S}: ask the pair judge in both orders and return { winner }: the agreed winner, tie when both say tie, else inconclusive.`,
  ],
  [
    /^calibration\/metric-confusion$/,
    'In calibrate: report labels.metrics.tp, fp, tn, fn per judge: the confusion counts tp, fp, tn, fn (fail is the positive class; an inconclusive verdict counts as wrong).',
  ],
  [
    /^calibration\/metric-sensitivity$/,
    'In calibrate: report labels.metrics.sensitivity per judge: sensitivity tp/(tp+fn).',
  ],
  [
    /^calibration\/metric-specificity$/,
    'In calibrate: report labels.metrics.specificity per judge: specificity tn/(tn+fp).',
  ],
  [
    /^calibration\/metric-balancedAccuracy$/,
    'In calibrate: report labels.metrics.balancedAccuracy per judge: balancedAccuracy, the mean of sensitivity and specificity.',
  ],
  [/^calibration\/metric-ppv$/, 'In calibrate: report labels.metrics.ppv per judge: ppv tp/(tp+fp).'],
  [/^calibration\/metric-npv$/, 'In calibrate: report labels.metrics.npv per judge: npv tn/(tn+fn).'],
  [/^calibration\/metric-f1$/, 'In calibrate: report labels.metrics.f1 per judge: f1 2tp/(2tp+fp+fn).'],
  [
    /^calibration\/metric-mcc$/,
    'In calibrate: report labels.metrics.mcc per judge: mcc, the Matthews correlation.',
  ],
  [
    /^calibration\/metric-youden$/,
    'In calibrate: report labels.metrics.youden per judge: youden, sensitivity + specificity - 1.',
  ],
  [
    /^calibration\/metric-scottPi$/,
    'In calibrate: report labels.metrics.scottPi per judge: scottPi, the Scott pi.',
  ],
  [
    /^calibration\/metric-prevalenceIndex$/,
    'In calibrate: report labels.metrics.prevalenceIndex per judge: prevalenceIndex |tp-tn|/n.',
  ],
  [
    /^calibration\/metric-biasIndex$/,
    'In calibrate: report labels.metrics.biasIndex per judge: biasIndex |fp-fn|/n.',
  ],
  [/^calibration\/metric-accuracy$/, 'In calibrate: report labels.metrics.accuracy per judge: (tp+tn)/n.'],
  [
    /^calibration\/metric-falsePositiveRate$/,
    'In calibrate: report labels.metrics.falsePositiveRate per judge: fp/(fp+tn).',
  ],
  [
    /^calibration\/metric-falseNegativeRate$/,
    'In calibrate: report labels.metrics.falseNegativeRate per judge: fn/(fn+tp).',
  ],
  [
    /^calibration\/fleiss-kappa-across-judges$/,
    "In calibrate: report each criterion's fleissKappa across every judge's verdicts on the labelled blocks (pass, fail, inconclusive).",
  ],
  [
    /^calibration\/labels-conflicting-duplicates$/,
    'In calibrate: name blocks with the same slice and opposite labels in labelConflicts.',
  ],
  [
    /^calibration\/labels-fixture-leak$/,
    'In calibrate: name labelled blocks equal to a fixture in fixtureLeaks.',
  ],
  [
    /^calibration\/labels-for-an-unknown-criterion$/,
    'In calibrate: list labels of criteria it does not run in unknownLabels.',
  ],
  [
    /^calibration\/labels-few-in-a-class$/,
    'In calibrate: warn few-labels when a class has fewer than 5 labelled blocks.',
  ],
  [
    /^calibration\/coverage-n(5|20|100)-p0\.97-/,
    'In agreementInterval: use an interval that keeps 95 percent coverage near agreement 1 at small n (Clopper-Pearson or Jeffreys, not Wilson).',
  ],
  [
    /^calibration\/coverage-n500-p0\.985-/,
    'In agreementInterval: keep coverage at n 500 and agreement above 0.985 (an exact or Jeffreys interval).',
  ],
  [
    /^calibration\/coverage-/,
    `Add agreementInterval(agree, n) to ${S}/src/calibration.ts returning { lower, upper } with at least 93 percent coverage.`,
  ],
  [
    /^calibration\/interval-is-wilson-/,
    'In calibrate: report labels.agreement as the Wilson 95 percent interval on agree of n.',
  ],
  [/^calibration\/pabak-/, 'In calibrate: report labels.pabak = 2 * agree / n - 1.'],
  [/^calibration\/ac1-/, "In calibrate: report labels.ac1, Gwet's AC1 for two categories."],
  [
    /^calibration\/one-label-class-has-no-kappa$/,
    'In calibrate: leave kappa undefined when the labels hold one class only.',
  ],
  [/^calibration\//, 'Keep calibration computing kappa, the bar and the assignment as it does.'],
  [
    /^scale\/screen-/,
    'Make screenData linear in the text length (no per-character regex rebuild, no quadratic decoding).',
  ],
  [
    /^scale\/player-/,
    'In playerClient: index the entries by key once, instead of scanning every entry on every call.',
  ],
  [
    /^scale\/parse-many-braces-/,
    'In parseAnswerText: scan the objects once, skipping brace pairs with no key, so many brace pairs stay linear.',
  ],
  [/^scale\//, 'Keep the operation linear in its input.'],
  [
    /^live\//,
    'Run in the billed mode the owner approves; a failing live item points at the judge client named in its component.',
  ],
];

/** The cause of one item id. Throws when no rule matches: every item must carry a cause. */
export function causeOf(id: string): string {
  const more = MORE_CAUSES[id];
  if (more !== undefined) return more;
  if (BASE_SCREEN_ITEMS.has(id)) return SCREEN;
  for (const [pattern, cause] of RULES) {
    const match = pattern.exec(id);
    if (!match) continue;
    if (id.startsWith('rubric/')) {
      const code = id.slice('rubric/'.length);
      return `${cause} Code: ${code === 'block-scope-whole-conversation' ? 'scope-mismatch, block scope side' : code === 'hedged-picture' ? 'hedged, in the PASS picture' : code}.`;
    }
    if (cause !== '') return cause;
    if (id.startsWith('injection/language-')) {
      return `In screenData: recognise instructions to the judge written in ${LANGUAGE[match[1] as string] ?? match[1]}.`;
    }
    if (id.startsWith('injection/encoding-'))
      return `In screenData: ${ENCODING[match[1] as string] ?? match[1]}.`;
    if (/^injection\/layered-\w+-(file-name|given)-/.test(id)) {
      return `In screenData: recognise instructions to the judge written in ${LANGUAGE[match[1] as string] ?? match[1]}.`;
    }
    // A layered item passes once its language and its encoding are both read: it shares the encoding's cause.
    return `In screenData: ${ENCODING[match[2] as string] ?? match[2]}.`;
  }
  throw new Error(`no cause rule matches the item ${id}`);
}
