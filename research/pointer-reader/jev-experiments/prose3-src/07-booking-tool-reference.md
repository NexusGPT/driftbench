---
description: Reference for the session booking tool that Tinker reads and the ticket tool writes.{{d}}
---

# Session booking reference{{n}}

Use the booking tool when you need the free slots of a session or the benches in use.{{d}} Build a calendar view in one call by passing the month and no session date.{{d}}

The booking tool is the café's only source for session dates.{{d}} Only the trustees edit it.{{d}}

## Calls{{n}}

| Call{{n}} | What it returns{{n}} | Notes{{n}} |
|---|---|---|
| list_month{{d}} | Every session in a month{{d}} | The month must be inside the printed year{{d}} |
| slots_free{{d}} | Free slots in one session{{d}} | Returns zero for a cancelled session{{d}} |
| next_session{{d}} | The next session after a date{{d}} | Skips cancelled sessions{{d}} |
| bench_state{{d}} | Which benches are in use{{d}} | Mains benches only{{d}} |

## Behaviour you should know{{n}}

**The booking tool never retries a failed read.**{{n}} If a call fails, the failure comes back at once and nothing is queued.{{d}} Ask again yourself, once, after a short pause.{{r#a}} If it fails twice, say that the calendar is not answering and give the café's phone number.{{r#a}}

**Dates.**{{n}} Dates are written year, month, day, with dashes.{{d}} A date in another form returns an empty list and not an error, so write it exactly.{{r}}

The tool **does not** accept a range of dates; each session is a separate call.{{d}} It will not tell you that a session was added after four in the morning.{{d}}

## Result shape{{n}}

Each session in a result carries an id, a date, a start time, a number of slots and a status.{{d}} The status is one of open, full, cancelled or held.{{d}} Held means a trustee has paused the session and has not decided yet.{{d}}

- open → the session runs as printed{{d}}
- full → offer the next session and the waiting list{{r}}
- cancelled → say so first, then offer the next session{{g}}
- held → tell the visitor you do not know yet, and when the trustees will{{r}}

## Choosing between calls{{n}}

For the question when is the next session, prefer next_session to list_month.{{r}} It costs less, and it already skips cancelled sessions, which saves you from offering one that does not run.{{d}}

For the question is there room, call slots_free for the one session.{{r}} Reading the whole month to find one number wastes the visitor's time.{{d}}

Call bench_state only for mains tickets.{{r}} The other tickets never need a mains bench, so the answer would only say false.{{d}}

## Freshness of a result{{n}}

The trustees rate how fresh a result is, from 1 to 5, in the audit line.{{d}}

| Freshness{{n}} | Meaning{{n}} |
|---|---|
| **5** Read within a minute{{d}} | Safe to quote{{d}} |
| **3 to 4** Read within the hour{{d}} | Safe to quote, say as of this hour{{r}} |
| **1 to 2** Older than an hour{{d}} | Read again before you quote{{g}} |

The audit line is written by the tool and never by you.{{d}}

## Limits{{n}}

The booking tool answers about ten calls a minute for each session.{{d}} Above that it returns slow down and nothing else.{{d}} Pace your calls; a loop that reads every month of the year is the usual cause.{{r}}

A call that returns slow down should not be repeated at once.{{p#c}} Wait half a minute, then try once more.{{p#c}}

You may not call the booking tool from inside a ticket.{{p}} The ticket tool keeps its own copy of the calendar and checks that copy, not yours.{{d}}

## Errors{{n}}

**NO_SUCH_SESSION.**{{n}} The id is wrong or the session has been removed.{{d}} Read the month list again and match by date.{{r}}

**OUT_OF_YEAR.**{{n}} The date is outside the printed year.{{d}} Tell the visitor the calendar is not yet published, and give the café's phone number.{{r}}

**READ_ONLY.**{{n}} You tried to write.{{d}} The booking tool accepts no writes from the intake assistant, so use the ticket tool for any change to a ticket.{{r}}

**BAD_DATE.**{{n}} The date was in the wrong form.{{d}} Correct it and call again.{{r}}

## A worked month{{n}}

A visitor wants a Saturday in October with a free mains bench.{{d}} Call list_month with the month, keep the sessions with a free slot, and call bench_state for each before you answer.{{g}}

Example: 5 October, open, 4 slots free, mains bench free; 19 October, full.{{e}}

On that month the 5th is the only session that fits, and only just, so say that plainly.{{r}} Offer the 5th first, and the waiting list for the 19th.{{r}}

Further reading is in the trustees' binder.{{n}}
