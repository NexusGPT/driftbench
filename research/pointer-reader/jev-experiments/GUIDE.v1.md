# Labelling guide for the held-out set (phase 2)

You label units of text taken from instruction files written for an assistant that works at a small harbour co-op. A unit is one sentence, one list item, or one table cell. Give each unit exactly one label.

## The labels

- **prohibition**: the unit tells the reader never to do something, or not to, or marks an act as out of bounds. Examples of the idea: "Do not open the drawer", "Quill never takes a card number", "A name is never repeated to a second customer".
- **gate**: the unit tells the reader that one act must come before or after another, or is allowed only once another act is done (before, after, until, only after, first ... then). It does not forbid anything outright.
- **rule**: the unit tells the reader to do something, or what to do in a stated case ("If X, do Y"; "X → do Y"), and neither forbids an act nor orders two acts. A statement of practice that assigns an act to the reader or the staff counts, even in the passive ("Anything involving money goes to the desk").
- **example**: the unit is a case, a sample, a story of what happened, a quoted sample text, or an item in a list of samples. If a unit is framed as an example, it is `example` whatever it says.
- **description**: the unit states how something is, was or works: background, reasons, how a tool behaves, who does what. It gives the reader no instruction. A sentence about what a TOOL or a THIRD PARTY always or never does is a description, not an instruction.
- **none**: headings, bold labels such as "Voice.", table header cells, greetings, thanks, sign-offs, filler, and anything else that says nothing about the work.

## Rules for mixed units

- The instruction counts wherever it sits in the unit: after a dash or a semicolon, as the second half of a long sentence, or in the middle of a sentence.
- When a unit holds more than one kind of instruction, the strongest wins: prohibition, then gate, then rule.
- A unit that holds an instruction and a reason is labelled by the instruction.
- A table cell is judged on its own text. A first-column cell that only names a row is a description.
- Judge the unit by what it asks of the reader. Do not judge by single words.

## What you receive and what to return

A sheet lists the units of each file as `n<TAB>text`, with the heading path above each run of units. Return one line per unit: `file<TAB>n<TAB>label`, in sheet order. Use only the label names above.
