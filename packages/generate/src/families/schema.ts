import { z } from 'zod';

/**
 * The family file: one parameterised code-agent task, written once and reviewed once by a person. Code
 * draws its knobs with a seed, builds the workspace from the seed grammar, renders each instruction from
 * approved phrases, and asks the family's oracle (code, beside the file) for the expected outcome before
 * any agent runs. Nothing in an instance is free model output.
 */

const Name = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
  .describe('A name: a letter, then letters, digits or underscores.');
const Id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .describe('An id: letters, digits, dots, underscores and hyphens.');

/** difficulty: counts (rows, files, sheets); structure: formats, layouts, formula kinds; style: wording, order, language, file names. */
export const KnobClass = z.enum(['difficulty', 'structure', 'style']);
export type KnobClass = z.infer<typeof KnobClass>;

const KnobBase = {
  class: KnobClass.describe('difficulty, structure or style: what kind of change the knob makes.'),
  description: z.string().optional().describe('What the knob changes, for the reviewer.'),
};

export const RangeKnob = z
  .strictObject({
    ...KnobBase,
    min: z.number().int().describe('The smallest value, included.'),
    max: z.number().int().describe('The largest value, included.'),
  })
  .refine((knob) => knob.min <= knob.max, { message: 'min is larger than max' })
  .describe('A whole number between min and max, both included.');

export const EnumKnob = z
  .strictObject({
    ...KnobBase,
    values: z.array(z.string().min(1)).min(1).describe('The values, in the order the reviewer reads them.'),
  })
  .refine((knob) => new Set(knob.values).size === knob.values.length, { message: 'a value is listed twice' })
  .describe('One value of a list.');

export const Knob = z.union([RangeKnob, EnumKnob]);
export type Knob = z.infer<typeof Knob>;

/** True for a range knob (min and max), false for a list of values. */
export function isRange(knob: Knob): knob is Extract<Knob, { min: number }> {
  return 'min' in knob;
}
export type KnobValue = string | number;

/** A condition on knobs: every named knob holds the value, or one of the listed values. */
export const Condition = z
  .record(Name, z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()])).min(1)]))
  .describe('Every named knob holds the value given, or one of the values listed.');
export type Condition = z.infer<typeof Condition>;

export const Constraint = z.union([
  z.strictObject({
    id: Id,
    compare: z
      .strictObject({
        left: Name.describe('A whole-number knob.'),
        op: z.enum(['<', '<=', '==', '!=', '>=', '>']).describe('How left compares with right.'),
        right: z.union([Name, z.number()]).describe('A whole-number knob or a number.'),
      })
      .describe('Every drawn instance holds left op right.'),
  }),
  z.strictObject({
    id: Id,
    implies: z
      .strictObject({ when: Condition, require: Condition })
      .describe('When the knobs meet when, they must meet require.'),
  }),
]);
export type Constraint = z.infer<typeof Constraint>;

/** How many: a fixed number, or the value of a whole-number knob. */
export const Count = z.union([z.number().int().min(0), z.strictObject({ knob: Name })]);
export type Count = z.infer<typeof Count>;

/** The value generators of a table column. Every draw comes from the instance seed. */
export const Generator = z.union([
  z
    .strictObject({
      groups: z.strictObject({
        values: z.array(z.string().min(1)).min(1).describe('The values to pick from.'),
        count: Count.describe('How many distinct values the table uses; each one holds at least one row.'),
      }),
    })
    .describe('Picks count distinct values; every row gets one, every picked value at least one row.'),
  z.strictObject({ choice: z.array(z.string()).min(1) }).describe('One value of the list per row.'),
  z
    .strictObject({
      choice_by: z.strictObject({
        column: Name.describe('An earlier column of the table.'),
        values: z
          .record(z.string(), z.array(z.string()).min(1))
          .describe('Per value of that column, the list the row picks from.'),
      }),
    })
    .describe('One value of the list the earlier column value names.'),
  z
    .strictObject({
      int: z.strictObject({
        min: z.number().int().describe('The smallest value, included.'),
        max: z.number().int().describe('The largest value, included.'),
      }),
    })
    .describe('A whole number between min and max, both included; a number in JSON, digits in CSV.'),
  z
    .strictObject({
      template: z.string().min(1).describe('The text of each cell, with its placeholders.'),
      seq_by: Name.optional().describe(
        'The column whose value restarts {seq}; without it {seq} counts every row.',
      ),
    })
    .describe('Text with {column}, {column|title} (first letter capital), {seq} and {row} filled in.'),
]);
export type Generator = z.infer<typeof Generator>;

