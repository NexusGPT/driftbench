/**
 * The cause of each check of the paired witnesses (blind/witness.ts). An item that only a witness fails (the constant
 * empty implementation passes its own check) has the cause of the first witness check that fails it, so every such item
 * of a function shares one cause and counts once (docs/validators.md 12.4; r4 cause review). The strings live here, in a
 * module of no imports, because the witnesses (which import the kit) and the table of causes (which the kit imports)
 * both need them.
 */
export const WITNESS_CAUSE = {
  validateDuplicateId:
    'validate refuses a store in which two values of one variable share an id, at the second value',
  validateNoAgent: 'validate refuses a store that has no agent',
  quotesAbsent: 'quotes reports a quote that the file it names does not hold',
  quotesUnreadable: 'quotes reports a quote whose file cannot be read',
  plan: 'plan holds every required pair of three binary axes in rows that avoid the impossible pair',
  coverage: 'coverage counts the allowed tuples of a group, and the ones the rows hold, exactly',
  weightInterval: 'weightInterval returns the Wilson score interval of a count and a total',
  buildStore: 'buildStore builds one variable, with a value for each quote, from the values of a tool field',
} as const;
