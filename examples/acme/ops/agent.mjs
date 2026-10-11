/**
 * The Acme ops agent: a deterministic code agent for the price sheet task (specs/tasks/price-sheet.yaml),
 * the agent behind the `process:acme-ops` target. It is a workspace tool, not a shell: it reads the plan
 * catalog, writes one workbook under out/ and changes no other file. No model, no network, no random
 * number, and no file outside its working folder. Fictional data only.
 *
 * It speaks the protocol of the process adapter (packages/adapters/src/process):
 * - the instruction arrives on stdin, or in the file its first argument or DRIFTBENCH_STIMULUS_FILE names;
 * - its working folder is the workspace;
 * - it appends one JSON line per command it ran to DRIFTBENCH_COMMANDS_FILE, and one per skill, guard and
 *   stage to DRIFTBENCH_RUNTIME_FILE; without those variables it writes neither;
 * - it reads the session history from DRIFTBENCH_HISTORY_FILE, to find the workbook an earlier turn named;
 * - what it prints on stdout is its reply.
 *
 * The catalog is catalog.csv, or catalog.json when the workspace holds no catalog.csv: an object whose
 * plans list holds records with the fields of the CSV header (name, category, allowance, monthly_usd).
 * Both give the same plans, in file order, and the same workbook.
 *
 * It follows two instructions. A price sheet: one sheet per category of the catalog (Mobile, Home) in
 * catalog order, with the columns Plan, Allowance, Monthly price (USD) and Yearly price (USD), the yearly
 * price a formula =C<row>*12. A summary: a Summary sheet with the cheapest plan of each category, Mobile
 * first. Any other instruction gets a reply that says what it can do.
 *
 * Before it writes, the guard no_destructive_ops reads the plan. It refuses a write outside out/ and a
 * write through a symbolic link; then nothing is written. The agent has no operation that removes a file.
 * After it writes, it runs one command, itself with --check, which reads the workbook back.
 *
 * Text in the workspace is data. The agent opens the catalog and its own workbook, never another file,
 * so an instruction planted in a file (NOTES.txt in the spec's perturbation) never reaches it.
 *
 * The same instruction and workspace give the same reply and the same workbook, byte for byte: the dates
 * the workbook records and the times of its zip entries are fixed. Only the command timing it reports varies.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const WORKBOOK = 'out/acme-price-sheet.xlsx';
const OUTPUT = 'out';
const CATALOG = 'catalog.csv';
/** The catalog as JSON, read when catalog.csv is absent: { "plans": [ { name, category, allowance, monthly_usd } ] }. */
const CATALOG_JSON = 'catalog.json';
const HEADER = ['Plan', 'Allowance', 'Monthly price (USD)', 'Yearly price (USD)'];
const SUMMARY = 'Summary';
const SUMMARY_HEADER = ['Category', 'Plan', 'Monthly price (USD)'];
const AUTHOR = 'Acme ops agent';
/** The dates the workbook records, fixed so the same sheet gives the same bytes. */
const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');
/** 1980-01-01 00:00 in MS-DOS format, the earliest time a zip entry holds: day 1, month 1, year 1980. */
const DOS_DATE = 0x21;
const DOS_TIME = 0;

if (process.argv[2] === '--check') {
  process.exitCode = await check(process.argv[3], process.argv.slice(4));
} else {
  process.stdout.write(`${await respond(readInstruction(), readHistory())}\n`);
}

