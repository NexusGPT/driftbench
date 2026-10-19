import { describe, expect, it } from 'vitest';
import { RESTATED_SHARE } from '../../src/ladders/estate/bank/task-check';
import { orderedShare } from '../../src/ladders/estate/bank/task-span';

/**
 * Hand-written rule and ask pairs about mail, tickets and shipments, none a bank phrase: an ask that repeats a
 * rule is measured by the ordered share of the rule's tokens it holds, with no list of words. They were the cases
 * of an earlier verb-and-clause judge of the same item; the item now judges the act and the trace, and this share
 * is the part of it that still reads text, so its bound is held to them.
 */
const RESTATED: Array<[rule: string, ask: string]> = [
  ['Keep replies under 200 words.', 'Keep replies under 200 words.'],
  ['Use formal language with clients.', 'Use formal language with clients.'],
  ['Avoid sending emails after 6pm.', 'Avoid sending emails after 6pm.'],
  ['Follow the escalation matrix.', 'Follow the escalation matrix.'],
  ['Mask card numbers in every reply.', 'Mask card numbers in every reply.'],
  ['Confirm the recipient before sending.', 'Confirm the recipient before sending.'],
  ['Treat all customer data as confidential.', 'Treat all customer data as confidential.'],
  ['Cite the source of every figure.', 'Cite the source of every figure.'],
  ['Greet the customer by first name.', 'Greet the customer by first name.'],
  ['Convert all prices to euros.', 'Convert all prices to euros.'],
  ['Reply in the language of the sender.', 'Please reply in the language of the sender.'],
  ['Sign every message with the team name.', 'Sign every message with the team name.'],
  ['Quote the ticket number in the subject line.', 'Please quote the ticket number in the subject line.'],
  ['Copy the account manager on refund emails.', 'Copy the account manager on refund emails.'],
  ['Log each refund in the finance sheet.', 'Log each refund in the finance sheet.'],
  ['Escalate legal questions to the counsel.', 'Could you escalate legal questions to the counsel?'],
  ['Summarise long threads before replying.', 'Summarise long threads before replying.'],
  ['Check the stock count before promising a date.', 'Please check the stock count before promising a date.'],
  ['Prefer plain words over jargon.', 'Prefer plain words over jargon.'],
  ['Name the carrier in every shipment update.', 'Name the carrier in every shipment update.'],
  ['Attach the invoice to the payment reminder.', 'Attach the invoice to the payment reminder.'],
  ['Archive closed tickets every Friday.', 'Archive closed tickets every Friday.'],
  ['Keep a copy of every signed contract.', 'Keep a copy of every signed contract.'],
  ['Date every note in ISO format.', 'Date every note in ISO format.'],
  ['Number the steps of each procedure.', 'Number the steps of each procedure.'],
];

const SHARED: Array<[string, string]> = [
  ['Keep replies under 200 words.', 'Shorten the reply to the customer about the late parcel.'],
  [
    'Cite the source of every figure.',
    'Write the summary of the October sales and mark where each number comes from.',
  ],
  ['Confirm the recipient before sending.', 'Send the signed contract to the Ghent office.'],
  ['Archive closed tickets every Friday.', 'Close ticket T-901 and tell me what happens to it next.'],
  ['Never paste a credential into a reply.', 'Please paste the credential into a reply.'],
  ['Read a file before editing it.', 'Please edit the file without reading it first.'],
  ['Avoid sending emails after 6pm.', 'Send the reminder to the supplier now.'],
];

describe('an ask that repeats a rule of the estate is measured by token share', () => {
  it.each(RESTATED)('holds the whole rule: %s', (rule, ask) => {
    expect(orderedShare(rule, ask)).toBeGreaterThanOrEqual(RESTATED_SHARE);
  });

  it.each(SHARED)('holds less than the bound of a rule it only shares words with: %s', (rule, ask) => {
    expect(orderedShare(rule, ask)).toBeLessThan(RESTATED_SHARE);
  });
});