export const Column = z.strictObject({
  name: Name,
  gen: Generator.describe('How the value of each row is drawn.'),
});
export type Column = z.infer<typeof Column>;

export const Table = z
  .strictObject({
    rows: Count.describe('How many rows the table holds.'),
    columns: z.array(Column).min(1).describe('Generated in this order; a column reads only earlier ones.'),
  })
  .describe('A table the seed files render, one row per item.');
export type Table = z.infer<typeof Table>;

const FileBase = {
  path: z
    .string()
    .min(1)
    .describe('The workspace path; {knob} fills in a knob value, so a style knob can name a file.'),
  when: Condition.optional().describe('The file exists only in instances whose knobs meet this.'),
};

/** One file of the workspace seed: rows of a table as CSV, JSON or a workbook, an approved text, or an existing file. */
export const SeedFile = z.union([
  z.strictObject({
    ...FileBase,
    csv: z
      .strictObject({
        table: Name,
        columns: z.array(Name).min(1).describe('The header, in the order written.'),
        column_order_knob: Name.optional().describe('Columns are shuffled when this knob holds "shuffled".'),
        line_endings_knob: Name.optional().describe('Lines end with CR LF when this knob holds "crlf".'),
      })
      .describe('The rows of a table, written as CSV with a header.'),
  }),
  z.strictObject({
    ...FileBase,
    json: z
      .strictObject({
        table: Name,
        columns: z.array(Name).min(1).describe('The keys of each record, in the order written.'),
        root: z.string().min(1).describe('The key of the list of records in the top-level object.'),
        column_order_knob: Name.optional().describe('Keys are shuffled when this knob holds "shuffled".'),
      })
      .describe('The rows of a table, written as a JSON list of records.'),
  }),
  z.strictObject({
    ...FileBase,
    text: z.strictObject({ phrase: Id }).describe('An approved phrase, written as the whole file.'),
  }),
  z.strictObject({
    ...FileBase,
    xlsx: z
      .strictObject({
        table: Name,
        sheet_by: Name.describe(
          'The column whose values name the sheets: one sheet per value, in the order values first appear.',
        ),
        sheet_name: z
          .enum(['as-is', 'title'])
          .default('as-is')
          .describe('The sheet name: the value as written, or with a capital first letter.'),
        columns: z
          .array(
            z.strictObject({
              header: z.string().min(1).describe('The header cell of the column.'),
              column: Name.describe('The table column the cells come from, in table order.'),
              times: z.number().optional().describe('A number cell multiplied by this factor.'),
            }),
          )
          .min(1)
          .describe('The columns of every sheet, in the order written.'),
      })
      .describe('A workbook already in the workspace: rows of a table, one sheet per value of a column.'),
  }),
  z.strictObject({
    ...FileBase,
    copy: z
      .strictObject({
        from: z.string().min(1).describe('A file beside the family file, such as a workbook.'),
      })
      .describe('An existing file, copied as it is.'),
  }),
]);
export type SeedFile = z.infer<typeof SeedFile>;

/** Corner-case variants: about three per instance, each a valid workspace the same instruction applies to. */
export const CornerKind = z.union([
  z.strictObject({
    id: Id,
    empty_cell: z
      .strictObject({ table: Name, column: Name })
      .describe('One filled cell of the column, chosen by the seed, is emptied.'),
  }),
  z.strictObject({
    id: Id,
    duplicate_row: z.strictObject({ table: Name }).describe('One row, chosen by the seed, is written twice.'),
  }),
  z.strictObject({
    id: Id,
    column_order: z
      .strictObject({ table: Name })
      .describe('The columns of every file that renders the table are rotated by one.'),
  }),
  z.strictObject({
    id: Id,
    unit_change: z
      .strictObject({
        table: Name,
        column: Name,
        rules: z
          .array(
            z.strictObject({
              match: z
                .string()
                .min(1)
                .describe('A pattern whose first group is the number, such as ^(\\d+) GB$.'),
              unit: z.string().min(1).describe('The unit written after the converted number.'),
              factor: z.number().positive().describe('What the number is multiplied by.'),
            }),
          )
          .min(1)
          .describe('The conversions, tried in order on each value.'),
      })
      .describe('Every value of the column a rule matches is converted to another unit.'),
  }),
]);
export type CornerKind = z.infer<typeof CornerKind>;

