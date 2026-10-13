import {
  type Check,
  type CheckContext,
  machineVerdict,
  type Observed,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import {
  bestScore,
  confidentLanguage,
  DETECT_DEFAULTS,
  type Detection,
  type DetectOptions,
  detect,
  detectorLoaded,
  functionWordVote,
  isConsistent,
  loadDetector,
  toDetectorCode,
  topLanguage,
} from '../support/language';
import { quote, type TextSegment, textSegments } from '../support/text';
import { plural } from '../support/values';

const NAME = 'lang';

type Judged = TextSegment & { detection: Detection };

/**
 * The language of the reply. `expect.lang` asks every text segment of the block to read as that language;
 * `rules.lang_stable` asks every text segment to read as the language the run settled on, which is the
 * first reply the detector is sure of, in this block or an earlier one.
 *
 * Detection is franc-min, read the way support/language.ts explains: a segment under 30 letters is too
 * short to judge and is skipped. When no segment of the block can be judged, or the detector has no
 * model for the expected language, the verdict is inconclusive and does not gate: the detector, not the
 * agent, is what could not decide.
 */
export function createLangCheck(options: Partial<DetectOptions> = {}): Check {
  const settings: DetectOptions = { ...DETECT_DEFAULTS, ...options };
  return {
    name: NAME,
    applies: (ctx) => ctx.expect.lang !== undefined || ctx.spec.rules?.lang_stable === true,
    evaluate(ctx) {
      // The first lang check loads the detector; every later one runs synchronously, as before.
      return detectorLoaded()
        ? judgeBlock(ctx, settings)
        : loadDetector().then(() => judgeBlock(ctx, settings));
    },
  };
}

function judgeBlock(ctx: CheckContext, settings: DetectOptions): Verdict[] {
  const verdicts: Verdict[] = [];
  const segments = judge(ctx.observed, settings);
  if (ctx.expect.lang !== undefined) verdicts.push(expected(ctx.expect.lang, segments, settings));
  if (ctx.spec.rules?.lang_stable === true) verdicts.push(stable(ctx, segments, settings));
  return verdicts;
}

export const lang: Check = createLangCheck();

function judge(observed: Observed, settings: DetectOptions): Judged[] {
  return textSegments(observed).map((segment) => ({ ...segment, detection: detect(segment.text, settings) }));
}

function expected(code: string, all: Judged[], settings: DetectOptions): Verdict {
  const target = toDetectorCode(code);
  if (target === undefined) {
    return inconclusive('expected', `the detector has no model for the language ${code}`);
  }
  const judged = all.filter((segment) => segment.detection.readings.length > 0);
  if (judged.length === 0) return inconclusive('expected', tooShort(all, settings));
  const off = judged.filter((segment) => !consistent(segment, target, settings));
  if (off.length > 0) {
    const lines = off.map(
      (segment) =>
        `segment ${segment.index} reads as ${topLanguage(segment.detection)}, not ${target} (${target} scores ${bestScore(segment.detection, target).toFixed(2)} at best): ${quote(segment.text)}`,
    );
    return machineVerdict(NAME, 'expected', 'fail', `${code} expected; ${lines.join('; ')}`);
  }
  return machineVerdict(
    NAME,
    'expected',
    'pass',
    `${plural(judged.length, 'text segment')} read as ${target} (${code})${skipped(all)}`,
  );
}

function stable(ctx: CheckContext, all: Judged[], settings: DetectOptions): Verdict {
  const reference = referenceLanguage(ctx, all, settings);
  const judged = all.filter((segment) => segment.detection.readings.length > 0);
  if (reference === undefined) {
    return inconclusive(
      'stable',
      'the detector is sure of the language of no reply in the run so far, so there is no language to keep yet',
    );
  }
  if (judged.length === 0) return inconclusive('stable', tooShort(all, settings));
  const off = judged.filter((segment) => !consistent(segment, reference.code, settings));
  const since = `the run speaks ${reference.code} since block ${reference.block} (${reference.quote})`;
  if (off.length > 0) {
    const lines = off.map(
      (segment) =>
        `segment ${segment.index} reads as ${topLanguage(segment.detection)}: ${quote(segment.text)}`,
    );
    return machineVerdict(NAME, 'stable', 'fail', `${lines.join('; ')}; ${since}`);
  }
  return machineVerdict(
    NAME,
    'stable',
    'pass',
    `the reply stays in ${reference.code}; ${since}${skipped(all)}`,
  );
}

/** The first text segment of the run whose language the detector is sure of: earlier blocks first. */
function referenceLanguage(
  ctx: CheckContext,
  current: Judged[],
  settings: DetectOptions,
): { code: string; block: number; quote: string } | undefined {
  for (const block of ctx.history) {
    for (const segment of judge(block.observed, settings)) {
      const code = confidentLanguage(segment.detection, settings);
      if (code) return { code, block: block.index, quote: quote(segment.text, 40) };
    }
  }
  for (const segment of current) {
    const code = confidentLanguage(segment.detection, settings);
    if (code) return { code, block: ctx.blockIndex, quote: quote(segment.text, 40) };
  }
  return undefined;
}

/** A segment is consistent with `code` when the detector puts it within the margin, or its function words say so. */
function consistent(segment: Judged, code: string, settings: DetectOptions): boolean {
  return isConsistent(segment.detection, code, settings) || functionWordVote(segment.text, code);
}

function tooShort(all: Judged[], settings: DetectOptions): string {
  if (all.length === 0) return 'the block has no text segment';
  const sizes = all.map((segment) => `segment ${segment.index}: ${segment.detection.letters} letters`);
  return `no text segment has ${settings.minLetters} letters or more, too short to tell its language (${sizes.join(', ')})`;
}

function skipped(all: Judged[]): string {
  const short = all.filter((segment) => segment.detection.readings.length === 0).length;
  return short === 0 ? '' : `; ${plural(short, 'segment')} too short to judge`;
}

function inconclusive(id: string, evidence: string): Verdict {
  return machineVerdict(NAME, id, 'inconclusive', evidence, { gating: false });
}
