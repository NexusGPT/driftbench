# Labelling guide for the span set (phase 3)

You label the units of instruction files written for an assistant that works at a small volunteer repair café. A unit is one sentence, one list item, one table cell, one heading or one front-matter value. The sheet shows the units in their structure (section, paragraph, list, table, row), each with a number.

## Step 1: one label per unit

- **prohibition**: the unit tells the reader never to do something, or not to, or marks an act as out of bounds ("Do not open the drawer", "Nobody lends the key").
- **gate**: the unit says that one act must come before or after another, or is allowed only once another act is done (before, after, until, only after, first then). It does not forbid anything outright.
- **rule**: the unit tells the reader to do something, or what to do in a stated case, and neither forbids an act nor orders two acts. A statement of practice that assigns an act to the reader or staff counts, even in the passive.
- **example**: the unit is a case, a sample, a story of what happened, or a quoted sample text. If a unit is framed as an example it is `example`, whatever it says.
- **description**: the unit states how something is, was or works: background, a reason, how a tool behaves, who does what. It asks nothing of the reader. A sentence about what a tool or a third party always or never does is a description.
- **none**: headings, bold labels, table header cells, greetings, thanks, sign-offs and filler.

Mixed units: the instruction counts wherever it sits in the unit. When a unit holds more than one kind of instruction, the strongest wins: prohibition, then gate, then rule. Judge a unit by what it asks of the reader, not by single words. A table cell is judged together with its row (see step 2).

## Step 2: rules are spans

A **rule** is one instruction: something the reader must do, never do, or do in a given order. Most rules are a single unit. Some need several units to be understood and applied. Put those units in one **group**:

- a lead-in sentence and the list items or table that finish it ("Check all of these:" and the items);
- a condition sentence and the action sentence that follows ("A visitor asks for X." then "Offer Y.");
- a rule and its exception ("Never do X." then "The one exception is ...");
- a rule and a sentence that only gives its detail (what to write, how many, in what order) and cannot be followed alone;
- a table row whose cells together say what to do (the cells on the left name the case);
- a whole paragraph whose sentences cannot be followed one at a time.

Test: if a reader who saw only one of the units could not apply it, or would apply it wrongly, the units belong together. If each unit can be followed on its own, they are separate rules, even when they sit in one paragraph.

- Background, a reason or an example next to a rule is not part of the group. It keeps its own label (`description` or `example`).
- The units of a group are consecutive and all get the same label: the strongest kind found in the group (prohibition, then gate, then rule). A group has two or more units. A group never holds an example.
- A unit that is a rule on its own needs no group.

## What you return

One line per unit, in sheet order: `file<TAB>n<TAB>label<TAB>group`. `group` is empty for a unit that is not in a group. Units of one group share the same letter or word (for example `a`). Use a new letter for each group within a file.