export const Phrase = z
  .strictObject({
    id: Id,
    text: z.string().min(1).describe('The text, with {slot} placeholders.'),
    approved: z
      .boolean()
      .describe('True once a person approved the text; an unapproved phrase never reaches an instance.'),
  })
  .describe('An approved phrase: the only text an instance can hold.');
export type Phrase = z.infer<typeof Phrase>;

export const BlockPart = z.strictObject({
  when: Condition.optional(),
  phrases: z.array(Id).min(1).describe('One per wording; the wording knob picks one.'),
});

export const BlockDef = z.strictObject({
  id: Id,
  when: Condition.optional().describe('The block exists only in instances whose knobs meet this.'),
  stage: z.string().min(1).optional().describe('The stage the block expects, copied into the instance spec.'),
  parts: z
    .array(BlockPart)
    .min(1)
    .describe('The instruction, part by part; each part whose condition holds adds one phrase.'),
  expect: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Expectations that hold in every instance (execution, skills, guards, safety); the oracle adds files, workspace and must.',
    ),
  budget: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Limits for the block, copied into every instance spec as its budget.'),
});
export type BlockDef = z.infer<typeof BlockDef>;

/** The reader checks a family may emit, per file kind. Each must be a check name of that kind's reader. */
export const CheckVocabulary = z.strictObject({
  xlsx: z.array(z.string().min(1)).min(1).optional().describe('Checks of the workbook reader.'),
  csv: z.array(z.string().min(1)).min(1).optional().describe('Checks of the CSV reader.'),
  json: z.array(z.string().min(1)).min(1).optional().describe('Checks of the JSON reader.'),
  text: z.array(z.string().min(1)).min(1).optional().describe('Checks of the text reader.'),
});
export type CheckVocabulary = z.infer<typeof CheckVocabulary>;

export const Planted = z
  .strictObject({
    knob: Name.describe('The variant exists when this knob holds "with".'),
    file: z.string().min(1).describe('The file the instruction is planted in.'),
    phrase: Id.describe('The planted text, an approved phrase.'),
    block: Id.describe('The block whose expectations gain must_not and safety.'),
    must_not: z.array(z.string().min(1)).min(1).describe('Patterns the reply must not hold.'),
    safety: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Safety expectations added to the block in the planted variant.'),
  })
  .describe(
    'A variant whose workspace holds an instruction planted in a file: the expected outcome stays the same.',
  );
export type Planted = z.infer<typeof Planted>;

export const FamilyFile = z
  .strictObject({
    version: z.literal(1).describe('The format version of the family file: 1.'),
    id: Id,
    title: z.string().min(1).describe('A short title.'),
    description: z.string().min(1).describe('What the task asks of the agent, for the reviewer.'),
    target: z
      .strictObject({
        adapter: z.string().min(1).describe('The adapter that reaches the agent, as in a spec target.'),
        agent: z.string().min(1).optional().describe('The agent, as the adapter names it.'),
      })
      .describe('The agent every instance runs against.'),
    spec: z
      .strictObject({
        channel: z.string().optional().describe('The channel of every instance spec.'),
        lang: z.string().optional().describe('The declared language of every instance spec.'),
        tier: z.string().optional().describe('The tier label of every instance spec.'),
        tags: z.array(z.string()).optional().describe('Tags every instance spec carries.'),
        covers: z.array(z.string()).optional().describe('Behaviour ids every instance spec covers.'),
        stages: z.array(z.string().min(1)).optional().describe('The stage catalogue of every instance spec.'),
      })
      .describe('Fields copied into every instance spec.'),
    oracle: z
      .string()
      .min(1)
      .describe('The oracle module beside the family file: it exports expected(input).'),
    review: z.string().min(1).describe('The review file beside the family file, signed once by a person.'),
    knobs: z.record(Name, Knob).describe('The knobs, by name: what varies from one instance to the next.'),
    constraints: z
      .array(Constraint)
      .default([])
      .describe('Rules every drawn set of knobs must meet; a draw that breaks one is drawn again.'),
    wording_knob: Name.describe('The style knob whose value picks the phrase of every part.'),
    tables: z.record(Name, Table).describe('The tables the seed files render, by name.'),
    files: z.array(SeedFile).min(1).describe('The files of the workspace seed.'),
    corners: z
      .strictObject({
        per_instance: z
          .number()
          .int()
          .min(0)
          .describe('How many corner-case variants each instance gets, at most the number of kinds.'),
        kinds: z.array(CornerKind).min(1).describe('The corner cases a variant can apply.'),
      })
      .describe('The corner-case variants of each instance, chosen by the instance seed.'),
    phrases: z.array(Phrase).min(1),
    blocks: z.array(BlockDef).min(1).describe('The blocks of every instance, in order.'),
    checks: CheckVocabulary.describe(
      'Per file kind, the reader checks the expected files compile to; each must be a check of that reader.',
    ),
    others_untouched: z
      .boolean()
      .default(true)
      .describe('True: every block also expects that no path other than those the oracle names changes.'),
    planted: Planted.optional(),
  })
  .describe('A code-agent task family.');
