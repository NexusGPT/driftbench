import { plantedCut } from '../../kit/planted';
import { headingText, Prose } from '../../kit/words';
import type { ItemContext, Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
/** A seeded value for front matter: a sentence without its full stop. */
const phrase = (p: Prose) => p.next().replace(/\.$/, '');

export const cuttingCapabilityRuns: Record<string, Run> = {
  'footnote-reference-after-stop': (ctx) => {
    const p = prose(ctx);
    const [a, b, c] = [p.next(), p.next(), p.next()];
    return plantedCut(ctx, 'a footnote reference after a full stop', `${a}[^1] ${b}\n\n[^1]: ${c}\n`, [
      { text: `${a}[^1]`, container: 'sentence' },
      { text: b, container: 'sentence' },
      { text: c, container: 'sentence' },
    ]);
  },
  'footnote-definition-path': (ctx) => {
    const p = prose(ctx);
    const head = headingText(p.random);
    const [a, c] = [p.next(), p.next()];
    return plantedCut(ctx, 'the heading path of a footnote definition', `# ${head}\n\n${a}\n\n[^n1]: ${c}\n`, [
      { text: `# ${head}`, container: 'heading', path: [] },
      { text: a, container: 'sentence', path: [head] },
      { text: c, container: 'sentence', path: [head, '[^n1]'] },
    ]);
  },
  'footnote-definition-paragraphs': (ctx) => {
    const p = prose(ctx);
    const [a, c1, c2] = [p.next(), p.next(), p.next()];
    return plantedCut(
      ctx,
      'a footnote definition of two paragraphs',
      `${a}[^2]\n\n[^2]: ${c1}\n\n    ${c2}\n`,
      [
        { text: `${a}[^2]`, container: 'sentence' },
        { text: c1, container: 'sentence' },
        { text: c2, container: 'sentence' },
      ],
    );
  },
  'alert-marker-not-prose': (ctx) => {
    const a = prose(ctx).next();
    return plantedCut(ctx, 'the marker of a GitHub alert', `> [!WARNING]\n> ${a}\n`, [
      { text: a, container: 'block_quote' },
    ]);
  },
  'alert-type-path': (ctx) => {
    const p = prose(ctx);
    const head = headingText(p.random);
    const a = p.next();
    return plantedCut(ctx, 'the heading path of a GitHub alert', `# ${head}\n\n> [!NOTE]\n> ${a}\n`, [
      { text: `# ${head}`, container: 'heading', path: [] },
      { text: a, container: 'block_quote', path: [head, '[!NOTE]'] },
    ]);
  },
  'front-matter-toml': (ctx) => {
    const p = prose(ctx);
    const [v1, v2, v3, v4] = [phrase(p), phrase(p), phrase(p), phrase(p)];
    const b = p.next();
    const text = `+++\ntitle = "${v1}"\ntags = ["${v2}", "${v3}"]\n\n[owner]\nname = "${v4}"\n+++\n\n${b}\n`;
    return plantedCut(ctx, 'TOML front matter', text, [
      { text: v1, container: 'front_matter', yamlPath: ['title'] },
      { text: v2, container: 'front_matter', yamlPath: ['tags', '0'] },
      { text: v3, container: 'front_matter', yamlPath: ['tags', '1'] },
      { text: v4, container: 'front_matter', yamlPath: ['owner', 'name'] },
      { text: b, container: 'sentence' },
    ]);
  },
  'front-matter-json': (ctx) => {
    const p = prose(ctx);
    const [v1, v2, v3] = [phrase(p), phrase(p), phrase(p)];
    const b = p.next();
    const text = `{\n  "title": "${v1}",\n  "tags": ["${v2}"],\n  "owner": { "name": "${v3}" }\n}\n\n${b}\n`;
    return plantedCut(ctx, 'JSON front matter', text, [
      { text: v1, container: 'front_matter', yamlPath: ['title'] },
      { text: v2, container: 'front_matter', yamlPath: ['tags', '0'] },
      { text: v3, container: 'front_matter', yamlPath: ['owner', 'name'] },
      { text: b, container: 'sentence' },
    ]);
  },
  'sentence-terminal-every-script': (ctx) => {
    // Invented words in each script; each full stop has the Sentence_Terminal property, the Tibetan shad has not.
    const scripts: Array<[string, string]> = [
      ['ᠠᠪᠬ ᠭᠯᠮ᠃', 'ᠨᠰᠲ ᠳᠴᠵ᠃'],
      ['ܐܒܓ ܕܗܘ܀', 'ܙܚܛ ܝܟܠ܀'],
      ['ߊߓߔ ߕߖߗ߹', 'ߘߙߚ ߛߜߝ߹'],
      ['ᬅᬓᬕ ᬗᬘ᭟', 'ᬚᬝᬢ ᬤᬦ᭟'],
    ];
    const tibetan = 'ཀཁག་ངཅ། ཆཇཉ་ཏཐ།';
    const text = `${[...scripts.map(([a, b]) => `${a} ${b}`), tibetan].join('\n\n')}\n`;
    return plantedCut(ctx, 'the sentence ends of every script', text, [
      ...scripts.flatMap(([a, b]) => [
        { text: a, container: 'sentence' },
        { text: b, container: 'sentence' },
      ]),
      { text: tibetan, container: 'sentence' },
    ]);
  },
  'thai-no-dictionary': (ctx) => {
    const text = 'ร้านเปิดตอนเช้า ร้านปิดตอนค่ำ';
    return plantedCut(ctx, 'a space in Thai', `${text}\n`, [{ text, container: 'sentence' }]);
  },
  'directive-marker-not-prose': (ctx) => {
    const a = prose(ctx).next();
    return plantedCut(ctx, 'the lines of a container directive', `:::note\n${a}\n:::\n`, [
      { text: a, container: 'sentence' },
    ]);
  },
  'directive-name-path': (ctx) => {
    const p = prose(ctx);
    const head = headingText(p.random);
    const a = p.next();
    return plantedCut(ctx, 'the heading path of a container directive', `# ${head}\n\n:::warning\n${a}\n:::\n`, [
      { text: `# ${head}`, container: 'heading', path: [] },
      { text: a, container: 'sentence', path: [head, 'warning'] },
    ]);
  },
  'math-block-opaque': (ctx) => {
    const b = prose(ctx).next();
    const block = '$$\nx = 1. y = 2. z = x + y.\n$$';
    return plantedCut(ctx, 'a display math block', `${block}\n\n${b}\n`, [
      { text: block, opaque: true },
      { text: b, container: 'sentence' },
    ]);
  },
};
