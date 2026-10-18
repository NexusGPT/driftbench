import type JSZip from 'jszip';
import {
  countHolds,
  describeCount,
  invalid,
  mapping,
  missing,
  optionalInteger,
  parseCount,
  parseOrder,
  requiredList,
} from './args';
import { describeAssertion, holds, listed, parseAssertion, parseAssertions } from './assertion';
import {
  type CheckTable,
  type KindReader,
  type Outcome,
  outcome,
  ownBuffer,
  ReaderDocument,
  type StructureCheck,
  unreadable,
} from './document';
import { matchList } from './match';
import { mainPart, readXmlPart, relationships } from './opc';
import { contains, notContains, regex, squash, TEXT_CHECKS, textEqual } from './text';
import { attribute, childElement, childElements, descendants, type XmlElement } from './xml';

/**
 * The pptx reader. Slides are read in the order of the presentation's slide list (never by file
 * name); a slide's title is the text of its title placeholder (`title` or `ctrTitle`), its text every
 * paragraph of the slide in document order, tables and groups included. Speaker notes are not read.
 */

export type Slide = { readonly number: number; readonly title?: string; readonly text: string };
export type PptxData = { readonly slides: readonly Slide[] };

const SKIPPED = new Set(['pPr', 'rPr', 'endParaRPr']);

function paragraphText(paragraph: XmlElement): string {
  let out = '';
  const walk = (element: XmlElement): void => {
    for (const child of element.children) {
      if (typeof child === 'string' || SKIPPED.has(child.local)) continue;
      if (child.local === 't') {
        for (const text of child.children) if (typeof text === 'string') out += text;
      } else if (child.local === 'br') {
        out += '\n';
      } else {
        walk(child);
      }
    }
  };
  walk(paragraph);
  return out;
}

function isTitle(shape: XmlElement): boolean {
  const placeholder = childElement(childElement(childElement(shape, 'nvSpPr'), 'nvPr'), 'ph');
  const type = attribute(placeholder, 'type');
  return type === 'title' || type === 'ctrTitle';
}

async function readSlide(zip: JSZip, part: string, number: number): Promise<Slide> {
  const root = await readXmlPart(zip, part);
  if (!root) throw new Error(`slide ${number} names the part ${part}, which is missing`);
  const titleShape = descendants(root, 'sp').find(isTitle);
  const title = titleShape ? squash(descendants(titleShape, 'p').map(paragraphText).join(' ')) : '';
  const text = descendants(root, 'p')
    .map(paragraphText)
    .filter((line) => line.trim() !== '')
    .join('\n');
  return title === '' ? { number, text } : { number, title, text };
}

async function readDeck(zip: JSZip): Promise<PptxData> {
  const presentation = await mainPart(zip, 'ppt/presentation.xml');
  const root = await readXmlPart(zip, presentation);
  if (!root) throw new Error(`no presentation part ${presentation}`);
  const targets = new Map((await relationships(zip, presentation)).map((rel) => [rel.id, rel.target]));
  const parts = childElements(childElement(root, 'sldIdLst') ?? root, 'sldId').map((entry, index) => {
    const id = attribute(entry, 'id', true);
    const target = id === undefined ? undefined : targets.get(id);
    if (!target)
      throw new Error(`slide ${index + 1} has no relationship ${id ?? '(no id)'} in the presentation`);
    return target;
  });
  return { slides: await Promise.all(parts.map((part, index) => readSlide(zip, part, index + 1))) };
}

/** The text a judge reads: each slide under a marker that names it. */
export function renderDeck(data: PptxData): string {
  return data.slides
    .map((slide) => `[slide ${slide.number} of ${data.slides.length}]\n${slide.text}`)
    .join('\n\n');
}

function showTitle(slide: Slide): string {
  return slide.title === undefined ? '(no title)' : JSON.stringify(slide.title);
}

const slideCount: StructureCheck<PptxData> = {
  reads: 'structure',
  usage: 'slide_count: 5 or slide_count: { min: 3, max: 8 }',
  run(arg, data) {
    const count = parseCount(arg, 'a slide count');
    const found = data.slides.length;
    const ok = countHolds(count, found);
    return {
      ok,
      evidence: `${found} ${found === 1 ? 'slide' : 'slides'}${ok ? '' : `, expected ${describeCount(count)}`}`,
    };
  },
};

const titles: StructureCheck<PptxData> = {
  reads: 'structure',
  usage: 'titles: [Agenda, Pricing] or titles: { values: [...], order: in_order | exact | any_order }',
  run(arg, data) {
    const map = Array.isArray(arg) ? { values: arg } : mapping(arg, ['values', 'order']);
    const values = parseAssertions(requiredList(map, 'values'), 'title');
    const order = parseOrder(map.order, 'in_order');
    const problems = matchList(
      values,
      data.slides,
      order,
      (want, slide) => holds(want, { present: slide.title !== undefined, value: slide.title }, textEqual),
      showTitle,
    );
    return outcome(`titles ${listed(data.slides.map(showTitle), 30)}`, problems);
  },
};

const slide: StructureCheck<PptxData> = {
  reads: 'structure',
  usage: 'slide: { number: 2, title: Pricing, contains: [...], not_contains: [...], regex: "..." }',
  run(arg, data) {
    const map = mapping(arg, ['number', 'title', 'contains', 'not_contains', 'regex']);
    const number = optionalInteger(map, 'number', 1);
    if (number === undefined) invalid('needs number, counting from 1');
    const found = data.slides[number - 1];
    if (!found) missing(`no slide ${number}: the deck holds ${data.slides.length} slides`);
    const parts = [`slide ${number} of ${data.slides.length}, title ${showTitle(found)}`];
    const problems: string[] = [];
    if (map.title !== undefined) {
      const want = parseAssertion(map.title, 'title');
      if (!holds(want, { present: found.title !== undefined, value: found.title }, textEqual)) {
        problems.push(`expected the title ${describeAssertion(want)}`);
      }
    }
    const sub: [unknown, { run(arg: unknown, text: string): Outcome }][] = [
      [map.contains, contains],
      [map.not_contains, notContains],
      [map.regex, regex],
    ];
    for (const [value, check] of sub) {
      if (value === undefined) continue;
      const result = check.run(value, found.text);
      if (result.ok) parts.push(result.evidence);
      else problems.push(result.evidence);
    }
    return outcome(parts.join('; '), problems);
  },
};

export const PPTX_CHECKS: CheckTable<PptxData> = {
  slide_count: slideCount,
  titles,
  slide,
  ...TEXT_CHECKS,
};

export const pptxReader: KindReader = {
  kind: 'pptx',
  checkNames: Object.keys(PPTX_CHECKS),
  async open(bytes, path) {
    // jszip loads when the first deck opens, not when this package does.
    const { default: Zip } = await import('jszip');
    try {
      const data = await readDeck(await Zip.loadAsync(ownBuffer(bytes)));
      return new ReaderDocument<PptxData>('pptx', path, renderDeck(data), PPTX_CHECKS, data);
    } catch (cause) {
      return unreadable('pptx', path, PPTX_CHECKS, cause);
    }
  },
};
