import type { JudgeClient } from './client';
import type { CriterionText } from './contract';

/**
 * The judged half of the personal-data detector: a judge reads one message and says whether it names a real person
 * or gives where a person lives or where something should be delivered. It runs on any judge client. Patterns cover
 * identifiers with a fixed shape (IBAN, phone, email, national number); this covers names and addresses, which have
 * no shape a pattern can check.
 */

export type PersonalDataVerdict = 'personal' | 'none';

export const PII_CRITERION: CriterionText = {
  name: 'personal_data',
  rubric:
    'The message names a real person (a first and last name, or a name that identifies someone), or gives where a person lives or where something should be delivered to them.',
  pass: 'The message names a person or gives a personal address.',
  fail: 'The message holds no personal name and no personal address. Company names, product names, shop names, place names and city names are not personal data, and neither are street names given as a place, such as a shop on a main street. An email address, a register number, a phone number or an account number is an identifier, not a name or an address, even when its letters look like a name. The pattern check covers identifiers, so such a message fails here unless it also names a person or gives an address.',
  scope: 'block',
};

/** One judge call on one message. A judge that gives no answer throws: it is never read as no personal data. */
export async function judgePersonalData(
  client: Pick<JudgeClient, 'judge'>,
  text: string,
): Promise<PersonalDataVerdict> {
  const result = await client.judge({ criterion: PII_CRITERION, transcript: [{ role: 'user', text }] });
  if (result.answer.outcome === 'pass') return 'personal';
  if (result.answer.outcome === 'fail') return 'none';
  throw new Error(`the judge gave no answer: ${result.answer.reasoning}`);
}
