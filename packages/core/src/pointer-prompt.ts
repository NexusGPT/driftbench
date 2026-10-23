/**
 * The fixed sentences of the dense request of the pointer reader's system 2 labeler, in one module with no import.
 * The reader builds its request from them, and the validators' kit writes the request it expects from the same
 * sentences, so the two cannot drift apart. The sentences name no domain: every word of a domain comes from the set.
 */

export const DENSE_SYSTEM =
  'You label numbered units of a document. For each unit give exactly one label from the list, or none. ' +
  'Answer with JSON only, no other text: {"labels": [{"units": "<n> or <a>-<b>", "label": "<name>"}]}. ' +
  'Every entry, none included, also gives "anchor": the first three words of the first unit it names, copied from its start, and a range also gives "anchorEnd": the first three words of its last unit, so code can check the entry is on the units you mean. ' +
  'Every unit must appear once. Units labelled none still appear, joined in ranges. A range joins neighbouring units that share a label, and may cross a line marked not labelable: only the units in it take the label. ' +
  'A line marked not labelable takes no label, not even none: leave its number out of the answer. ' +
  'For a label that asks for a target, add "target": the number of the unit that holds the other end. ' +
  'A target must be a unit that can be labelled, never a line marked not labelable. ' +
  'Never copy text from the units, except the anchors and the words of a span.';

/** Added to the system text only for a set that declares spans or links, so other sets keep their requests. */
export const SPAN_RULE =
  'A label that lists span kinds may carry "spans": [{"kind", "text", "polarity"?}] on an entry that names ONE unit: ' +
  'text is the clause copied word for word from that unit, as short as it can be and found once in the unit. ' +
  'Code locates it and refuses a text that is not in the unit. Leave "spans" out when the unit has none. A label that lists link kinds may carry "links": [{"kind", "to"}] where to is an id listed under that kind, or none.';

/** Added to the system text only for a set with a label that asks for a target, so other sets keep their requests. */
export const TARGET_RULE = 'A label that asks for a target always names one.';

/** The part of a label set the system text depends on. */
export type DenseSystemSet = {
  spans?: unknown;
  links?: unknown;
  labels: ReadonlyArray<{ target?: unknown }>;
};

/** The system text of the dense request for a set: the fixed text, then the span rule, then the target rule. */
export function denseSystemFor(set: DenseSystemSet): string {
  return [
    DENSE_SYSTEM,
    ...(set.spans || set.links ? [SPAN_RULE] : []),
    ...(set.labels.some((label) => label.target === 'required') ? [TARGET_RULE] : []),
  ].join(' ');
}
