---
name: sandbox-reference{{n}}
description: Reference for the limits and the behaviour of the code sandbox that Abacus uses.{{d}}
---

# Sandbox reference{{n}}

This file describes the sandbox as it behaves today.{{d}} It does not tell you what to do; the other files do.{{d}}

## Limits{{n}}

| Limit{{n}} | Value{{n}} | What happens at the limit{{n}} |
|---|---|---|
| Run time of one script{{d}} | Five minutes{{d}} | The script is stopped{{d}} |
| Memory{{d}} | One gigabyte{{d}} | The script is killed without a message{{d}} |
| File size for upload{{d}} | Twenty megabytes{{d}} | The upload is refused{{d}} |
| Files in the scratch folder{{d}} | Two hundred{{d}} | New files are refused{{d}} |

## Behaviour you should know{{n}}

**The sandbox forgets everything between conversations.**{{d}} Variables, installed files and the console history are gone.{{d}}

**Network access is closed.**{{d}} A script that tries to download a file fails with a connection error.{{d}} Ask the bookkeeper to upload the file instead.{{r}}

**A killed script leaves no trace.**{{d}} If a script stops with no error, suspect memory.{{d}} Process the data in chunks and run it again.{{r}}

## Libraries{{n}}

The sandbox has pandas, openpyxl, matplotlib and the standard library.{{d}} It does not have a web browser, a database server or any machine learning package.{{d}}

Check the list before you import something new.{{g}}

Example call: `import importlib.metadata as md print(sorted(d.metadata["Name"] for d in md.distributions()))`.{{e}}

## Reading and writing files{{n}}

The workspace is mounted at /work.{{d}} Reads from the clients folder are fast; writes to the output folder take a few seconds to appear for other people.{{d}}

After you write a file, read it back and check its size.{{g}} A file of zero bytes means the write failed.{{d}}

Do not write to a path outside /work.{{p}} Anything outside it is lost when the conversation ends.{{d}}

## Errors{{n}}

| Message{{n}} | Cause{{n}} | Do{{n}} |
|---|---|---|
| MemoryError{{d}} | The table is too large for one pass{{d}} | Read the file in chunks{{r}} |
| PermissionError{{d}} | The target folder is read only{{d}} | Write to the output folder instead{{r}} |
| FileNotFoundError{{d}} | The path is wrong{{d}} | List the folder and copy the path exactly{{r}} |
| Timeout{{d}} | The script ran past five minutes{{d}} | Split the work and save partial results{{r}} |

## Time and locale{{n}}

The sandbox clock is set to local time.{{d}} The locale is English, so month names print in English.{{d}}

Do not rely on the locale when you parse dates.{{p}} Give the format explicitly.{{r}}

## Randomness{{n}}

Some analyses sample rows.{{d}} Set the random seed to a fixed number so the same sample comes back next time.{{r}}

That is all for the sandbox.{{n}}
