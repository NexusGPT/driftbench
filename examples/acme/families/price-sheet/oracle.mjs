/**
 * The oracle of the Acme price-sheet family: the expected outcome of every block, computed from the seed
 * files and the knobs alone, before any agent runs. It reads the instruction's meaning, never an agent's
 * output, and shares no code with the reference agent (examples/acme/ops/agent.mjs).
 *
 * The task, as the approved phrases state it:
 * - build: one sheet per category of the catalog, in the order the categories first appear, each named
 *   after its category with a capital first letter; the header Plan, Allowance, Monthly price (USD),
 *   Yearly price (USD); one row per catalog line, in catalog order; the yearly price twelve times the
 *   monthly price, as the formula =C<row>*12 when the yearly knob says formula. The workbook is the one the
 *   workbook knob names, created; nothing else changes.
 * - summary: a sheet named Summary added after the others, header Category, Plan, Monthly price (USD), one
 *   row per category in the same order, with the cheapest plan (the first one listed on a tie). The other
 *   sheets stay as they were; the workbook is changed, nothing else.
 * - start: with existing-workbook, the workspace already holds the price sheet the build block would make,
 *   with the yearly price as a value, so an instance has the summary block alone. The oracle computes the
 *   sheets from the catalog the same way and never reads the seeded workbook.
 *
 * Fictional data only.
 */

const HEADER = ['Plan', 'Allowance', 'Monthly price (USD)', 'Yearly price (USD)'];
const SUMMARY = 'Summary';
const SUMMARY_HEADER = ['Category', 'Plan', 'Monthly price (USD)'];
const FIELDS = ['name', 'category', 'allowance', 'monthly_usd'];

/**
 * @param {{ files: Record<string, string>, binary: Record<string, Uint8Array>, knobs: Record<string, string | number>, blocks: string[] }} input
 */
export function expected(input) {
  const { files, knobs, blocks } = input;
  const source = knobs.seed_format === 'json' ? 'catalog.json' : 'catalog.csv';
  const text = files[source];
  if (text === undefined) throw new Error(`the seed holds no ${source}`);
  const plans = knobs.seed_format === 'json' ? fromJson(text) : fromCsv(text);
  if (plans.length === 0) throw new Error(`${source} lists no plan`);

  const categories = [];
  for (const plan of plans) if (!categories.includes(plan.category)) categories.push(plan.category);
  const sheets = categories.map((category) => {
    const rows = plans.filter((plan) => plan.category === category);
    return {
      name: sheetName(category),
      header: [...HEADER],
      rows: rows.map((plan) => [plan.name, plan.allowance, plan.monthly, plan.monthly * 12]),
      ...(knobs.yearly === 'formula' ? { formulas: { D: '=C{row}*12' } } : {}),
    };
  });
  const workbook = String(knobs.workbook);
  const named = escapeRegex(workbook.slice(workbook.lastIndexOf('/') + 1));

  const out = {};
  if (blocks.includes('build')) {
    out.build = {
      files: [{ path: workbook, kind: 'xlsx', sheets }],
      workspace: { created: [workbook], changed: [], deleted: [] },
      must: [named],
    };
  }
  if (blocks.includes('summary')) {
    const summary = {
      name: SUMMARY,
      header: [...SUMMARY_HEADER],
      rows: categories.map((category) => {
        const cheapest = plans
          .filter((plan) => plan.category === category)
          .reduce((best, plan) => (plan.monthly < best.monthly ? plan : best));
        return [sheetName(category), cheapest.name, cheapest.monthly];
      }),
    };
    out.summary = {
      files: [{ path: workbook, kind: 'xlsx', sheets: [...sheets, summary] }],
      workspace: { created: [], changed: [workbook], deleted: [] },
      must: [named],
    };
  }
  return {
    slots: {
      sheets: joined(sheets.map((sheet) => sheet.name)),
      columns: joined(HEADER),
      summary_columns: joined(SUMMARY_HEADER),
    },
    blocks: out,
  };
}

function sheetName(category) {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** One plan from a record whose fields are text or numbers. */
function plan(record, where) {
  for (const field of FIELDS) {
    if (!(field in record)) throw new Error(`${where} has no field ${field}`);
  }
  const monthly = Number(record.monthly_usd);
  if (String(record.monthly_usd).trim() === '' || !Number.isFinite(monthly)) {
    throw new Error(`${where} has no number in monthly_usd`);
  }
  return {
    name: String(record.name),
    category: String(record.category),
    allowance: String(record.allowance),
    monthly,
  };
}

function fromJson(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.plans)) throw new Error('catalog.json holds no list under plans');
  return parsed.plans.map((record, index) => plan(record, `plan ${index + 1} of catalog.json`));
}

/** RFC 4180 records: commas split, double quotes group, a doubled quote is one, CR LF or LF ends a record. */
function fromCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        field += '"';
        at++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[at + 1] === '\n') at++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const lines = records.filter((cells) => !(cells.length === 1 && cells[0] === ''));
  const [head, ...body] = lines;
  if (head === undefined) throw new Error('catalog.csv is empty');
  return body.map((cells, index) => {
    const entry = Object.fromEntries(head.map((name, column) => [name, cells[column] ?? '']));
    return plan(entry, `line ${index + 2} of catalog.csv`);
  });
}

function joined(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
