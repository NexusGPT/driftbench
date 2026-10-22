import { type SpanMeaning, setSpanSink } from '../../src/ladders/variables/blind/spans';

/** The table of span meanings the test reference reads. It lives on the test side; the bank has no such table. */
const declared = new Map<string, SpanMeaning>();
setSpanSink((text, meaning) => {
  declared.set(text, meaning);
});

/** The meaning declared for a span, by its exact text. */
export function meaningOf(text: string): SpanMeaning | undefined {
  return declared.get(text);
}
