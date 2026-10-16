import nlp from 'compromise/two';

/**
 * Clause-level grammar the gate reader shares: what may stand after "before" as the thing a read comes
 * ahead of, how a list of reads is coordinated, which adverbs only add emphasis, and which lead-ins make
 * a sentence an example or a history entry instead of a directive. Nothing here names a file, an estate or
 * a verb of a particular tool; the decisions come from the part of speech of the words and from the
 * clause's own structure.
 */

export const OPEN_TOKEN = '';
export const CLOSE_TOKEN = '';
/** One masked inline span: a code span, a link, a quotation. */
export const TOKEN = String.raw`\d+`;
/** A thing to read in a list: a masked span, a path with a folder, or a word with a file extension. */
const ITEM = String.raw`(?:${TOKEN}|[^\s,;()]*[/\\][^\s,;()]*|[^\s,;()]*\.[A-Za-z0-9]+)`;
/** Coordination of two reads: a comma, "and", "plus", "as well as", "together with". */
const ADD = String.raw`(?:\s*,\s*(?:(?:and|plus)\s+)?|\s+(?:and|plus|&)\s+|\s+(?:together|along)\s+with\s+|\s+as\s+well\s+as\s+)`;
const LIST = new RegExp(
  String.raw`\b(read(?:ing)?)\s+((?:both\s+|all\s+of\s+)?)(${ITEM})((?:${ADD}${ITEM})+)`,
  'gi',
);
const ITEMS = new RegExp(ITEM, 'g');

/** Determiners that quantify over events: "any query", "each deploy", "every commit". */
const QUANTIFIERS = new Set(['any', 'each', 'every', 'all', 'another', 'either']);
/** Words that place an event in a sequence without a number: "the next commit", "the last step". */
const SEQUENCE = new Set(['next', 'last', 'final', 'following', 'subsequent', 'previous', 'initial']);

const tagged = new Map<string, Set<string>>();
export function tagsOf(word: string): Set<string> {
  const held = tagged.get(word);
  if (held) return held;
  const tags = new Set<string>(nlp(word).json()[0]?.terms?.[0]?.tags ?? []);
  tagged.set(word, tags);
  return tags;
}

