// Whether the estate still holds a quote in force. A quote is held when a line carries it and no revocation
// stands in front of it: `estate mutate --invert` sets one of two fixed sentences before the whole quote, and the
// stand-in reads that sentence as the revocation of the rule.
const REVOKED = /(?:Do not follow this rule|This prohibition is lifted):\s*$/;

export const holds = (text, quote) =>
  text.split('\n').some((line) => line.includes(quote) && !REVOKED.test(line.slice(0, line.indexOf(quote))));
