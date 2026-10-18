import type { CriterionText } from './contract';

/**
 * Semantic retention of user facts, independent of factual grounding or required literal use.
 * The catalogue YAML carries the same definition; its parity test prevents the two from drifting.
 * Use the ordinary evidence-ledger judge contract to compute the outcome from this requirement.
 */
export const KNOWLEDGE_RETENTION_CRITERION: CriterionText = {
  name: 'knowledge_retention',
  rubric: [
    'The last assistant reply neither re-asks a fact the user already supplied nor contradicts a current user fact.',
    'Use the earlier conversation and supplied ledger as context for that reply.',
    'Evaluate all assistant text segments after the latest user message as one reply.',
    'A single user message followed by a reply is sufficient; judge the observed reply, not hypothetical future behavior.',
    'Identify each current fact by its owner and attribute. Explicit corrections replace earlier values, including stale ledger entries.',
    'Preserve quantities, units, currencies, negation and contact restrictions; equivalent paraphrases are allowed.',
    'Compare values for the same owner and attribute. Different people or explicitly different purposes may have different values.',
    'Do not invent an alternate owner or purpose to excuse a repeated request or a conflicting value.',
    'Unmentioned facts need not be repeated or otherwise used. New information may be requested.',
    'Confirming a supplied value is allowed; asking the user to supply that known value again is a re-ask.',
    'Do not require independent source proof for other claims: this criterion tests retention, not factual grounding.',
    'Any observed re-ask or contradiction violates the criterion, even if the rest of the reply is correct.',
  ].join(' '),
  pass: 'The last reply keeps current user facts intact. It may use or acknowledge only some facts, leave others unmentioned, or request information not yet supplied.',
  fail: 'The last reply requests an already supplied fact again, uses an obsolete corrected value as current, assigns a conflicting value to the same owner and attribute, or violates a supplied restriction.',
  scope: 'conversation',
};
