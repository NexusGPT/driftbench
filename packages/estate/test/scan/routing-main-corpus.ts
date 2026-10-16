/** Fresh precision corpus: table roles, target syntax, prose attributes and counterexamples. */
export const mainRouteDeclarations = {
  '.claude/skills/tidal-review/SKILL.md': '---\nname: tidal-review\n---\n',
  '.claude/skills/grove-map/SKILL.md': '---\nname: grove-map\n---\n',
  '.claude/agents/sound-reader.md': '---\nname: sound-reader\n---\n',
};
export type MainRouteCase = {
  name: string;
  table: string;
  routes: Array<[string, string]>;
  ambiguous: boolean;
};
const t = (
  name: string,
  headers: string[],
  rows: string[][],
  routes: Array<[string, string]> = [],
  ambiguous = false,
): MainRouteCase => ({
  name,
  table: [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n'),
  routes,
  ambiguous,
});
export const mainRoutingCorpus: MainRouteCase[] = [
  t(
    'repeated short nominal labels stay inventory',
    ['Resource', 'Category'],
    [
      ['`tidal-review`', 'Test protocol'],
      ['`grove-map`', 'Test protocol'],
    ],
  ),
  t(
    'repeated determined-object requests stay routes',
    ['Resource', 'Request'],
    [
      ['`tidal-review`', 'Calibrate the gauges'],
      ['`grove-map`', 'Calibrate the gauges'],
    ],
    [
      ['Calibrate the gauges', 'tidal-review'],
      ['Calibrate the gauges', 'grove-map'],
    ],
  ),

  // Reviewed shapes: preserve main's selected targets regardless of trailing prose.
  t(
    'review skill with required suffix',
    ['Request', 'Resource'],
    [['Inspect a welded seam', '`tidal-review` is required for this request']],
    [['Inspect a welded seam', 'tidal-review']],
  ),
  t(
    'review helper with selected suffix',
    ['Request', 'Resource'],
    [['Inspect a welded seam', '`sound-reader` is selected for this request']],
    [['Inspect a welded seam', 'sound-reader']],
  ),
  t(
    'review passive primary plus fallback',
    ['Request', 'Primary', 'Fallback'],
    [['Inspect a welded seam', '`tidal-review` is used to check this weld', '`grove-map`']],
    [
      ['Inspect a welded seam', 'tidal-review'],
      ['Inspect a welded seam', 'grove-map'],
    ],
  ),
  t(
    'review nominal description is no request',
    ['Resource', 'Description'],
    [['`tidal-review`', 'documentation the inspectors consult during audits']],
  ),
  t(
    'review short imperative without determiner',
    ['Resource', 'Request'],
    [['`tidal-review`', 'Inspect valves']],
    [['Inspect valves', 'tidal-review']],
  ),
  // Additional independent shapes, including noun/verb homographs with relative clauses.
  t(
    'selected skill with perfect passive',
    ['Request', 'Resource'],
    [['Validate the test coupon', '`tidal-review` has been selected by the planner']],
    [['Validate the test coupon', 'tidal-review']],
  ),
  t(
    'selected helper with past passive',
    ['Request', 'Resource'],
    [['Review the machining notes', '`sound-reader` was assigned to this work']],
    [['Review the machining notes', 'sound-reader']],
  ),
  t(
    'two selected units with passive annotations',
    ['Request', 'Resources'],
    [['Compare coupon measurements', '`tidal-review` is required; `grove-map` is consulted afterwards']],
    [
      ['Compare coupon measurements', 'tidal-review'],
      ['Compare coupon measurements', 'grove-map'],
    ],
  ),
  t(
    'parenthesized passive explanation',
    ['Request', 'Resource'],
    [['Validate the test coupon', '`tidal-review` (this is selected after visual review)']],
    [['Validate the test coupon', 'tidal-review']],
  ),
  t(
    'reverse bare calibration imperative',
    ['Resource', 'Request'],
    [['`tidal-review`', 'Calibrate gauges']],
    [['Calibrate gauges', 'tidal-review']],
  ),
  t(
    'reverse bare replacement imperative',
    ['Resource', 'Request'],
    [['`tidal-review`', 'Replace seals']],
    [['Replace seals', 'tidal-review']],
  ),
  t(
    'reverse adjective homograph imperative',
    ['Resource', 'Request'],
    [['`tidal-review`', 'Clean filters']],
    [['Clean filters', 'tidal-review']],
  ),
  t(
    'reverse noun homograph imperative',
    ['Resource', 'Request'],
    [['`tidal-review`', 'Measure wall thickness']],
    [['Measure wall thickness', 'tidal-review']],
  ),
  t(
    'reverse nominal reference with relative predicate',
    ['Resource', 'Description'],
    [['`tidal-review`', 'reference the engineers use for traceability']],
  ),
  t(
    'reverse nominal guide with relative predicate',
    ['Resource', 'Description'],
    [['`tidal-review`', 'guide the trainees consult before work']],
  ),
  t(
    'reverse nominal report with relative predicate',
    ['Resource', 'Description'],
    [['`tidal-review`', 'report the machinists publish after inspection']],
  ),
  t(
    'reverse descriptive noun with determiner complement',
    ['Resource', 'Description'],
    [['`tidal-review`', 'protocol the crew follows for inspection']],
  ),
  t(
    'reverse temporal subordinate condition',
    ['Resource', 'Condition'],
    [['`tidal-review`', 'When a coupon has failed the pressure test']],
    [['When a coupon has failed the pressure test', 'tidal-review']],
  ),
  t(
    'reverse conditional damaged object',
    ['Resource', 'Condition'],
    [['`tidal-review`', 'If a gauge is damaged']],
    [['If a gauge is damaged', 'tidal-review']],
  ),
  t(
    'reverse exception condition',
    ['Resource', 'Condition'],
    [['`tidal-review`', 'Unless the enclosure is locked']],
    [['Unless the enclosure is locked', 'tidal-review']],
  ),
  t(
    'reverse passive temporal inventory phrase',
    ['Resource', 'Description'],
    [['`tidal-review`', 'When installed during scheduled maintenance']],
  ),

  t(
    'partially declared inventory',
    ['Component', 'Reference'],
    [
      ['`tidal-review`', '[survey catalog](.claude/skills/grove-map/SKILL.md)'],
      ['`legacy-sensor`', '[survey catalog](.claude/skills/grove-map/SKILL.md)'],
    ],
  ),
  t(
    'target followed by finite explanation',
    ['Need', 'Resource'],
    [['Check a freezer alarm', '`tidal-review` handles historical readings automatically']],
    [['Check a freezer alarm', 'tidal-review']],
  ),

  t(
    'ordinary asks',
    ['Intent', 'Implementation'],
    [
      ['Check a cooling unit', '`tidal-review`'],
      ['Map the orchard boundary', '`grove-map`'],
    ],
    [
      ['Check a cooling unit', 'tidal-review'],
      ['Map the orchard boundary', 'grove-map'],
    ],
  ),
  t(
    'unfamiliar request header',
    ['Incoming work', 'Mapped resource'],
    [['Recover the missing crate', '`tidal-review`']],
    [['Recover the missing crate', 'tidal-review']],
  ),
  t(
    'finite request description',
    ['Incident', 'Choice'],
    [['The ventilation system has stopped', '`tidal-review`']],
    [['The ventilation system has stopped', 'tidal-review']],
  ),
  t(
    'nominal request description',
    ['Topic', 'Library'],
    [['equipment reconciliation', '`tidal-review`']],
    [['equipment reconciliation', 'tidal-review']],
  ),
  t(
    'terse imperative',
    ['Activity', 'Library'],
    [['Count crates', '`tidal-review`']],
    [['Count crates', 'tidal-review']],
  ),
  t(
    'French ask',
    ['Demande', 'Choix'],
    [['Comparer les mesures du réservoir', '`tidal-review`']],
    [['Comparer les mesures du réservoir', 'tidal-review']],
  ),
  t(
    'unsegmented Japanese ask',
    ['依頼', '選択'],
    [['冷却装置の測定値を比較する', '`tidal-review`']],
    [['冷却装置の測定値を比較する', 'tidal-review']],
  ),
  t(
    'Arabic ask',
    ['طلب', 'مورد'],
    [['مراجعة مخطط الحديقة الجديد', '`grove-map`']],
    [['مراجعة مخطط الحديقة الجديد', 'grove-map']],
  ),
  t(
    'numeric row ordinal before ask',
    ['Position', 'Incoming work', 'Resource'],
    [['84', 'Inspect a coolant leak', '`tidal-review`']],
    [['Inspect a coolant leak', 'tidal-review']],
  ),
  t(
    'language value before ask',
    ['Locale', 'Incoming work', 'Resource'],
    [
      ['German', 'Inspect a coolant leak', '`tidal-review`'],
      ['Arabic', 'Map the outer fence', '`grove-map`'],
    ],
    [
      ['Inspect a coolant leak', 'tidal-review'],
      ['Map the outer fence', 'grove-map'],
    ],
  ),
  t(
    'two target columns',
    ['Situation', 'First choice', 'Second choice'],
    [['Verify a damaged sensor', '`tidal-review`', '`sound-reader`']],
    [
      ['Verify a damaged sensor', 'tidal-review'],
      ['Verify a damaged sensor', 'sound-reader'],
    ],
  ),
  t(
    'fallback target column',
    ['Situation', 'Primary', 'Fallback'],
    [['Locate a temporary greenhouse', 'not configured', '`grove-map`']],
    [['Locate a temporary greenhouse', 'grove-map']],
  ),
  t(
    'multiple quoted targets',
    ['Need', 'Resources'],
    [['Compare the sensor logs', '`tidal-review` and `grove-map`']],
    [
      ['Compare the sensor logs', 'tidal-review'],
      ['Compare the sensor logs', 'grove-map'],
    ],
  ),
  t(
    'several qualified targets',
    ['Need', 'Resources'],
    [['Compare the sensor logs', '`tidal-review` for records; `sound-reader` for review']],
    [
      ['Compare the sensor logs', 'tidal-review'],
      ['Compare the sensor logs', 'sound-reader'],
    ],
  ),
  t(
    'plain exact skill',
    ['Need', 'Resource'],
    [['Check a freezer alarm', 'tidal-review']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'plain helper designation',
    ['Need', 'Resource'],
    [['Review the inspection log', 'the sound-reader agent']],
    [['Review the inspection log', 'sound-reader']],
  ),
  t(
    'run plus skill',
    ['Need', 'Resource'],
    [['Check a freezer alarm', 'Run `tidal-review`']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'activate plus skill',
    ['Need', 'Resource'],
    [['Check a freezer alarm', 'Activate `tidal-review`']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'apply plus skill',
    ['Need', 'Resource'],
    [['Check a freezer alarm', 'Apply the `tidal-review` skill']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'unlisted verb plus skill',
    ['Need', 'Resource'],
    [['Review the inspection log', 'Entrust this to `sound-reader`']],
    [['Review the inspection log', 'sound-reader']],
  ),
  t(
    'plain verb and unit noun',
    ['Need', 'Resource'],
    [['Check a freezer alarm', 'Activate the tidal-review skill']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'parenthetical after quoted skill',
    ['Need', 'Resource'],
    [['Check a freezer alarm', '`tidal-review` (retain the raw readings)']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'parenthetical after plain skill',
    ['Need', 'Resource'],
    [['Check a freezer alarm', 'tidal-review (retain the raw readings)']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'trailing explanation',
    ['Need', 'Resource'],
    [['Check a freezer alarm', '`tidal-review` because it compares historical readings']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'emdash explanation',
    ['Need', 'Resource'],
    [['Check a freezer alarm', '`tidal-review` — keep the log']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'bold slash command',
    ['Need', 'Resource'],
    [['Check a freezer alarm', '**/tidal-review**']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'code slash command',
    ['Need', 'Resource'],
    [['Check a freezer alarm', '`/tidal-review`']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'link to actual declaration',
    ['Need', 'Resource'],
    [['Check a freezer alarm', '[sensor protocol](.claude/skills/tidal-review/SKILL.md)']],
    [['Check a freezer alarm', 'tidal-review']],
  ),
  t(
    'reversed explicit imperative',
    ['Chosen unit', 'Customer request'],
    [
      ['`tidal-review`', 'Inspect the freezer alarm'],
      ['`grove-map`', 'Recalculate the greenhouse area'],
    ],
    [
      ['Inspect the freezer alarm', 'tidal-review'],
      ['Recalculate the greenhouse area', 'grove-map'],
    ],
  ),
  t(
    'reversed infinitival request',
    ['Chosen unit', 'Customer request'],
    [['`tidal-review`', 'To inspect the freezer alarm']],
    [['To inspect the freezer alarm', 'tidal-review']],
  ),
  t(
    'reversed direct question',
    ['Chosen unit', 'Customer request'],
    [['`tidal-review`', 'Can you compare the thermometer readings?']],
    [['Can you compare the thermometer readings?', 'tidal-review']],
  ),
  t(
    'person values before resource',
    ['Contact', 'Maintained component'],
    [
      ['Nora', '`tidal-review`'],
      ['Emil', '`grove-map`'],
    ],
  ),
  t(
    'numeric values are inventory',
    ['Revision', 'Component'],
    [
      ['19', '`tidal-review`'],
      ['28', '`grove-map`'],
    ],
  ),
  t(
    'languages are inventory',
    ['Language', 'Component'],
    [
      ['Greek', '`tidal-review`'],
      ['Portuguese', '`grove-map`'],
    ],
  ),
  t(
    'free schedule descriptions',
    ['Component', 'Schedule'],
    [
      ['`tidal-review`', 'It refreshes the snapshot every evening'],
      ['`grove-map`', 'It rebuilds the plot after a release'],
    ],
  ),
  t(
    'free history descriptions',
    ['Component', 'History'],
    [
      ['`tidal-review`', 'It was introduced during the winter migration'],
      ['`grove-map`', 'It was adapted from an older survey library'],
    ],
  ),
  t(
    'usage descriptions',
    ['Component', 'Usage'],
    [
      ['`tidal-review`', 'Used only during supervised maintenance'],
      ['`grove-map`', 'Used for offline landscape previews'],
    ],
  ),
  t(
    'dependency descriptions',
    ['Component', 'Dependencies'],
    [
      ['`tidal-review`', 'Depends on a local snapshot archive'],
      ['`grove-map`', 'Relies on the regional coordinate catalog'],
    ],
  ),
  t(
    'prose costs',
    ['Component', 'Cost notes'],
    [
      ['`tidal-review`', 'Costs €18 for each completed inspection'],
      ['`grove-map`', 'Has a monthly allowance of €24'],
    ],
  ),
  t(
    'linked documentation descriptions',
    ['Component', 'Reference'],
    [
      ['`tidal-review`', 'Documented in [the manual](manuals/sensors.md)'],
      ['`grove-map`', 'See [the survey notes](manuals/plots.md) for history'],
    ],
  ),
  t(
    'declaration links as inventory references',
    ['Component', 'Reference'],
    [['`tidal-review`', '[landscape dependency](.claude/skills/grove-map/SKILL.md)']],
  ),
  t(
    'runtime environment prose',
    ['Component', 'Environment'],
    [
      ['`tidal-review`', 'Runs inside the field station container'],
      ['`grove-map`', 'Runs on the survey laptop at the depot'],
    ],
  ),
  t(
    'output descriptions',
    ['Component', 'Output'],
    [
      ['`tidal-review`', 'Produces a compact temperature summary'],
      ['`grove-map`', 'Writes a geometry bundle into the archive'],
    ],
  ),
  t(
    'ownership prose',
    ['Component', 'Stewardship'],
    [
      ['`tidal-review`', 'Maintained by the calibration team'],
      ['`grove-map`', 'Owned by the field mapping group'],
    ],
  ),
  t(
    'descriptive features',
    ['Component', 'Description'],
    [
      ['`tidal-review`', 'A portable viewer for historical sensor readings'],
      ['`grove-map`', 'A small library of regional survey projections'],
    ],
  ),
  t('capability lists', ['Helper', 'Tools'], [['`sound-reader`', '`Read`, `Search`, `Outline`']]),
  t(
    'size attributes',
    ['Component', 'Footprint'],
    [
      ['`tidal-review`', '384 KiB'],
      ['`grove-map`', '768 KiB'],
    ],
  ),
  t(
    'path attributes',
    ['Component', 'Location'],
    [
      ['`tidal-review`', 'src/thermal/reader.ts'],
      ['`grove-map`', 'src/survey/mapper.ts'],
    ],
  ),
  t(
    'categorical attributes',
    ['Component', 'Team'],
    [
      ['`tidal-review`', 'Calibration'],
      ['`grove-map`', 'Landscape'],
    ],
  ),
  t(
    'date attributes',
    ['Component', 'Introduced'],
    [
      ['`tidal-review`', '2029-04-12'],
      ['`grove-map`', '2029-07-19'],
    ],
  ),
  t(
    'URL attributes',
    ['Component', 'Website'],
    [
      ['`tidal-review`', 'https://thermal.example.invalid'],
      ['`grove-map`', 'https://survey.example.invalid'],
    ],
  ),
  t(
    'monetary scalar attributes',
    ['Component', 'Price'],
    [
      ['`tidal-review`', '€32'],
      ['`grove-map`', '€48'],
    ],
  ),
  t(
    'nominal category phrases',
    ['Component', 'Department'],
    [
      ['`tidal-review`', 'Sensor Reliability'],
      ['`grove-map`', 'Landscape Research'],
    ],
  ),
  t(
    'repeated prose categories',
    ['Component', 'Category'],
    [
      ['`tidal-review`', 'regional station support'],
      ['`grove-map`', 'regional station support'],
    ],
  ),
  t(
    'unit mentioned incidentally in prose',
    ['Need', 'Discussion'],
    [['Check a freezer alarm', 'discuss tidal-review with a colleague']],
  ),
  t('negated resource', ['Need', 'Resource'], [['Check a freezer alarm', 'Never load `tidal-review`']]),
  t('unknown declared target', ['Need', 'Resource'], [['Check a freezer alarm', '`not-installed`']]),
  t('undecidable symbolic partner', ['Resource', 'Unresolved'], [['`tidal-review`', '???']], [], true),
];
