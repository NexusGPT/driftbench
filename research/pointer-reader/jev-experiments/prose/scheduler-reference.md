---
description: Reference for the sailing scheduler tool that Quill reads and the move tool writes.
---

# Sailing scheduler reference

Use the scheduler when you need the list of sailings for a day, or the free seats on one sailing. Build a day view in one call by passing the date and no sailing id.

The scheduler is the co-op's single source for departure times. It is edited by the harbour office only.

## Calls

| Call | What it returns | Notes |
|---|---|---|
| list_day | Every sailing on a date | The date must be inside the printed season |
| seats_free | Free seats on one sailing | Returns zero for a cancelled sailing |
| next_after | The next sailing after a time | Skips cancelled sailings |
| tide_flag | Whether the sailing is tide-limited | Marrow sailings only |

## Behaviour you should know

**The scheduler never retries a failed read.** If a call fails, the failure is returned at once and nothing is queued. Ask again yourself, once, after a short pause.

**Times are local.** The scheduler stores no time zone, and the clocks go forward on the last Sunday of March. On that morning, check the first sailing against the office clock.

**Dates.** Dates are written year, month, day, with dashes. A date in another form returns an empty list, not an error, so write it exactly.

The scheduler **does not** accept a range of dates; each day is a separate call. It will not tell you that a sailing has been added since four in the morning.

## Result shape

Each sailing in a result carries an id, a departure time, a destination, a vessel name and a status. The status is one of running, delayed, cancelled or paused. Paused means the harbour master has stopped the boat and has not yet decided.

- running → the boat sails as printed
- delayed → read the delay, in minutes, from the note field
- cancelled → say so first, then offer the next sailing
- paused → tell the customer you do not know yet, and when the office will

## Choosing between calls

For "when is the next boat", prefer next_after over list_day. It is cheaper, and it already skips cancelled boats, which saves you from offering a boat that does not run.

For "is there room", call seats_free for the one sailing. Reading the whole day to find one number wastes the customer's time.

Only call tide_flag for the Skarra and Holm boats. The other sailings are never tide-limited, so the flag would only say false.

## Scoring a result for trust

The office rates how fresh a result is, from 1 to 5, in the audit line.

| Freshness | Meaning |
|---|---|
| **5** Read within a minute | Safe to quote |
| **3 to 4** Read within the hour | Safe to quote, say "as of this hour" |
| **1 to 2** Older than an hour | Read again before you quote |

The audit line is written by the tool, never by you.

## Limits

The scheduler answers about ten calls a minute for each session. Above that it returns "slow down" and nothing else. Pace your calls; a loop that reads every day of a month is the usual cause.

A call that returns "slow down" should not be repeated at once. Wait half a minute, then try once more.

You may not call the scheduler from inside a refund hand-over. The desk has its own copy of the sailing record, and it checks that copy, not yours.

## Errors

**NO_SUCH_SAILING.** The id is wrong or the sailing has been removed. Read the day list again and match by time.

**OUT_OF_SEASON.** The date is outside the printed season. Tell the customer the timetable is not yet published, and give the office phone number.

**READ_ONLY.** You tried to write. The scheduler accepts no writes from the booking assistant, so use the move tool for any change to a booking.

**BAD_DATE.** The date was in the wrong form. Correct it and call again.

## A worked day

A customer wants to get to Brannock before noon on the first of June. Call list_day with the date, filter by destination, and read the status of each sailing before you answer.

Example: Brannock, 09:30, running, 14 seats; Brannock, 11:15, delayed by 20 minutes, 3 seats.

On that day the 11:15 is the only one that gets the customer there before noon, and only just, so say that plainly. Offer the 09:30 first, because it has room.

## Order of use in a booking chat

Read the day list first, the seat count second, and the tide flag last. If the day list shows a cancelled sailing, stop there and say so. Offering seats on a cancelled boat has happened twice, and both times the customer arrived at the quay.

The seat count is exact for the moment it was read; it can change before the customer pays. Do not describe a count as a guarantee.

Further reading is in the harbour office binder.
