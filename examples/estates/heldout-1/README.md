# heldout-1

A held-out estate for the numeric-limit producer: a fictional veterinary front desk (Pip, Lantern Row Veterinary Clinics) with eight prose files in the layout of `gold-b` (one standing file, four skills, three references). It was written without reading the producer, its prompts, its tests or its recordings, and no model was called.

`truth.yaml` holds, in this order:
- `units`: every unit of the prose with its id (the first ten hex digits of `sha1(file + "\n" + text)`), its file and its text. A unit is a sentence, a list item or one table row; headings and the front matter are not units. A header row of a table is a unit and states no number.
- `limits`: 62 entries on 58 units (a range is two entries on one unit). Each has the comparison (`lt`, `le`, `gt`, `ge`), the role (`constraint` or `trigger`), what the number counts, and the unit it governs. The comparison follows the sentence, in the normal form of the gold estates: a prohibition may be written as a trigger or as the complementary constraint.
- `non_limits`: 31 numbers that are not limits (counts of listed items, dates, versions, codes, ports, examples, a statistic).
- `refers_to`: the units that point at another unit for their number ("the next sentence"), 2 entries, each with the unit it points at.
- `limits_table`: the 4 standalone tables whose rows state limits (no rule refers to them), each with its header unit and its data rows by unit id (11 rows in all, all with a limit).
- `hard_cases`: the unit ids of the limits that are hard by kind: `table` (a number in a table row, the header says what it limits), `pointer` (a number in the unit after the one it governs), `spelled` (a count in words: "one", "twice", "three times"), `negative` (stated by "never", "do not", "no more than"), `range`, `ordinal` ("a third move", "a fifth conversation") and `about-numbers` (a rule about how numbers are written).

Fictional data only.
