---
name: ticket-tool-reference{{n}}
description: Reference for the ticket tool that Pip reads and writes.{{d}}
---

# Ticket tool reference{{n}}

The ticket tool is the only record of what was promised to a customer.{{d}} Everything in this file describes how it behaves.{{d}}

## Calls{{n}}

| Call{{n}} | What it does{{n}} | Notes{{n}} |
|---|---|---|
| create_ticket{{d}} | Opens a ticket for an account{{d}} | Needs a queue and a summary{{d}} |
| add_note{{d}} | Adds a line to a ticket{{d}} | Notes cannot be edited afterwards{{d}} |
| set_priority{{d}} | Marks a ticket normal or urgent{{d}} | Urgent tickets sit at the top of the queue{{d}} |
| find_ticket{{d}} | Looks up tickets for an account{{d}} | Returns the ten newest{{d}} |
| close_ticket{{d}} | Closes a ticket{{d}} | Only the owning team may use it{{d}} |

Use find_ticket when the customer mentions an earlier problem.{{d}} Use create_ticket only when no open ticket covers the problem.{{d}}

## Behaviour you should know{{n}}

**The tool never retries a failed write.**{{d}} If a call fails, the failure comes back at once and nothing is saved.{{d}}

Ask again yourself, once, after a short pause.{{r}} If it fails twice, tell the customer the ticket system is not answering.{{r}} Give them the phone number from the duty sheet.{{r}}

**Summaries are cut at 200 characters.**{{d}} A longer summary is saved without its end.{{d}} Put the important words first.{{r}}

**Queues are fixed.**{{d}} The four queues are billing, field, network and complaints.{{d}} You cannot create a new queue.{{d}}

## Fields{{n}}

| Field{{n}} | Type{{n}} | Rule{{n}} |
|---|---|---|
| queue{{d}} | One of four{{d}} | Required{{d}} |
| summary{{d}} | Text, 200 characters{{d}} | Required{{d}} |
| priority{{d}} | normal or urgent{{d}} | Defaults to normal{{d}} |
| account{{d}} | Account number{{d}} | Required, copy it exactly{{d}} |
| contact{{d}} | Email or phone{{d}} | Optional{{d}} |

## Errors{{n}}

| Error{{n}} | Meaning{{n}} | What to do{{n}} |
|---|---|---|
| E10{{d}} | The account number does not exist{{d}} | Ask the customer to check the number{{r}} |
| E21{{d}} | The queue name is wrong{{d}} | Use one of the four queues{{r}} |
| E33{{d}} | The summary is empty{{d}} | Write a summary and try again{{r}} |
| E40{{d}} | The ticket is closed{{d}} | Open a new ticket and mention the old number{{r}} |

## Writing to the tool{{n}}

Always search for an open ticket before you create one.{{g}} A duplicate ticket splits the history in two.{{d}}

Use the account number exactly as shown on the account page.{{r}} A mistyped digit files the ticket on a stranger.{{d}}

Never write a card number, a password or a full date of birth in a note.{{p}} The tool stores notes in clear text.{{d}}

Write notes in the past tense.{{r}} The note Customer asked for a visit is better than the note Customer asks for a visit.{{d}}

## Reading from the tool{{n}}

A ticket has a status:{{d}}

- Open: a team has not yet replied{{d}}
- Waiting: the team replied and wants the customer to act{{d}}
- Resolved: the team believes it is fixed{{d}}
- Closed: nothing more will happen{{d}}

A resolved ticket reopens by itself if the customer writes again within seven days.{{d}} After that you must open a new one.{{r}}

Read the last three notes before you answer a customer about an old ticket.{{g}}

## Time{{n}}

Times in the tool are in local time.{{d}} Convert nothing.{{p}}

Remember that the tool saves the time of the call and not the time of the event.{{d}}

That is all you need.{{n}}
