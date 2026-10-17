# Labelling guide, version 2.1 (labels only)

You label the units of instruction files written for an assistant. The assistant, or the person the file is written for, is called the **reader**. A unit is one sentence, one list item, one table cell, one heading or one front-matter value. The sheet shows the units in their structure (section, paragraph, list, table, row), each with a number. Give each numbered unit exactly one label.

## The six labels

- **prohibition**: the unit forbids an act, or marks an act as out of bounds ("Do not open the drawer", "Nobody lends the key", "No more than two seedlings per pot").
- **gate**: the unit says that one act of the reader comes before or after another act ("Label the tray before you stack it", "Wait until the lamp is cold, then lift it").
- **rule**: the unit tells the reader to do something, or what to do in a stated case ("Water the seedlings each morning", "If a pot cracks, move it to the repair shelf"). It neither forbids an act nor orders two acts.
- **example**: the unit is a case, a sample, a story of what happened, or quoted sample wording. If a unit is framed as an example it is `example`, whatever it says.
- **description**: the unit states how something is, was or works, or what someone else does. It asks nothing of the reader.
- **none**: headings, bold labels, table header cells, front-matter names, greetings, thanks, sign-offs and filler.

## How to decide a unit: apply the tests in this order and stop at the first one that fits

1. **none**: Is it a heading, a bold label, a header cell, a name field, a greeting, a thanks or a sign-off? Then `none`.
2. **example**: Is it framed as a case, a sample, a story of what happened, or quoted sample wording ("Example:", "Case:", "For instance", "Last spring...", a quoted message)? Then `example`.
3. **prohibition**: Does the unit contain a clause that forbids an act of the reader (never, do not, must not, no X, avoid, leave out, "no more than", "nobody but")? Then `prohibition`, even when the unit also contains an instruction or an order. The strongest kind wins: prohibition, then gate, then rule.
4. **gate**: Does the unit state an order between two acts of the reader (before, after, until, once, only after, first ... then, "..., then ...")? Then `gate`.
5. **rule**: Does the unit tell the reader to do something, or what to do in a case, or assign an act to the reader? Then `rule`.
6. Otherwise `description`.

Judge a unit by what it asks of the reader, not by single words. A reason, a result or an explanation inside the unit does not change the label of the instruction in it.

## Default decisions for the shapes annotators disagreed on

**D1. Whose act?** The reader is the assistant (named in the file) or the person the file addresses. An act of the reader, in the imperative, in "you", in the reader's own name ("Tinker does not give orders to the lead") or in the passive when the reader is the only possible actor, is an instruction. An act of anyone else (the lead, the office, a customer, a tool, the organisation) is `description`, even with "must" or "never".
A sentence whose subject is "it", "this skill", "the tool", "the office" or any third party is about that third party: `description`, even with "not" ("It does not move money.").
Example: "The head gardener locks the glasshouse at six." is `description`; "Lock the glasshouse at six." is `rule`; "The glasshouse never opens before seven." is `description`; "Never open the glasshouse before seven." is `prohibition`.

**D2. List items.** A list item that finishes a lead-in which is an instruction belongs to the same group as the lead-in (see D8) and takes the group's kind. A list item with no instruction lead-in is labelled on its own text; a noun phrase or fragment that holds no act is `description`.
Example: "Pack three things:" with items "tape", "scissors", "a pen": all four units are `rule`. "The shop sells:" with items "ferns", "herbs": `description`.

**D3. Tables.** Header cells are `none`. If a header names an act ("Then", "Do", "Action", "Tell the visitor"), the table is an *instruction table*: read each row as one unit, decide its kind with the tests above, and give that kind to every cell of the row, including the cell that names the case. Otherwise the table is a *reference table* (facts, limits, parameters, errors): judge each cell on its own text; a cell that only names a case or a value is `description`.
Example: columns "Sign" and "Then", row "Smell of smoke" and "Leave the shed": both cells are `rule`. Columns "Plant", "Water", "Light", row "Fern", "Twice a week", "Shade": all `description`.

**D4. Front matter.** A `name` value is `none`. A `description` value is `description`, even when it begins with a verb ("Draft the weekly notice. Use when a notice is due.").

**D5. "Use X when Y".** A sentence that says which option, tool or call suits which need ("Use the cutter when you need a straight edge", "Build a view in one call by passing the date") describes the option and is `description`. A sentence that tells the reader what to do in the work ("Cut the card first") is an instruction.

