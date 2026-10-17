---
description: Reference for the sailing scheduler tool that Quill reads and the move tool writes.{{d}}
---

# Sailing scheduler reference{{n}}

Use the scheduler when you need the list of sailings for a day, or the free seats on one sailing.{{d}} Build a day view in one call by passing the date and no sailing id.{{d}}

The scheduler is the co-op's single source for departure times.{{d}} It is edited by the harbour office only.{{d}}

## Calls{{n}}

| Call{{n}} | What it returns{{n}} | Notes{{n}} |
|---|---|---|
| list_day{{n}} | Every sailing on a date{{d}} | The date must be inside the printed season{{d}} |
| seats_free{{n}} | Free seats on one sailing{{d}} | Returns zero for a cancelled sailing{{d}} |
| next_after{{n}} | The next sailing after a time{{d}} | Skips cancelled sailings{{d}} |
| tide_flag{{n}} | Whether the sailing is tide-limited{{d}} | Marrow sailings only{{d}} |

## Behaviour you should know{{n}}

**The scheduler never retries a failed read.**{{n}} If a call fails, the failure is returned at once and nothing is queued.{{d}} Ask again yourself, once, after a short pause.{{r}}

**Times are local.**{{n}} The scheduler stores no time zone, and the clocks go forward on the last Sunday of March.{{d}} On that morning, check the first sailing against the office clock.{{g}}

**Dates.**{{n}} Dates are written year, month, day, with dashes.{{d}} A date in another form returns an empty list, not an error, so write it exactly.{{r}}

The scheduler **does not** accept a range of dates; each day is a separate call.{{d}} It will not tell you that a sailing has been added since four in the morning.{{d}}

## Result shape{{n}}

Each sailing in a result carries an id, a departure time, a destination, a vessel name and a status.{{d}} The status is one of running, delayed, cancelled or paused.{{d}} Paused means the harbour master has stopped the boat and has not yet decided.{{d}}

- running → the boat sails as printed{{d}}
- delayed → read the delay, in minutes, from the note field{{r}}
- cancelled → say so first, then offer the next sailing{{r}}
- paused → tell the customer you do not know yet, and when the office will{{r}}

## Choosing between calls{{n}}

For "when is the next boat", prefer next_after over list_day.{{r}} It is cheaper, and it already skips cancelled boats, which saves you from offering a boat that does not run.{{d}}

For "is there room", call seats_free for the one sailing.{{r}} Reading the whole day to find one number wastes the customer's time.{{d}}

Only call tide_flag for the Skarra and Holm boats.{{r}} The other sailings are never tide-limited, so the flag would only say false.{{d}}

## Scoring a result for trust{{n}}

The office rates how fresh a result is, from 1 to 5, in the audit line.{{d}}

| Freshness{{n}} | Meaning{{n}} |
|---|---|
| **5** Read within a minute{{d}} | Safe to quote{{d}} |
| **3 to 4** Read within the hour{{d}} | Safe to quote, say "as of this hour"{{r}} |
| **1 to 2** Older than an hour{{d}} | Read again before you quote{{r}} |

The audit line is written by the tool, never by you.{{d}}

## Limits{{n}}

The scheduler answers about ten calls a minute for each session.{{d}} Above that it returns "slow down" and nothing else.{{d}} Pace your calls; a loop that reads every day of a month is the usual cause.{{r}}

A call that returns "slow down" should not be repeated at once.{{p}} Wait half a minute, then try once more.{{r}}

You may not call the scheduler from inside a refund hand-over.{{p}} The desk has its own copy of the sailing record, and it checks that copy, not yours.{{d}}

## Errors{{n}}

**NO_SUCH_SAILING.**{{n}} The id is wrong or the sailing has been removed.{{d}} Read the day list again and match by time.{{r}}

**OUT_OF_SEASON.**{{n}} The date is outside the printed season.{{d}} Tell the customer the timetable is not yet published, and give the office phone number.{{r}}

**READ_ONLY.**{{n}} You tried to write.{{d}} The scheduler accepts no writes from the booking assistant, so use the move tool for any change to a booking.{{r}}

**BAD_DATE.**{{n}} The date was in the wrong form.{{d}} Correct it and call again.{{r}}

## A worked day{{n}}

A customer wants to get to Brannock before noon on the first of June.{{d}} Call list_day with the date, filter by destination, and read the status of each sailing before you answer.{{r}}

Example: Brannock, 09:30, running, 14 seats; Brannock, 11:15, delayed by 20 minutes, 3 seats.{{e}}

On that day the 11:15 is the only one that gets the customer there before noon, and only just, so say that plainly.{{r}} Offer the 09:30 first, because it has room.{{r}}

## Order of use in a booking chat{{n}}

Read the day list first, the seat count second, and the tide flag last.{{g}} If the day list shows a cancelled sailing, stop there and say so.{{r}} Offering seats on a cancelled boat has happened twice, and both times the customer arrived at the quay.{{e}}

The seat count is exact for the moment it was read; it can change before the customer pays.{{d}} Do not describe a count as a guarantee.{{p}}

Further reading is in the harbour office binder.{{n}}
