---
description: Reference for the session booking tool that Tinker reads and the ticket tool writes.
---

# Session booking reference

Use the booking tool when you need the free slots of a session or the benches in use. Build a calendar view in one call by passing the month and no session date.

The booking tool is the café's only source for session dates. Only the trustees edit it.

## Calls

| Call | What it returns | Notes |
|---|---|---|
| list_month | Every session in a month | The month must be inside the printed year |
| slots_free | Free slots in one session | Returns zero for a cancelled session |
| next_session | The next session after a date | Skips cancelled sessions |
| bench_state | Which benches are in use | Mains benches only |

## Behaviour you should know

**The booking tool never retries a failed read.** If a call fails, the failure comes back at once and nothing is queued. Ask again yourself, once, after a short pause. If it fails twice, say that the calendar is not answering and give the café's phone number.

**Dates.** Dates are written year, month, day, with dashes. A date in another form returns an empty list and not an error, so write it exactly.

The tool **does not** accept a range of dates; each session is a separate call. It will not tell you that a session was added after four in the morning.

## Result shape

Each session in a result carries an id, a date, a start time, a number of slots and a status. The status is one of open, full, cancelled or held. Held means a trustee has paused the session and has not decided yet.

- open → the session runs as printed
- full → offer the next session and the waiting list
- cancelled → say so first, then offer the next session
- held → tell the visitor you do not know yet, and when the trustees will

## Choosing between calls

For the question when is the next session, prefer next_session to list_month. It costs less, and it already skips cancelled sessions, which saves you from offering one that does not run.

For the question is there room, call slots_free for the one session. Reading the whole month to find one number wastes the visitor's time.

Call bench_state only for mains tickets. The other tickets never need a mains bench, so the answer would only say false.

## Freshness of a result

The trustees rate how fresh a result is, from 1 to 5, in the audit line.

| Freshness | Meaning |
|---|---|
| **5** Read within a minute | Safe to quote |
| **3 to 4** Read within the hour | Safe to quote, say as of this hour |
| **1 to 2** Older than an hour | Read again before you quote |

The audit line is written by the tool and never by you.

## Limits

The booking tool answers about ten calls a minute for each session. Above that it returns slow down and nothing else. Pace your calls; a loop that reads every month of the year is the usual cause.

A call that returns slow down should not be repeated at once. Wait half a minute, then try once more.

You may not call the booking tool from inside a ticket. The ticket tool keeps its own copy of the calendar and checks that copy, not yours.

## Errors

**NO_SUCH_SESSION.** The id is wrong or the session has been removed. Read the month list again and match by date.

**OUT_OF_YEAR.** The date is outside the printed year. Tell the visitor the calendar is not yet published, and give the café's phone number.

**READ_ONLY.** You tried to write. The booking tool accepts no writes from the intake assistant, so use the ticket tool for any change to a ticket.

**BAD_DATE.** The date was in the wrong form. Correct it and call again.

## A worked month

A visitor wants a Saturday in October with a free mains bench. Call list_month with the month, keep the sessions with a free slot, and call bench_state for each before you answer.

Example: 5 October, open, 4 slots free, mains bench free; 19 October, full.

On that month the 5th is the only session that fits, and only just, so say that plainly. Offer the 5th first, and the waiting list for the 19th.

Further reading is in the trustees' binder.
