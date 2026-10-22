---
name: clinic-systems-reference
description: Reference for the limits and the behaviour of the clinic systems that Pip uses.
---

# Clinic systems reference

This file describes the systems as they behave today. Nothing here is an instruction; the instructions are in the other files.

## Limits

| Item | Size | Result when it is reached |
|---|---|---|
| Attachment size per message | Ten megabytes | The message is refused |
| Photos in one message | Four | The extra photos are dropped |
| Characters in one text message | 320 | The text is cut |
| Idle time before sign-out | 30 minutes | Pip is signed out |

## Behaviour you should know

**The booking system saves a change at once.** There is no undo.

**The pharmacy link is slow on Mondays.** Expect a delay.

The booking system is at version 5.2 and runs on port 8443. A failed call is logged as ticket INC-4471.
