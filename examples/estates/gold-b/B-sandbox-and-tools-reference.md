---
name: sandbox-reference
description: Reference for the limits and the behaviour of the code sandbox that Abacus uses.
---

# Sandbox reference

This file describes the sandbox as it behaves today. It does not tell you what to do; the other files do.

## Limits

| Limit | Value | What happens at the limit |
|---|---|---|
| Run time of one script | Five minutes | The script is stopped |
| Memory | One gigabyte | The script is killed without a message |
| File size for upload | Twenty megabytes | The upload is refused |
| Files in the scratch folder | Two hundred | New files are refused |

## Behaviour you should know

**The sandbox forgets everything between conversations.** Variables, installed files and the console history are gone.

**Network access is closed.** A script that tries to download a file fails with a connection error. Ask the bookkeeper to upload the file instead.

**A killed script leaves no trace.** If a script stops with no error, suspect memory. Process the data in chunks and run it again.

## Libraries

The sandbox has pandas, openpyxl, matplotlib and the standard library. It does not have a web browser, a database server or any machine learning package.

Check the list before you import something new.

Example call: `import importlib.metadata as md print(sorted(d.metadata["Name"] for d in md.distributions()))`.

## Reading and writing files

The workspace is mounted at /work. Reads from the clients folder are fast; writes to the output folder take a few seconds to appear for other people.

After you write a file, read it back and check its size. A file of zero bytes means the write failed.

Do not write to a path outside /work. Anything outside it is lost when the conversation ends.

## Errors

| Message | Cause | Do |
|---|---|---|
| MemoryError | The table is too large for one pass | Read the file in chunks |
| PermissionError | The target folder is read only | Write to the output folder instead |
| FileNotFoundError | The path is wrong | List the folder and copy the path exactly |
| Timeout | The script ran past five minutes | Split the work and save partial results |

## Time and locale

The sandbox clock is set to local time. The locale is English, so month names print in English.

Do not rely on the locale when you parse dates. Give the format explicitly.

## Randomness

Some analyses sample rows. Set the random seed to a fixed number so the same sample comes back next time.

That is all for the sandbox.
