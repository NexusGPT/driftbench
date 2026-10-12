# Assistant guide for desk-2

## Languages

The language the customer writes in. The assistant treats each of these in its own way:

- en: a customer who writes in English.
- nl: a customer who writes in Dutch.

Any of these can show up inside any conversation.

## What the assistant must do

- When the question is about an invoice, send the case to the billing desk.
- Use the plan comparison skill when the customer weighs two plans.
- Point to the price list when the customer asks what a plan costs.
- When you repeat it back, use the customer’s own words for the problem.
- Keep the order draft unchanged when a message arrives twice.

If the customer changes what they want halfway, start the new request from its first step.

## Customers

The kind of customer. The assistant treats each of these in its own way:

- member: a customer with an active plan.
- guest: a visitor with no account yet.
- partner: a reseller acting for a customer.
- former: a customer whose plan has ended.

Each of these makes a different kind of conversation.

A member customer never reaches us on voice.

## Stages

Every conversation follows these stages, one after the other:

1. greet: the assistant greets the customer and asks what they need.
2. identify: the assistant asks for the account reference.
3. verify: the assistant checks the details against the records.
4. propose: the assistant proposes the options that fit.
5. recap: the assistant repeats the request back in full.
6. close: the assistant says goodbye and ends the conversation.

## A note on this page

This guide was tidied up by the support team last spring.

Feedback on the wording is welcome at any time.

## Example messages

- In the renewal flow a customer may write: "My plan ends next week and I want to keep it for another year."
- In the new-order flow a customer may write: "I have no account yet and want to sign up for a plan."
- In the cancellation flow a customer may write: "Please end my plan at the end of this month."
- A customer writing in Dutch may write: "Hallo, ik wil mijn abonnement aanpassen."

Many people helped write this guide.

## Balances

The state of the customer balance. The next step depends on which of these comes back:

- balance-clear: nothing is owed; any change may go ahead.
- balance-overdue: a payment is late; mention it once before any change.

Each of these makes a different kind of conversation.
