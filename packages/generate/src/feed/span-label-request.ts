/** Requests for the span labeller. Their answers use SpanLabel and opaque SubjectCandidate ids. */
export const spanLabelSystem = (definition: string): string =>
  [
    'You read short clauses copied from a company rule file. For each clause, say what condition it states.',
    'Answer with a JSON array, one object per clause, in the order given, and nothing else.',
    `The definition of a variable, as the store states it: ${definition}`,
    'A clause that states no condition under this definition is none.',
    'Each object is one of:',
    '{"kind":"numeric","subject":<what is measured, a short noun phrase>,"limit":<number>,"comparison":"lt"|"le"|"gt"|"ge"|"eq"|"ne","unit":<optional unit>}',
    '{"kind":"range","subject":<noun phrase>,"low":<number>,"high":<number>,"lowInclusive":<boolean>,"highInclusive":<boolean>,"unit":<optional>}',
    'For a range, low and high are the endpoints exactly as written, converted to numbers. Never shift an endpoint to the first or last permitted integer, even for a discrete count. Express openness only with lowInclusive and highInclusive: false means the endpoint is excluded, true means included. For example, more than 2 and fewer than 7 gives low:2, high:7, lowInclusive:false, highInclusive:false. An unqualified between/from-to range includes both endpoints; explicit wording at either end overrides that default.',
    '{"kind":"member","subject":<noun phrase>,"members":[<the listed members>]}',
    'Membership includes both inclusion and exclusion. For an exclusion such as neither X nor Y, members lists the excluded values X and Y. The subject names the variable, not the whole predicate. This is member, not boolean: the variable has string alternatives even though the condition has a truth value. The store generates both listed and unlisted samples; no polarity field is needed.',
    '{"kind":"boolean","subject":<noun phrase>}  (a fact that is true or false of the case, such as a valve being open or a badge being laminated; a clause that states the fact, or its negation, is boolean)',
    '{"kind":"none"}  (the clause states no condition on a quantity, a set or a yes/no fact)',
    'Name one quantity with one canonical subject across the estate, including when clauses use synonyms for it. Comparison wording and thresholds do not change the subject. When a list of subjects already used is given, reuse one exactly when it names the same quantity, even if its words differ from the clause. For example, invoice total and invoice amount can name one quantity; invoice amount and refund amount do not. Preserve distinctions of owner and unit. Never take a listed subject merely because it is listed.',
    'Write numbers as digits. "at most" is le, "fewer than" is lt, "more than" is gt, "at least" is ge.',
  ].join('\n');

export const SUBJECT_CHOICE_SYSTEM = [
  'A clause has just been labelled. Choose the existing label that names the same quantity, set or fact.',
  'The candidates have opaque ids. Answer with one JSON string: an existing candidate id, or "new".',
  'Use an id only if the clause names the same thing, including its kind, owner and unit.',
  'A different spelling is not a reason to choose new. Compare the quantity itself, not the comparison, threshold or wording. For example, invoice total and invoice amount can be aliases for one quantity. Different owners or units still mean different quantities.',
  'Do not rewrite the subject or return a subject string. If no candidate is equivalent, answer "new".',
  'Return only the JSON string, with no explanation, markdown or code fence.',
].join(' ');