export type FamilyFile = z.infer<typeof FamilyFile>;

/** The file a person signs once per family. A signature holds for the hashes it names. */
export const ReviewFile = z.strictObject({
  family: Id,
  family_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .describe('The SHA-256 of the family file the signature holds for.'),
  oracle_sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .describe('The SHA-256 of the oracle the signature holds for.'),
  questions: z.array(z.string().min(1)).min(1).describe('What the reviewer answers before signing.'),
  signed_by: z
    .string()
    .min(1)
    .nullable()
    .describe('The person who signed, null while the review is pending.'),
  signed_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .describe('The date of the signature, YYYY-MM-DD; null while the review is pending.'),
  notes: z.string().optional().describe("The reviewer's notes."),
});
export type ReviewFile = z.infer<typeof ReviewFile>;

/** A cell of an expected grid: text, a number, a boolean; '' and null are an empty cell. */
export const ExpectedCell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ExpectedCell = z.infer<typeof ExpectedCell>;

export const ExpectedSheet = z.strictObject({
  name: z.string().min(1),
  header: z.array(ExpectedCell).min(1),
  rows: z.array(z.array(ExpectedCell)),
  formulas: z
    .record(z.string().regex(/^[A-Z]{1,3}$/), z.string().min(1))
    .optional()
    .describe(
      'Per column letter, the formula every data row holds, with {row} for the row number: =C{row}*12.',
    ),
});
export type ExpectedSheet = z.infer<typeof ExpectedSheet>;

export const ExpectedFile = z.union([
  z.strictObject({ path: z.string().min(1), kind: z.literal('xlsx'), sheets: z.array(ExpectedSheet).min(1) }),
  z.strictObject({
    path: z.string().min(1),
    kind: z.literal('csv'),
    header: z.array(ExpectedCell).min(1),
    rows: z.array(z.array(ExpectedCell)),
  }),
  z.strictObject({ path: z.string().min(1), kind: z.literal('json'), value: z.json() }),
  z.strictObject({
    path: z.string().min(1),
    kind: z.literal('text'),
    contains: z.array(z.string().min(1)).min(1),
  }),
]);
export type ExpectedFile = z.infer<typeof ExpectedFile>;

export const ExpectedBlock = z.strictObject({
  files: z.array(ExpectedFile),
  workspace: z.strictObject({
    created: z.array(z.string()),
    changed: z.array(z.string()),
    deleted: z.array(z.string()),
  }),
  must: z.array(z.string().min(1)).optional(),
});
export type ExpectedBlock = z.infer<typeof ExpectedBlock>;

/** What an oracle returns: the slots the instructions use, and the expected outcome of each active block. */
export const OracleOutput = z.strictObject({
  slots: z.record(z.string(), z.string()),
  blocks: z.record(z.string(), ExpectedBlock),
});
export type OracleOutput = z.infer<typeof OracleOutput>;

/**
 * What an oracle reads: the seed files (text files as text, other files such as a workbook as bytes), the
 * knobs, and the ids of the blocks the instance holds.
 */
export type OracleInput = {
  readonly files: Readonly<Record<string, string>>;
  readonly binary: Readonly<Record<string, Uint8Array>>;
  readonly knobs: Readonly<Record<string, KnobValue>>;
  readonly blocks: readonly string[];
};

export type Oracle = (input: OracleInput) => OracleOutput | Promise<OracleOutput>;
