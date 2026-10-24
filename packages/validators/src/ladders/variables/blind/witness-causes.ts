/**
 * The cause of each check of the paired witnesses (blind/witness.ts). An item that only a witness fails (the constant
 * empty implementation passes its own check) has the cause of the first witness check that fails it, so every such item
 * of a function shares one cause and counts once (docs/validators.md 12.4; r4 cause review). The strings live here, in a
 * module of no imports, because the witnesses (which import the kit) and the table of causes (which the kit imports)
 * both need them. One fix is one tag: where the bank already counts the fix a witness check states, the witness takes that
 * cause (the repeated value id, and the Wilson interval), and the bank counts it once.
 */
export const WITNESS_CAUSE = {
  validateDuplicateId: 'a value id repeated inside a variable is refused at the second place',
  validateNoAgent: 'validate refuses a store that has no agent',
  quotesAbsent: 'quotes reports a quote that the file it names does not hold',
  quotesUnreadable: 'quotes reports a quote whose file cannot be read',
  plan: 'plan holds every required pair of three binary axes in rows that avoid the impossible pair',
  coverage: 'coverage counts the allowed tuples of a group, and the ones the rows hold, exactly',
  weightInterval: 'weightInterval returns the Wilson score interval of the page',
  buildStore: 'buildStore builds one variable, with a value for each quote, from the values of a tool field',
} as const;
