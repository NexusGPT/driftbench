---
name: shop-systems-reference
description: Reference for the limits and the behaviour of the shop systems that Spoke uses.
---

# Shop systems reference

The systems below are described as they work at present. This file gives facts only; every instruction sits in the other files.

## Limits

| Thing measured | Amount | What follows at that point |
|---|---|---|
| Attachment size per message | 8 megabytes | The message is refused |
| Photos in one message | Six | The extra photos are dropped |
| Characters in one text message | 480 | The text is cut |
| Idle time before sign-out | 20 minutes | Spoke is signed out |

## Opening history

| Year | Workshops open |
|---|---|
| 2011 | 1 |
| 2014 | 2 |
| 2019 | 3 |

## Behaviour you should know

**The booking board saves a change at once.** There is no undo.

**The courier feed is slow on Mondays.** Expect a delay.

The booking board is at version 4.1 and runs on port 9102. A failed sync is logged as ticket SYN-3306.