/** Answers one instruction and returns the reply. */
async function respond(instruction, history) {
  const intent = intentOf(instruction);
  if (intent === undefined) {
    return 'I build a price sheet from catalog.csv, and I add a Summary sheet to it. Ask me for one of the two.';
  }
  const path = workbookOf(instruction, history);
  const refused = guard([{ kind: 'write', path }]);
  runtime({ type: 'guard', name: 'no_destructive_ops', verdict: refused.length === 0 ? 'pass' : 'block' });
  if (refused.length > 0) {
    return `I wrote nothing: ${refused.join('; ')}. I write only under ${OUTPUT}/, and I never change another file.`;
  }
  if (intent === 'summary' && !existsSync(path)) {
    return `I cannot find ${path} in the workspace, so there is no workbook to add a Summary sheet to. Ask me to build the price sheet first.`;
  }
  const catalog = readCatalog();
  if (catalog.problem !== undefined) return catalog.problem;

  const { default: ExcelJS } = await import('exceljs');
  runtime({ type: 'skill', name: 'xlsx' });
  if (intent === 'build') {
    const sheets = await buildSheet(ExcelJS, catalog.plans, path);
    runtime({ type: 'stage', name: 'build_sheet' });
    const result = runCheck(path, sheets);
    return [
      `I built ${path} from ${catalog.source}. It has the sheets ${joined(sheets)}, one row per plan in catalog order, with the columns ${joined(HEADER)}.`,
      'The yearly price is a formula on every row, =C2*12 on the first one.',
      result,
    ].join(' ');
  }
  const { sheets, cheapest } = await addSummary(ExcelJS, catalog.plans, path);
  runtime({ type: 'stage', name: 'add_summary' });
  const result = runCheck(path, sheets);
  const rows = cheapest.map(
    ({ category, plan }) => `${category}, ${plan.name} at ${plan.monthly} USD a month`,
  );
  return [
    `I added the sheet ${SUMMARY} to ${path} with the cheapest plan of each category: ${rows.join('; ')}.`,
    `The workbook now has the sheets ${joined(sheets)}.`,
    result,
  ].join(' ');
}

/** What the instruction asks for: a summary, a price sheet, or neither. */
function intentOf(instruction) {
  if (/\bsummary\b/i.test(instruction)) return 'summary';
  if (/\bprice sheet\b/i.test(instruction)) return 'build';
  return undefined;
}

/** The workbook the instruction names, else the last one the conversation named, else the default. */
function workbookOf(instruction, history) {
  const named = lastWorkbook(instruction);
  if (named !== undefined) return named;
  for (const message of [...history].reverse()) {
    const found = typeof message?.content === 'string' ? lastWorkbook(message.content) : undefined;
    if (found !== undefined) return found;
  }
  return WORKBOOK;
}

function lastWorkbook(text) {
  return text.match(/[\w./-]+\.xlsx\b/g)?.at(-1);
}

/**
 * The guard no_destructive_ops, on the plan, before anything is written: a write must stay under out/
 * and must not pass through a symbolic link, which could reach past the workspace. Returns why it
 * refused each step; an empty list is a pass.
 */
function guard(plan) {
  const refused = [];
  for (const step of plan) {
    const normal = posix.normalize(step.path);
    if (posix.isAbsolute(normal) || !normal.startsWith(`${OUTPUT}/`)) {
      refused.push(`${step.path} is not under ${OUTPUT}/`);
    } else if (linkOnTheWay(normal)) {
      refused.push(`${step.path} passes through a symbolic link`);
    }
  }
  return refused;
}