function wordsOf(phrase: string): string[] {
  return phrase
    .replace(/[`*"“”]/g, '')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** "anything", "everything": a pronoun that quantifies over whatever the agent does next. */
const QUANTIFYING_PRONOUN = /^(?:any|every)thing$/;

/** The words of an event noun phrase after its quantifier, possessive or ordinal. */
export function eventHead(phrase: string): string | undefined {
  const words = wordsOf(phrase);
  const bare = (word: string | undefined) => (word ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const ordinal = (word: string | undefined) => {
    const key = bare(word);
    return key !== '' && (SEQUENCE.has(key) || tagsOf(key).has('Ordinal'));
  };
  // A pronoun that quantifies stands anywhere in the clause: "before you do anything".
  const pronoun = words.findIndex((word) => QUANTIFYING_PRONOUN.test(bare(word)));
  if (pronoun >= 0) return words.slice(pronoun).join(' ');
  const first = bare(words[0]);
  let at: number;
  if (QUANTIFIERS.has(first)) at = 1;
  else {
    // Determiners, possessives ("your", "the agent's") and adverbs ("very") may stand before the ordinal.
    let index = 0;
    while (index < words.length - 1 && !ordinal(words[index])) {
      const key = bare(words[index]);
      const tags = tagsOf(key);
      const possessive = /['\u2019]s$/.test(words[index] ?? '') || tags.has('Possessive');
      if (!(tags.has('Determiner') || possessive || tags.has('Adverb'))) return undefined;
      index++;
    }
    if (!ordinal(words[index])) return undefined;
    at = index + 1;
  }
  const rest = words.slice(at);
  if (rest.length === 0) return undefined;
  // A calendar span is a time, not an event the agent performs: "each day", "the first year".
  const time = (word: string) => {
    const tags = tagsOf(bare(word));
    return tags.has('Date') || tags.has('Duration');
  };
  if (rest.every(time)) return undefined;
  return rest.join(' ');
}

/**
 * An event a read can come before: a noun phrase or clause led by a quantifier ("any query", "each
 * deploy") or by an ordinal or sequence word ("the second query", "your first action", "the next commit").
 * A time, a calendar span, a demonstrative reference ("that change") or a bare noun is no event.
 */
export function isEvent(phrase: string): boolean {
  return eventHead(phrase) !== undefined;
}

/** Whether a word only emphasises the verb or its object: an adverb such as "fully" or "completely". */
function emphasis(word: string): boolean {
  const bare = word.replace(/[^\p{L}]/gu, '');
  if (bare === '' || bare.toLowerCase() === 'then') return false;
  return tagsOf(bare.toLowerCase()).has('Adverb');
}

/**
 * Adverbs that sit right after "read" or right after the thing read only stress it ("Read `a.md` FULLY
 * before editing", "Read FULLY `a.md`"); they are taken out so the clause forms see the same shape with
 * and without them.
 */
export function withoutEmphasis(clause: string): string {
  const parts = clause.split(/(\s+)/);
  const out: string[] = [];
  let previous = '';
  for (const part of parts) {
    if (/^\s*$/.test(part)) {
      out.push(part);
      continue;
    }
    const after = /^read(?:ing)?$/i.test(previous) || new RegExp(`^${ITEM}[.,;:!?)]*$`).test(previous);
    if (after && emphasis(part)) {
      // Drop the adverb and the space that preceded it.
      if (/^\s+$/.test(out.at(-1) ?? '')) out.pop();
      continue;
    }
    out.push(part);
    previous = part;
  }
  return out.join('');
}

/** The parts of a coordinated list of reads: "`a.md`, `b.md` and `c.md`". */
export function listItems(text: string): string[] {
  return [...text.matchAll(ITEMS)].map((item) => item[0]);
}

/**
 * A coordinated list after the verb "read" is cut down to its first item, and the other items are
 * returned apart: every item takes part in the same ordering as the first. A list of acts is no list of
 * reads ("read `a.md` and edit it"): only things shaped like a file or a masked span are items.
 */
export function collapseReads(clause: string): { clause: string; extra: string[] } {
  const extra: string[] = [];
  const text = clause.replace(
    LIST,
    (_whole, verb: string, _quantity: string, first: string, rest: string) => {
      extra.push(...listItems(rest));
      return `${verb} ${first}`;
    },
  );
  return { clause: text, extra };
}

const ADDITIVE = new RegExp(
  String.raw`^(?:(?:and|plus|also|&)\s+)*(?:(?:(?:along|together)\s+with|as\s+well\s+as|with)\s+)?(?:(?:it|them|this|that|these|those)\s+)?((?:${ITEM})(?:${ADD}${ITEM})*)$`,
  'i',
);

/**
 * A clause that only adds more things to read to the sentence before it: "and with it `more.md`",
 * "plus `more.md`". It has no verb and no act of its own, so it inherits both from that sentence.
 */
export function continuation(clause: string): string[] | undefined {
  const trimmed = clause.replace(/[.!]+$/, '').trim();
  // The words in front of the first item must be connectives, and there must be at least one.
  const match = ADDITIVE.exec(trimmed);
  if (!match) return undefined;
  const lead = trimmed.slice(0, trimmed.length - (match[1] ?? '').length).trim();
  if (lead === '') return undefined;
  return listItems(match[1] ?? '');
}

const ADDED = new RegExp(
  String.raw`^(.*?\S)\s*,\s*((?:plus|(?:together|along)\s+with|as\s+well\s+as)\s+(?:${ITEM})(?:${ADD}${ITEM})*)$`,
  'i',
);

/**
 * A sentence that ends in a coordinated addition after a comma ("..., along with `b.md`") is cut there:
 * the tail adds reads to the gate before it and must not become part of the act the reads come before.
 */
export function splitAddition(clause: string): string[] {
  const match = ADDED.exec(clause.trim());
  return match ? [match[1] ?? '', match[2] ?? ''] : [clause];
}

/**
 * Whether the words right before "before" measure an offset in time ("The day", "Two hours"): the clause
 * then places something in time ahead of an event, which is no order between two acts.
 */
export function timeOffset(head: string): boolean {
  const last = head
    .trim()
    .split(/\s+/)
    .at(-1)
    ?.toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
  if (!last) return false;
  const tags = tagsOf(last);
  return tags.has('Date') || tags.has('Duration');
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
/** An example lead-in: the sentence shows how text reads or what a rule might look like. */
const EXAMPLE_LEAD = /\b(?:for\s+(?:example|instance)|e\.g|i\.e|such\s+as|example|sample|illustration)\b/i;
/** A history lead-in: the sentence records what the estate once did or what changed. */
const HISTORY_LEAD = /\b(?:previously|formerly|used\s+to|no\s+longer|originally|historically)\b/i;

/**
 * Whether the words in front of a gate describe an example or a history entry instead of directing the
 * agent: a lead-in naming an example, a date, or a past-tense verb in the main clause. A leading condition
 * ("If a fix is asked for,") is not the main clause and may hold a past participle.
 */
export function exampleOrHistory(head: string): boolean {
  const text = head.replace(/[*_]/g, '').trim();
  if (text === '') return false;
  if (EXAMPLE_LEAD.test(text) || HISTORY_LEAD.test(text) || ISO_DATE.test(text)) return true;
  return text
    .split(/[,:]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
    .some(
      (segment) =>
        !/^(?:if|when|whenever|unless|once|after|while|because|since|although|though|whether)\b/i.test(
          segment,
        ) && nlp(segment).has('#PastTense'),
    );
}

/** A date inside the act ("before any query (added 2026-09-12)") makes the sentence a record. */
export function dated(text: string): boolean {
  return ISO_DATE.test(text);
}