**D6. Order and time.** An order needs two acts of the reader ("Rinse the can first, then fill it", "Do not fill the can until it is rinsed"). A deadline or a time limit is not an order: "Label every tray by noon" is `rule`; "Label the tray before you stack it" is `gate`. Waiting for an event or for another person's act before an act of the reader is also an order, and is a `gate`: "Open the shutters only after the van has left", "Wait for the customer's reply before you offer a second option", "Stay on the line until the dispatcher says you can stop".

**D7. Limits and "only".** A cap on an act ("at most", "no more than", "nobody but") is `prohibition`. "Do Y only for X" states what to do for X and is `rule`, unless it also holds a never or a do not.
An explicit cap in a number or a count ("one question per message", "at most two", "never more than") is a `prohibition`.
Example: "Lend no more than two tools" is `prohibition`; "One tool per borrower" is `prohibition`; "Use the ladder only for the high shelf" is `rule`.

**D8. Rules as spans (groups).** A rule is one instruction. Most rules are one unit. Some need several units to be understood and applied; put those units in one **group**:
- a lead-in sentence and the list items or table that finish it;
- a condition sentence and the action sentence that follows ("A pot cracks." then "Move it to the repair shelf.");
- a rule and its exception ("Never lift the lamp." then "The one exception is the session lead.");
- a rule and a sentence that only gives its detail and cannot be followed alone;
- a table row of an instruction table;
- a paragraph whose sentences cannot be followed one at a time.
Test: if a reader who saw only one of the units could not apply it, or would apply it wrongly, the units belong together. If each unit can be followed alone, they are separate rules, even in one paragraph. Background, a reason or an example next to a rule is not part of the group; it keeps its own label. A group has two or more consecutive units and never holds an example.
The **kind of a group** is the strongest kind that tests 3 to 5 find in any of its units (prohibition, then gate, then rule), and every unit of the group gets that kind, including a lead-in or a noun phrase.
Example: "Before you close the shed, do three things:" (gate), then "sweep the floor", "lock the tools" (list items), then "Never leave the lamp on." (separate rule, `prohibition`). The first three units form one group of kind `gate`. The last unit is its own rule.

**D9. Soft wording.** "Try to", "prefer", "it is better to" followed by an act of the reader are instructions (`rule`, or the stronger kind the test finds). A soft remark with no act of the reader ("It is nice when the shelves are tidy") is `description`.

**D10. Facts that restate a rule.** A statement about the organisation, the tool or a third party ("The café never guarantees a repair", "Aprons are washed on Sunday by the closing crew") is `description`. The same content addressed to the reader ("Never promise a repair") is an instruction.

**D11. Contrast ("X, not Y"; "X rather than Y").** A unit that tells the reader what to do and names the wrong way beside it is one instruction: `rule`. The contrast only shows the manner of the act. It becomes `prohibition` only when the unit holds a never, a do not, a must not, "avoid" or "leave out".
Example: "Say 'from Monday', not 'as of next week'" is `rule`; "Describe the pot the way the buyer does, not the way you would" is `rule`; "Never say 'as of next week'" is `prohibition`.

**D12. Worked examples.** A step or sentence that sits inside a worked example, a sample run or a sample reply (after "Example:", "Example note:", "Worked example", "For instance") is `example`, whatever it says. The lead-in line of the example is `example` too.
Example: under "Worked example:", the line "Call the list tool with the date, then read each status." is `example`.

**D13. Output-spec fragments.** A fragment that states how the reader's output must be (tone, length, form: "Calm, and a little dry.", "Three lines at most.", "Plain words") is an instruction on the output: `rule` (`prohibition` when it is a cap, D7). A sentence that gives the reason for such a fragment is `description`.

**D14. Remember, note, keep in mind.** "Remember that" or "Note that" followed by a fact with no act of the reader is `description`. Followed by an act, the act decides.
Example: "Remember that the glasshouse is dark by four." is `description`; "Remember to lock the glasshouse." is `rule`.

**D15. Pointer and layout sentences.** A sentence that only tells the reader where something is or how the file is laid out ("The last column is for you", "The table below lists the limits", "See the tool notes") is `description`.

**D16. Bold statements.** A bold line that holds a full statement is labelled by its meaning with the tests above, not `none`. Only a bold label (a name or a short title) is `none`.
Example: "**The scheduler never retries a failed read.**" is `description` (D1).

## What you return

One line per unit that has a number in square brackets, in sheet order: the number, a tab, the label. In this task you give no group names, but you still apply D8: every unit of a group gets the kind of the group.
