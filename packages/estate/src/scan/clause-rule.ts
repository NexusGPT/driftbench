import nlp from 'compromise/two';

/**
 * The grammar of a rule clause: does one English sentence govern what the agent does next?
 *
 * A rule addresses the agent (an imperative, a second-person subject, an agent role or an output it writes),
 * in a normative mood (a modal, an imperative, `never`, `always`), in the present, about a future act.
 * Descriptions of a system, accounts of the past, other parties' obligations and conditional consequences
 * are not rules. Everything is decided from the sentence's structure and the tagger's reading of it; the
 * only closed word classes are the function words of English (modals, subordinators, pronouns) and the
 * names the estate itself declares.
 */
export type Rule = {
  subject: string;
  polarity: 'obligation' | 'prohibition';
  form: string;
  /** The act has no object of its own ("do not write it"): its pronoun refers to an earlier sentence. */
  partial?: boolean;
};

export type RuleContext = {
  /** The skill and helper names the estate declares, lowercased: the agent's own roles. */
  names: ReadonlySet<string>;
  /** The nearest heading says the section holds rules, so a habit stated in the present is one. */
  normative: boolean;
};

/** A heading that introduces rules: there, "every X does Y" governs, elsewhere it describes. */
export const NORMATIVE_HEADING =
  /\b(?:rules?|constraints?|requirements?|guidelines?|polic(?:y|ies)|principles?|standards?|conventions?|instructions?|invariants?|gotchas?|checklists?|discipline|contract|obligations?|protocols?|norms?|boundaries|guardrails?|must|never|always|do\s+not|don['’]?ts?|dos)\b/i;

type Term = { text: string; tags: string[] };
type Parsed = ReturnType<typeof nlp>;
const termsOf = (parsed: Parsed): Term[] => (parsed.json()[0]?.terms ?? []) as Term[];
const has = (term: Term | undefined, ...tags: string[]) =>
  !!term && tags.some((tag) => term.tags.includes(tag));
const blank = (text: string) => text.replace(/[^\n]/g, ' ');
const wordsOf = (text: string) =>
  [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)].map((entry) =>
    entry[0].toLowerCase().replace(/['’]s$/, ''),
  );

/** Words that name the agent itself or the people it addresses. */
const SELF = new Set([
  'you',
  'your',
  'we',
  'our',
  'us',
  'i',
  'me',
  'my',
  'assistant',
  'assistants',
  'agent',
  'agents',
  'subagent',
  'subagents',
  'helper',
  'helpers',
  'model',
  'models',
  'bot',
  'claude',
  'llm',
  'ai',
]);
/** What the agent writes: a rule about it governs the agent. */
const OUTPUT = new Set([
  'reply',
  'replies',
  'response',
  'responses',
  'answer',
  'answers',
  'message',
  'messages',
  'summary',
  'summaries',
  'output',
  'outputs',
  'report',
  'reports',
  'title',
  'titles',
  'draft',
  'drafts',
  'email',
  'emails',
  'sentence',
  'sentences',
  'paragraph',
  'paragraphs',
  'text',
  'explanation',
  'explanations',
]);
/** Parties other than the agent: a rule about them is somebody else's. */
const OTHERS = new Set([
  'they',
  'them',
  'their',
  'theirs',
  'he',
  'she',
  'his',
  'her',
  'someone',
  'anyone',
  'everyone',
  'everybody',
  'nobody',
  'people',
  'others',
  'user',
  'users',
  'customer',
  'customers',
  'client',
  'clients',
  'visitor',
  'visitors',
  'vendor',
  'vendors',
  'supplier',
  'suppliers',
  'contractor',
  'contractors',
  'employee',
  'employees',
  'staff',
  'member',
  'members',
  'person',
  'human',
  'humans',
  'owner',
  'owners',
  'team',
  'teams',
  'company',
  'partner',
  'partners',
]);
const SUBORDINATORS = new Set([
  'if',
  'when',
  'whenever',
  'once',
  'because',
  'since',
  'although',
  'though',
  'while',
  'whereas',
  'where',
  'unless',
  'until',
  'whether',
]);
const PREPOSITIONS = new Set([
  'of',
  'for',
  'from',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'about',
  'between',
  'under',
  'over',
  'into',
]);

const POINTERS = new Set(['see', 'refer', 'note', 'cf', 'example', 'examples', 'warning', 'tip', 'todo']);

/** Modals and negations that carry the normative mood. `strong` ones are normative whoever the subject is. */
const MARKER =
  /\b(?:(?<strong>must|shall|should|ought\s+to|(?:need|needs|has|have)\s+to|(?:is|are)\s+(?:required|expected)\s+to)(?:\s+(?<mod>not|never|always))?|(?<weak>never|always|(?:do|does)\s+not|(?:don|doesn|mustn|shouldn|can|won)['’]t|cannot|may\s+not))\b/i;
const BOUNDARY = /[,;:–—]|\s-\s|\b(?:and|but|then)\b/gi;
const PAST_CUES =
  /\b(?:previously|formerly|originally|used\s+to|no\s+longer|anymore|last\s+(?:week|month|year|sprint|quarter|time)|yesterday|\d+\s+(?:days?|weeks?|months?|years?)\s+ago|until\s+now|back\s+then|(?:the\s+)?(?:old|former|previous|earlier)\s+(?:rules?|polic(?:y|ies)|versions?|way)|in\s+(?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}(?:-\d{2})?)\b/i;
/** Every word that can open or carry a rule, so a sentence without one needs no parse unless it is an imperative. */
const PLACEHOLDER = /<<<|>>>|\{\{|\}\}|\$\{|\b(?:TODO|TBD|FIXME|XXX)\b/;
const CUES =
  /\b(?:must|shall|should|ought|needs?|has\s+to|have\s+to|required|expected|never|always|do\s+not|does\s+not|don['’]t|doesn['’]t|cannot|can['’]t|mustn['’]t|shouldn['’]t|won['’]t|may\s+not|only|unless|until|before|after|once|when|whenever|if|at\s+most|no\s+more\s+than|up\s+to|every|each)\b/i;
/** Function words (articles, pronouns, prepositions, conjunctions, auxiliaries) never open an imperative. */
const NOT_AN_INSTRUCTION_START =
  /^\W*(?:the|a|an|this|that|these|those|it|its|he|she|they|them|there|here|in|on|at|for|from|with|without|of|by|as|into|onto|over|under|about|between|through|during|within|across|per|via|and|or|but|nor|so|yet|because|since|while|although|though|is|are|was|were|been|being|am|has|have|had|does|did|will|would|can|could|may|might|what|which|who|whom|whose|why|how|some|any|all|most|many|much|few|several|both|either|neither|other|another|such|one|two|three|\d)\b/i;
const LEXICON = (nlp as unknown as { model(): { one: { lexicon: Record<string, string> } } }).model().one
  .lexicon;
const FUNCTION_TAGS = [
  'Pronoun',
  'Determiner',
  'Preposition',
  'Adverb',
  'Particle',
  'Negative',
  'Conjunction',
  'Expression',
];

export function clauseRule(source: string, context: RuleContext): Rule | undefined {
  // Parenthetical payloads are opaque to clause grammar, while the original quote remains intact.
  // A template placeholder ("<<<name>>>", "{{x}}", "${var}", "<id>", "TODO", "...") stands for text that is not
  // there yet: the clause is a pattern to fill, not a rule.
  if (PLACEHOLDER.test(source)) return;
  const whole = source
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, blank)
    .replace(/\s+/g, ' ')
    .trim();
  if (!whole || whole.length > 1500 || whole.includes('?')) return;
  // A lead-in that ends in a colon introduces what follows; it is no rule of its own.
  if (/[:：]$/.test(whole)) return;
  // A log entry or an account of the past is not a rule, whatever label it carries.
  if (PAST_CUES.test(whole) || PAST_ENTRY.test(whole)) return;
  // "Step 1 — Do X", "Rule: never Y": the label is a heading, its continuation can be a rule.
  const text = withoutLabel(whole);
  if (!text) return;
  // A sentence with no cue word that opens with a function word cannot be an instruction: skip the parser.
  if (!CUES.test(text) && (NOT_AN_INSTRUCTION_START.test(text) || !mayOpenAnInstruction(text))) return;
  const parsed = nlp(text);
  const terms = termsOf(parsed);
  if (terms.length < 2) return;
  if (describesThePast(text, terms)) return;
  const imperativeLed = imperativeStart(terms);

  const marker = MARKER.exec(text);
  if (marker) {
    const lead = text.slice(0, marker.index);
    // Words about words, quotation or speech are not rules about the agent.
    if (/\b(?:word|phrase|example|sample|quotation)\b/i.test(lead)) return;
    const found = markerRule(text, terms, marker, lead, imperativeLed, context);
    if (found) return found;
    return;
  }
  const bound = /^(?:at\s+most|no\s+more\s+than|a\s+maximum\s+of|up\s+to)\s+(.+)$/i.exec(text);
  if (bound && terms.some((term) => has(term, 'Value')) && terms.some((term) => has(term, 'Noun')))
    return { subject: bound[1] ?? '', polarity: 'obligation', form: 'bound' };
  if (/\bat\s+most\b/i.test(text) && imperativeLed && terms.some((term) => has(term, 'Value')))
    return {
      subject: terms.find((term) => has(term, 'Noun'))?.text || 'agent',
      polarity: 'obligation',
      form: 'bound',
    };
  const quantified = /^(?:every|each)\s+(.+)$/i.exec(text);
  if (quantified) return quantifiedRule(text, parsed, terms, context);
  const conditional = conditionalRule(text, terms, imperativeLed, context);
  if (conditional) return conditional;
  if (imperativeLed && (elidedObject(terms) || tooBare(terms))) return;
  if (imperativeLed)
    return withPartial({ subject: 'agent', polarity: 'obligation', form: 'imperative' }, text);
  return declaredOutput(text, parsed, terms, context);
}

/** `must`, `never`, `do not` and their kin, with the words before them as the subject. */
function markerRule(
  text: string,
  terms: Term[],
  marker: RegExpExecArray,
  lead: string,
  imperativeLed: boolean,
  context: RuleContext,
): Rule | undefined {
  // The subject is what stands after the last clause boundary before the marker.
  let boundary = 0;
  for (const found of lead.matchAll(BOUNDARY)) boundary = (found.index ?? 0) + found[0].length;
  const subjectText = lead.slice(boundary).trim();
  const subjectTerms = termsWithin(text, terms, boundary, marker.index);
  const subjectWords = wordsOf(subjectText);
  // "If you never X, Y happens": a marker inside a subordinate clause states a case, not a rule.
  if (subjectWords.some((word) => SUBORDINATORS.has(word))) return;
  const strong = marker.groups?.strong !== undefined;
  const negated = !!marker.groups?.mod && /not|never/i.test(marker.groups.mod);
  const prohibition = negated || (!strong && !/^always$/i.test(marker[0]));
  const afterMarker = text.slice(marker.index + marker[0].length);
  // "Never, under any circumstances, share the key": an interjected phrase between commas is not the act.
  const tail = (
    /^\s*,/.test(afterMarker) ? afterMarker.replace(/^\s*,[^,]{1,50},\s*/, '') : afterMarker
  ).replace(/^[\s,]+/, '');
  // The act is the first word after the marker: the sentence's own parse usually says it is a verb, so the
  // extra probe parse runs only when it does not.
  const after = termsWithin(text, terms, text.length - tail.length, text.length).find(
    (term) => !has(term, 'Negative', 'Adverb', 'Expression'),
  );
  if (!(has(after, 'Verb') && !has(after, 'Modal')) && !actFollows(tail)) return;
  // "The contract states that suppliers must ...": a modal in a complement clause reports somebody's words.
  // After a noun, "that" opens a relative clause ("tests that fail must ..."): a verb follows it.
  if (!imperativeLed) {
    const that = subjectTerms.findIndex((term) => /^that$/i.test(term.text));
    const next = subjectTerms[that + 1];
    if (that > 0 && next && has(next, 'Noun', 'Determiner', 'Pronoun') && !has(next, 'Verb')) return;
  }
  if (subjectWords.length > 0 && !imperativeLed) {
    const kind = subjectKind(subjectText, subjectTerms, context);
    if (kind === 'finite' || kind === 'others') return;
    // An obligation with a calendar deadline ("by Friday", "within a week") is owed by people or teams: an
    // agent session works in minutes. The estate's own agents, skills and outputs are exempt.
    if (kind === 'thing' && calendarDeadline(text, terms, marker.index + marker[0].length)) return;
    // A bare habit ("the tool never retries") describes unless the section holds rules.
    if (!strong && kind === 'thing' && !context.normative) return;
  } else if (
    subjectWords.length > 0 &&
    imperativeLed &&
    subjectKind(subjectText, subjectTerms, context) === 'others'
  )
    return;
  return withPartial(
    {
      subject: subjectText.replace(/^.*\bthat\s+/i, '') || 'agent',
      polarity: prohibition ? 'prohibition' : 'obligation',
      form: strong ? 'modal' : /^always$/i.test(marker[0]) ? 'universal' : 'negative',
    },
    tail,
  );
}

/** The terms of the sentence's own parse that lie in a character range: a word is read in its context. */
function termsWithin(text: string, terms: Term[], from: number, to: number): Term[] {
  const out: Term[] = [];
  let offset = 0;
  for (const term of terms) {
    const found = text.indexOf(term.text, offset);
    if (found < 0) break;
    offset = found + term.text.length;
    if (found >= from && offset <= to) out.push(term);
  }
  return out;
}

function calendarDeadline(text: string, terms: Term[], from: number): boolean {
  const tail = text.slice(from);
  // A deadline: "by Friday", "within a week", "no later than the end of the sprint". A duration alone
  // ("kept for 30 days") states a property of a thing and is not one.
  if (
    /\b(?:by|within|no\s+later\s+than|before\s+the\s+end\s+of)\s+(?:the\s+)?(?:next\s+|this\s+|end\s+of\s+(?:the\s+)?)?(?:\d+\s+|an?\s+|one\s+|two\s+|three\s+)?(?:days?|weeks?|months?|years?|quarters?|sprints?)\b/i.test(
      tail,
    )
  )
    return true;
  return (
    /\b(?:by|before|until|on)\b/i.test(tail) &&
    termsWithin(text, terms, from, text.length).some((term) => has(term, 'WeekDay', 'Month', 'Holiday'))
  );
}

/** What the words before a verb denote: the agent, what it writes, other parties, a thing, or a clause. */
function subjectKind(
  subject: string,
  subjectTerms: Term[],
  context: RuleContext,
): 'self' | 'output' | 'others' | 'thing' | 'finite' {
  const relative = subjectTerms.findIndex((term) => /^(?:that|which|who|whose)$/i.test(term.text));
  const before = relative >= 0 ? subjectTerms.slice(0, relative) : subjectTerms;
  // A finite verb ahead of the marker ("the contract states that ...") reports somebody's words. The first
  // word of a sentence is a noun the tagger may read as a verb ("Replies"), so only later words count.
  const reports = (at: number) => {
    const term = before[at] as Term;
    if (at === 0 || !has(term, 'Verb') || !has(term, 'PresentTense', 'PastTense')) return false;
    if (has(term, 'Gerund', 'Participle', 'Adjective', 'Noun', 'Infinitive', 'Modal')) return false;
    // A verb that ends the subject is a relative clause ("anything you write must"); one with words after it
    // opens a report ("the contract states that ...", "the reviewer says the reply must ...").
    const next = before[at + 1];
    if (!next) return relative >= 0 && at === before.length - 1;
    return !has(next, 'Preposition', 'Particle', 'Modal', 'Adverb');
  };
  if (before.some((_term, at) => reports(at))) return 'finite';
  // The head of the phrase is its last noun before a preposition or a participle.
  let head: Term | undefined;
  for (const [at, term] of before.entries()) {
    if (
      PREPOSITIONS.has(term.text.toLowerCase()) ||
      has(term, 'Participle', 'Gerund') ||
      (at > 0 && has(term, 'Verb') && has(term, 'PastTense'))
    )
      break;
    if (has(term, 'Noun', 'Pronoun', 'ProperNoun') || at === before.length - 1) head = term;
  }
  const word = (head?.text ?? subject)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’-]/gu, '')
    .replace(/['’]s$/, '');
  if (
    SELF.has(word) ||
    context.names.has(word) ||
    [...context.names].some((name) => subject.toLowerCase().includes(name))
  )
    return 'self';
  // "The worker must ..." names a role the document may be addressing to the agent; "Workers must ..." and a
  // named person speak of other parties.
  const definite = before.some((term) => has(term, 'Determiner'));
  if (OTHERS.has(word) || has(head, 'Person') || (has(head, 'Actor') && (has(head, 'Plural') || !definite)))
    return 'others';
  if (OUTPUT.has(word)) return 'output';
  return 'thing';
}

/** "Every reply includes a source", "Each helper records its findings", "Every run is logged". */
function quantifiedRule(text: string, parsed: Parsed, terms: Term[], context: RuleContext): Rule | undefined {
  // A present passive first: its auxiliary is the verb, whatever the tagger made of a noun before it.
  let subject: string | undefined = passiveSubject(text, terms);
  if (!subject && terms.some((term) => has(term, 'PresentTense'))) {
    const verb = terms
      .find((term) => has(term, 'Verb'))
      ?.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .toLowerCase();
    const token = [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].find(
      (entry) => entry[0].toLowerCase() === verb,
    );
    if (token && token.index > 0) subject = text.slice(0, token.index).replace(/\s+/g, ' ').trim();
  }
  if (!subject) return;
  const kind = subjectKind(subject, termsWithin(text, terms, 0, subject.length), context);
  if (kind === 'finite' || kind === 'others') return;
  // A habit of things governs the agent only when it addresses the agent or the section holds rules.
  if (kind === 'thing' && !context.normative && !/\b(?:you|your|we|our|us)\b/i.test(text)) return;
  return { subject, polarity: 'obligation', form: 'quantified' };
}

/**
 * The subject of a present passive ("Every run is logged"): a present-tense auxiliary directly followed by a
 * passive participle. The auxiliary's tense is read from the tagger on a neutral frame, because inside a
 * passive it is tagged only as an auxiliary. Past ("was logged"), perfect ("has been logged"), progressive
 * and modal ("will be logged") chains are statements of fact, not rules.
 */
function passiveSubject(text: string, terms: Term[]): string | undefined {
  let from = 0;
  for (let at = 1; at < terms.length - 1; at++) {
    const term = terms[at] as Term;
    const found = text.indexOf(term.text, from);
    if (found < 0) return;
    from = found + term.text.length;
    if (!term.tags.includes('Auxiliary')) continue;
    const participle = terms[at + 1] as Term;
    if (participle.tags.includes('Auxiliary') || !participle.tags.includes('Passive')) return;
    if (!probeTags(term.text).includes('PresentTense')) return;
    const subject = text.slice(0, found).replace(/\s+/g, ' ').trim();
    return subject.split(/\s+/).length > 1 ? subject : undefined;
  }
  return;
}

function probeTags(word: string): string[] {
  const probe = termsOf(nlp(`It ${word} done.`));
  return probe[1]?.tags ?? [];
}

/** "Before X, do Y", "Only when X, do Y", "If X, do Y", "Do Y only when X", "Do not Y unless X". */
function conditionalRule(
  text: string,
  terms: Term[],
  imperativeLed: boolean,
  context: RuleContext,
): Rule | undefined {
  const opening =
    /^(?:before|after|once|when|whenever|if|unless|until|only\s+(?:when|if|after|once|while))\b\s*(.+?)[,:]\s*(.+)$/i.exec(
      text,
    );
  const comma = text.search(/[,:]/);
  const openingHasVerb = termsWithin(text, terms, 0, comma < 0 ? 0 : comma).some((term) => has(term, 'Verb'));
  const main = opening?.[2] ?? '';
  const instruction =
    startsAsInstruction(main) ||
    (/^[\p{L}'’-]+[.!]?$/u.test(main) && isImperative(main.replace(/[.!]$/, ''), true));
  if (opening && (openingHasVerb || /^only\b/i.test(text) || instruction) && instruction)
    return { subject: 'agent', polarity: 'obligation', form: 'conditional' };
  const restricted = /^only\s+(.+)$/i.exec(text);
  if (restricted && startsAsInstruction(restricted[1] ?? ''))
    return { subject: 'agent', polarity: 'obligation', form: 'conditional' };
  const trailing = /^(.+?)\s+(?:only\s+(?:when|if|after|once|while)|unless|until)\b/i.exec(text);
  if (trailing) {
    const main = trailing[1] ?? '';
    if (startsAsInstruction(main)) return { subject: 'agent', polarity: 'obligation', form: 'conditional' };
    // "You may X only after Y": the agent is the subject.
    const who = main.split(/\s+(?:may|can|are allowed to|is allowed to)\b/i)[0] ?? main;
    const kind = subjectKind(who, termsWithin(text, terms, 0, who.length), context);
    if (/\b(?:may|can|allowed\s+to)\b/i.test(main) && kind === 'self')
      return { subject: 'agent', polarity: 'obligation', form: 'conditional' };
  }
  void terms;
  void imperativeLed;
  return;
}

/** "Replies stay under 80 words": an output of the agent, stated in the present, with a limit or a style. */
function declaredOutput(text: string, parsed: Parsed, terms: Term[], context: RuleContext): Rule | undefined {
  let verbAt = terms.findIndex(
    (term, at) => at > 0 && has(term, 'Verb') && has(term, 'PresentTense', 'Copula'),
  );
  // "Replies stay brief": the tagger may read the subject as a verb and the verb as a noun.
  if (
    verbAt < 0 &&
    OUTPUT.has((terms[0]?.text ?? '').toLowerCase()) &&
    !has(terms[1], 'Determiner', 'Preposition', 'Conjunction')
  )
    verbAt = 1;
  if (verbAt < 1) return;
  const subject = terms
    .slice(0, verbAt)
    .map((term) => term.text)
    .join(' ');
  if (subjectKind(subject, terms.slice(0, verbAt), context) !== 'output') return;
  const measured =
    /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:words?|sentences?|paragraphs?|characters?|lines?|bullets?|items?|sections?|pages?)\b/i.test(
      text,
    );
  // "Replies stay brief": a generic plural (no article) states a norm; "the reply stays brief" may describe.
  const generic = !terms.slice(0, verbAt).some((term) => has(term, 'Determiner', 'Possessive'));
  if (!measured && !generic && !terms.some((term) => has(term, 'Adjective')) && !context.normative) return;
  if (has(terms[verbAt], 'PastTense')) return;
  return { subject, polarity: 'obligation', form: 'declared' };
}

/** An act follows the marker: a verb the tagger accepts after "You must". */
function actFollows(tail: string): boolean {
  const clean = tail.replace(/[.!]+$/, '').trim();
  return !!clean && isImperative(clean, true);
}

/** Supply an overt subject/modal to disambiguate a bare imperative, without a verb vocabulary. */
function isImperative(text: string, bare = false): boolean {
  const clean = text.replace(/^(?:please|kindly|first|then|also|just|simply)\s+/i, '');
  if (!clean) return false;
  const probe = termsOf(nlp(`You must ${clean.charAt(0).toLowerCase()}${clean.slice(1)}`));
  if (!(has(probe[0], 'Pronoun') && has(probe[1], 'Modal') && has(probe[2], 'Verb'))) return false;
  if (bare) return true;
  // A noun phrase with a finite verb of its own ("Build artifacts are stored") is a statement.
  return !/^[\p{L}-]+(?:\s+[\p{L}-]+)?\s+(?:is|are|was|were|has|have|had|does|do|did|will|can)\b/iu.test(
    clean,
  );
}

const startsAsInstruction = (text: string) => imperativeStart(termsOf(nlp(text)));

/** The sentence opens with a bare verb: an instruction to its reader, with no subject. */
function imperativeStart(terms: Term[]): boolean {
  let at = 0;
  while (
    at < terms.length &&
    /^(?:please|kindly|just|simply|also|then|first|next|finally|now|and|but|always)$/i.test(
      (terms[at]?.text ?? '').replace(/[^\p{L}]/gu, ''),
    )
  )
    at++;
  const first = terms[at];
  if (!first || terms.length - at < 2) return false;
  const word = first.text.replace(/[^\p{L}'’-]/gu, '').toLowerCase();
  if (!word || POINTERS.has(word)) return false;
  if (
    has(
      first,
      'Gerund',
      'Pronoun',
      'Determiner',
      'Preposition',
      'Conjunction',
      'Value',
      'ProperNoun',
      'Possessive',
      'Modal',
      'Copula',
      'Participle',
      'Acronym',
      'Url',
      'Email',
      'Emoji',
    )
  )
    return false;
  if (has(first, 'PastTense') && !has(first, 'Infinitive', 'Imperative')) return false;
  const second = terms[at + 1];
  if (
    /^(?:of|is|are|was|were|has|have|had|does|did|will|can)$/i.test(second?.text ?? '') &&
    !has(first, 'Imperative')
  )
    return false;
  // "Build artifacts are stored": a compound noun, then a finite verb.
  if (has(second, 'Plural') && has(terms[at + 2], 'Copula', 'Auxiliary')) return false;
  if (has(first, 'Imperative')) return true;
  if (has(first, 'Verb') && has(first, 'Infinitive')) return true;
  // A noun-tagged first word is an instruction when an article, pronoun, preposition, adverb, number or
  // adjective follows it ("Stop when ...", "Output plain text") and no finite verb of its own opens the
  // sentence: two bare nouns ("Background description") are a label, not an act.
  if (
    has(first, 'Noun', 'Adjective') &&
    !has(first, 'Plural') &&
    !/(?:ing|ed|tion|ment|ness|ity)$/.test(word)
  ) {
    if (
      !has(
        second,
        'Determiner',
        'Pronoun',
        'Preposition',
        'Conjunction',
        'Adverb',
        'Value',
        'Possessive',
        'Particle',
        'Adjective',
        'QuestionWord',
      )
    )
      return false;
    for (const term of terms.slice(at + 1)) {
      if (has(term, 'Conjunction', 'Preposition', 'Condition')) break;
      if (
        has(term, 'Verb') &&
        has(term, 'PresentTense', 'PastTense', 'Copula') &&
        !has(term, 'Infinitive', 'Gerund', 'Participle')
      )
        return false;
    }
    const rest = terms
      .slice(at)
      .map((term) => term.text)
      .join(' ');
    return isImperative(rest, true);
  }
  return false;
}

/** A log entry opens with a capitalised past form and a label: "Added: ...", "Changed in v2: ...". */
const PAST_ENTRY = /^[\p{Lu}]\p{L}*ed\b[^:—–]{0,30}[:—–]/u;

/**
 * "Step 1 — ...", "Discover — ...", "Rule: ...": a heading or step label of at most three words (one word,
 * or capitalised, or in capitals) before a dash or a colon. What follows it is the clause. A line that
 * opens with a conditional word keeps its opening ("Before X: do Y").
 */
function withoutLabel(text: string): string {
  if (/^(?:before|after|only|if|when|whenever|once|unless|until|while|because|since)\b/i.test(text))
    return text;
  const found = /^([^.,;:!?()—–]{1,40}?)\s*(?:[—–]|\s-\s|:)\s+(.+)$/u.exec(text);
  if (!found) return text;
  const words = (found[1] ?? '').trim().split(/\s+/);
  const label =
    words.length <= 3 &&
    (words.length === 1 ||
      /^\p{Lu}{2,}\b/u.test(words[0] ?? '') ||
      words.every((word) => /^[\p{Lu}\d]/u.test(word)));
  if (!label) return text;
  const rest = (found[2] ?? '').trim();
  const prefix = (found[1] ?? '').trim();
  // A step or phase heading ("Step 1 — Discover the files") is a heading whatever follows it, and a title after
  // a dash with no closing punctuation is a title, not a sentence. A colon label ("Rule: never X") is a lead-in.
  const dash = /[—–]|\s-\s/.test(text.slice(prefix.length, prefix.length + 4));
  if (
    dash &&
    (/^(?:step|phase|part|stage|round|item|section|chapter|\d)/i.test(prefix) ||
      (!/[.!)]$/.test(rest) && !CUES.test(rest)))
  )
    return '';
  return rest;
}

/** First words that can start an instruction in the tagger's own lexicon (a noun or verb stem, or unknown). */
function mayOpenAnInstruction(text: string): boolean {
  const first = /^\W*([\p{L}][\p{L}'’-]*)/u.exec(text)?.[1]?.toLowerCase();
  if (!first) return false;
  if (text.split(' ').length > 80) return false;
  // An output noun can open a statement about the agent's own output ("Replies stay brief").
  if (OUTPUT.has(first) || OPENERS.has(first)) return true;
  const tag = LEXICON[first];
  if (tag === 'Infinitive') return true;
  if (/(?:ing|ed)$/.test(first) || (/s$/.test(first) && !/ss$/.test(first) && tag !== undefined))
    return false;
  return (
    tag === undefined || ['Infinitive', 'Singular', 'Verb', 'Noun', 'Adjective', 'Uncountable'].includes(tag)
  );
}

/** Words that lead into an instruction without being one. */
const OPENERS = new Set([
  'please',
  'kindly',
  'first',
  'then',
  'also',
  'next',
  'finally',
  'now',
  'just',
  'simply',
  'always',
  'never',
]);

/** History, a changelog entry, a reported decision or a past state: not a rule that holds now. */
function describesThePast(text: string, terms: Term[]): boolean {
  const first = terms[0];
  if (
    has(first, 'PastTense') &&
    !has(first, 'Adjective', 'Noun') &&
    (has(terms[1], 'Determiner') || /^\W*\p{L}+\s*[:—–-]/u.test(text))
  )
    return true;
  const marker = MARKER.exec(text)?.index ?? firstSubordinate(terms, text);
  // "Explain what you changed": the past verb sits in a clause an instruction asks about.
  const imperativeFirst = has(first, 'Imperative') || (has(first, 'Verb') && has(first, 'Infinitive'));
  let offset = 0;
  for (let at = 0; at < terms.length; at++) {
    const term = terms[at] as Term;
    const found = text.indexOf(term.text, offset);
    if (found < 0) break;
    offset = found + term.text.length;
    if (found >= marker) break;
    if (at === 0) continue;
    const before = terms[at - 1] as Term;
    // "We decided ...", "Maria said ...", "The rule was ...": a subject and a past verb.
    // Only the main clause counts: a past verb late in the sentence is a relative clause ("the language the
    // user wrote in") or a negated auxiliary ("what you did not run").
    if (
      !imperativeFirst &&
      at <= 2 &&
      has(term, 'Verb') &&
      has(term, 'PastTense') &&
      !has(term, 'Passive', 'Participle', 'Adjective', 'Gerund') &&
      !has(terms[at + 1], 'Negative', 'Preposition', 'Modal') &&
      offset < marker &&
      has(before, 'Noun', 'Pronoun')
    )
      return true;
  }
  return false;
}

/** Where the main clause ends: the first subordinating word, or the end of the text. */
function firstSubordinate(terms: Term[], text: string): number {
  let offset = 0;
  for (const [at, term] of terms.entries()) {
    const found = text.indexOf(term.text, offset);
    if (found < 0) break;
    offset = found + term.text.length;
    if (
      at > 0 &&
      (SUBORDINATORS.has(term.text.toLowerCase()) || /^(?:that|which|who|whose)$/i.test(term.text))
    )
      return found;
  }
  return text.length;
}

/**
 * "Run tests." or "Use this.": a verb and one bare word say too little to be a rule of their own. An
 * adjective completes an instruction ("Be concise."), a noun or pronoun does not.
 */
function tooBare(terms: Term[]): boolean {
  let at = 0;
  while (
    has(terms[at], 'Adverb', 'Expression') ||
    /^(?:please|kindly|just|simply|also|then|first|next|finally|now)$/i.test(terms[at]?.text ?? '')
  )
    at++;
  const rest = terms.slice(at + 1);
  return rest.length === 1 && !has(rest[0], 'Adjective');
}

/**
 * "Read before any change": a bare verb whose only complement is a time phrase has lost its object, so it
 * cannot stand alone as a rule (its object is in the sentence it was cut from). A time clause with a verb
 * of its own ("Ask before you delete") is complete.
 */
function elidedObject(terms: Term[]): boolean {
  let at = 0;
  while (
    has(terms[at], 'Adverb', 'Expression') ||
    /^(?:please|kindly|just|simply|also|then|first|next|finally|now)$/i.test(terms[at]?.text ?? '')
  )
    at++;
  const rest = terms.slice(at + 1);
  const first = rest.find((term) => !has(term, 'Adverb'));
  return (
    !!first &&
    /^(?:before|after|during|until|prior)$/i.test(first.text) &&
    !rest.some((term, index) => index > 0 && has(term, 'Verb', 'Pronoun'))
  );
}

/** Mark a clause whose act has only a pronoun for an object: its referent is in an earlier sentence. */
function withPartial(rule: Rule, tail: string): Rule {
  // Only a pronoun can leave the object unresolved: no parse is needed without one.
  if (!/\b(?:it|them|this|that|these|those|one|ones)\b/i.test(tail)) return rule;
  const rest = termsOf(nlp(tail.replace(/[.!]+$/, ''))).slice(1);
  const unresolved =
    rest.length > 0 &&
    rest.some((term) => has(term, 'Pronoun')) &&
    rest.every((term) => has(term, ...FUNCTION_TAGS));
  return unresolved ? { ...rule, partial: true } : rule;
}
