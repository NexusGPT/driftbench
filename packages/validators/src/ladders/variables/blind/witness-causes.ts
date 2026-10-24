/**
 * The cause of each check of the paired witnesses (blind/witness.ts). An item that only a witness fails (the constant
 * empty implementation passes its own check) has the cause of the first witness check that fails it, so every such item
 * of a function shares one cause and counts once (docs/validators.md 12.4; r4 cause review). The strings live here, in a
 * module of no imports, because the witnesses (which import the kit) and the table of causes (which the kit imports)
 * both need them. One fix is one tag: each witness check states a fix that an item of the bank already asks for with a check of its
 * own, on the same calls, so the witness takes that item's cause and the bank counts the fix once. The pairing, check by
 * check, is the table CANONICAL of test/variables-blind/witness-causes.test.ts.
 */
export const WITNESS_CAUSE = {
  validateDuplicateId: 'a value id repeated inside a variable is refused at the second place',
  validateNoAgent: 'a store without an agent is refused',
  quotesAbsent: 'the quote check reports a quote missing from its file at the quote path',
  quotesUnreadable: 'the quote check reports an unreadable file at the path of the entry',
  plan: 'many forbidden pairs are kept out of the rows and every allowed tuple is still covered',
  coverage: 'coverage counts the distinct allowed pairs and the pairs the rows hold',
  weightInterval: 'weightInterval returns the Wilson score interval of the page',
  buildStore: 'tool evidence input fields become variables with one value per listed value',
} as const;