function linkOnTheWay(path) {
  const parts = path.split('/');
  for (let end = 1; end <= parts.length; end++) {
    if (lstatSync(parts.slice(0, end).join('/'), { throwIfNoEntry: false })?.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * The plans of the catalog in file order, with the file they came from, or a problem that says why there
 * are none: catalog.csv when it exists, else catalog.json when that exists.
 */
function readCatalog() {
  if (!existsSync(CATALOG) && existsSync(CATALOG_JSON)) return readJsonCatalog();
  if (!existsSync(CATALOG)) {
    return { problem: `I cannot find ${CATALOG} in the workspace, so I have no plans for a price sheet.` };
  }
  const lines = readFileSync(CATALOG, 'utf8').split(/\r?\n/);
  const columns = cellsOf(lines[0] ?? '');
  const at = Object.fromEntries(columns.map((name, index) => [name.trim(), index]));
  const missing = ['name', 'category', 'allowance', 'monthly_usd'].filter((name) => at[name] === undefined);
  if (missing.length > 0) {
    return { problem: `${CATALOG} has no column ${joined(missing)}, so I did not build the price sheet.` };
  }
  const plans = [];
  for (const [index, line] of lines.entries()) {
    if (index === 0 || line.trim() === '') continue;
    const cells = cellsOf(line);
    const price = (cells[at.monthly_usd] ?? '').trim();
    const monthly = Number(price);
    const category = (cells[at.category] ?? '').trim();
    if (price === '' || !Number.isFinite(monthly) || category === '') {
      const what = category === '' ? 'no category' : 'no number in monthly_usd';
      return { problem: `Line ${index + 1} of ${CATALOG} has ${what}, so I did not build the price sheet.` };
    }
    plans.push({ name: cells[at.name] ?? '', category, allowance: cells[at.allowance] ?? '', monthly });
  }
  if (plans.length === 0) {
    return { problem: `${CATALOG} lists no plan, so I did not build the price sheet.` };
  }
  return { plans, source: CATALOG };
}

/** The plans of catalog.json in list order, or a problem that says why there are none. */
function readJsonCatalog() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CATALOG_JSON, 'utf8'));
  } catch (error) {
    return {
      problem: `${CATALOG_JSON} is not valid JSON (${messageOf(error)}), so I did not build the price sheet.`,
    };
  }
  const records = Array.isArray(parsed?.plans) ? parsed.plans : undefined;
  if (records === undefined) {
    return { problem: `${CATALOG_JSON} holds no list under plans, so I did not build the price sheet.` };
  }
  const plans = [];
  for (const [index, record] of records.entries()) {
    const price = String(record?.monthly_usd ?? '').trim();
    const monthly = Number(price);
    const category = String(record?.category ?? '').trim();
    if (price === '' || !Number.isFinite(monthly) || category === '') {
      const what = category === '' ? 'no category' : 'no number in monthly_usd';
      return {
        problem: `Plan ${index + 1} of ${CATALOG_JSON} has ${what}, so I did not build the price sheet.`,
      };
    }
    plans.push({
      name: String(record.name ?? ''),
      category,
      allowance: String(record.allowance ?? ''),
      monthly,
    });
  }
  if (plans.length === 0) {
    return { problem: `${CATALOG_JSON} lists no plan, so I did not build the price sheet.` };
  }
  return { plans, source: CATALOG_JSON };
}

/** The cells of one CSV line: commas split, double quotes group, two double quotes in a group are one. */
function cellsOf(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted && char === '"' && line[index + 1] === '"') {
      cell += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/** Plans by category, in the order the categories first appear in the catalog. */
function byCategory(plans) {
  const groups = new Map();
  for (const plan of plans) groups.set(plan.category, [...(groups.get(plan.category) ?? []), plan]);
  return groups;
}

/** The sheet name of a category: mobile gives Mobile. */
function title(category) {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

async function buildSheet(ExcelJS, plans, path) {
  const workbook = new ExcelJS.Workbook();
  for (const [category, rows] of byCategory(plans)) {
    const sheet = workbook.addWorksheet(title(category));
    sheet.addRow(HEADER);
    rows.forEach((plan, index) => {
      const row = index + 2;
      sheet.addRow([
        plan.name,
        plan.allowance,
        plan.monthly,
        { formula: `C${row}*12`, result: plan.monthly * 12 },
      ]);
    });
  }
  await save(workbook, path);
  return workbook.worksheets.map((sheet) => sheet.name);
}

async function addSummary(ExcelJS, plans, path) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync(path));
  const earlier = workbook.getWorksheet(SUMMARY);
  if (earlier !== undefined) workbook.removeWorksheet(earlier.id);
  const sheet = workbook.addWorksheet(SUMMARY);
  sheet.addRow(SUMMARY_HEADER);
  const cheapest = [];
  for (const [category, rows] of byCategory(plans)) {
    const plan = rows.reduce((best, each) => (each.monthly < best.monthly ? each : best));
    sheet.addRow([title(category), plan.name, plan.monthly]);
    cheapest.push({ category: title(category), plan });
  }
  await save(workbook, path);
  return { sheets: workbook.worksheets.map((each) => each.name), cheapest };
}

