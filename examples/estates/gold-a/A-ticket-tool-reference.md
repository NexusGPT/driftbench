---
name: ticket-tool-reference
description: Reference for the ticket tool that Pip reads and writes.
---

# Ticket tool reference

The ticket tool is the only record of what was promised to a customer. Everything in this file describes how it behaves.

## Calls

| Call | What it does | Notes |
|---|---|---|
| create_ticket | Opens a ticket for an account | Needs a queue and a summary |
| add_note | Adds a line to a ticket | Notes cannot be edited afterwards |
| set_priority | Marks a ticket normal or urgent | Urgent tickets sit at the top of the queue |
| find_ticket | Looks up tickets for an account | Returns the ten newest |
| close_ticket | Closes a ticket | Only the owning team may use it |

Use find_ticket when the customer mentions an earlier problem. Use create_ticket only when no open ticket covers the problem.

## Behaviour you should know

**The tool never retries a failed write.** If a call fails, the failure comes back at once and nothing is saved.

Ask again yourself, once, after a short pause. If it fails twice, tell the customer the ticket system is not answering. Give them the phone number from the duty sheet.

**Summaries are cut at 200 characters.** A longer summary is saved without its end. Put the important words first.

**Queues are fixed.** The four queues are billing, field, network and complaints. You cannot create a new queue.

## Fields

| Field | Type | Rule |
|---|---|---|
| queue | One of four | Required |
| summary | Text, 200 characters | Required |
| priority | normal or urgent | Defaults to normal |
| account | Account number | Required, copy it exactly |
| contact | Email or phone | Optional |

## Errors

| Error | Meaning | What to do |
|---|---|---|
| E10 | The account number does not exist | Ask the customer to check the number |
| E21 | The queue name is wrong | Use one of the four queues |
| E33 | The summary is empty | Write a summary and try again |
| E40 | The ticket is closed | Open a new ticket and mention the old number |

## Writing to the tool

Always search for an open ticket before you create one. A duplicate ticket splits the history in two.

Use the account number exactly as shown on the account page. A mistyped digit files the ticket on a stranger.

Never write a card number, a password or a full date of birth in a note. The tool stores notes in clear text.

Write notes in the past tense. The note Customer asked for a visit is better than the note Customer asks for a visit.

## Reading from the tool

A ticket has a status:

- Open: a team has not yet replied
- Waiting: the team replied and wants the customer to act
- Resolved: the team believes it is fixed
- Closed: nothing more will happen

A resolved ticket reopens by itself if the customer writes again within seven days. After that you must open a new one.

Read the last three notes before you answer a customer about an old ticket.

## Time

Times in the tool are in local time. Convert nothing.

Remember that the tool saves the time of the call and not the time of the event.

That is all you need.