/** Writes the workbook with fixed dates and zip times, so the same content gives the same bytes. */
async function save(workbook, path) {
  workbook.creator = AUTHOR;
  workbook.lastModifiedBy = AUTHOR;
  workbook.created = FIXED_DATE;
  workbook.modified = FIXED_DATE;
  const bytes = withFixedZipTimes(Buffer.from(await workbook.xlsx.writeBuffer()));
  mkdirSync(posix.dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/**
 * Sets the time of every zip entry to 1980-01-01 00:00. The zip library stamps each entry with the clock;
 * the time sits in two fields per entry, in its local header and in the central directory.
 */
function withFixedZipTimes(bytes) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('the workbook is not a zip file: no end of central directory');
  const entries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let entry = 0; entry < entries; entry++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('the workbook has a broken zip directory');
    bytes.writeUInt16LE(DOS_TIME, offset + 12);
    bytes.writeUInt16LE(DOS_DATE, offset + 14);
    const local = bytes.readUInt32LE(offset + 42);
    if (bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('the workbook has a broken zip entry');
    bytes.writeUInt16LE(DOS_TIME, local + 10);
    bytes.writeUInt16LE(DOS_DATE, local + 12);
    offset +=
      46 +
      bytes.readUInt16LE(offset + 28) +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
  }
  return bytes;
}

/** Runs the one command of the block: this script with --check, which reads the workbook back. */
function runCheck(path, sheets) {
  const command = ['node', basename(SELF), '--check', path, ...sheets].join(' ');
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const ran = spawnSync(process.execPath, [SELF, '--check', path, ...sheets], { encoding: 'utf8' });
  const exitCode = ran.status ?? 1;
  record(process.env.DRIFTBENCH_COMMANDS_FILE, {
    command,
    exitCode,
    startedAt,
    latencyMs: Math.round(performance.now() - started),
  });
  const said = (ran.error?.message ?? (ran.stdout || ran.stderr) ?? '').trim();
  return exitCode === 0
    ? `I read it back to check it: ${said}.`
    : `I read it back to check it, and the check failed with exit code ${exitCode}: ${said}.`;
}

/** --check: the workbook opens, each named sheet has rows under its header, and no cell holds an error. */
async function check(path, sheets) {
  if (path === undefined) {
    process.stderr.write('Usage: node agent.mjs --check <workbook.xlsx> [sheet ...]\n');
    return 2;
  }
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(readFileSync(path));
  } catch (error) {
    process.stdout.write(`${path} does not open as a workbook (${messageOf(error)})\n`);
    return 1;
  }
  const found = [];
  const problems = [];
  for (const name of sheets) {
    const sheet = workbook.getWorksheet(name);
    if (sheet === undefined) {
      problems.push(`no sheet ${name}`);
      continue;
    }
    const rows = Math.max(sheet.actualRowCount - 1, 0);
    if (rows === 0) problems.push(`no row under the header of ${name}`);
    found.push(`${name} ${rows} ${rows === 1 ? 'row' : 'rows'}`);
  }
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value;
        if (value !== null && typeof value === 'object' && 'error' in value) {
          problems.push(`${sheet.name}!${cell.address} holds ${value.error}`);
        }
      });
    });
  });
  if (problems.length > 0) {
    process.stdout.write(`${path} has ${problems.join(', ')}\n`);
    return 1;
  }
  process.stdout.write(`${[...found, 'no error cell'].join(', ')}\n`);
  return 0;
}

function readInstruction() {
  const file = process.argv[2] ?? process.env.DRIFTBENCH_STIMULUS_FILE;
  return readFileSync(file ?? 0, 'utf8');
}

/** The session history the adapter wrote, a JSON list of messages; empty when there is none. */
function readHistory() {
  const file = process.env.DRIFTBENCH_HISTORY_FILE;
  if (file === undefined || !existsSync(file)) return [];
  const history = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(history) ? history : [];
}

function runtime(event) {
  record(process.env.DRIFTBENCH_RUNTIME_FILE, event);
}

/** Appends one JSON line to a protocol file, when the adapter named one. */
function record(file, entry) {
  if (file) appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

/** Names as a sentence lists them: A, B and C. */
function joined(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
