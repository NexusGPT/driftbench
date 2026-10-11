/**
 * A small XML reader for the parts of an Office file: elements, attributes, text, entities, CDATA,
 * comments and processing instructions. Names keep the prefix they were written with (`w:p`); the
 * lookups below match the local name, since a producer may pick other prefixes for the same namespace.
 */

export type XmlElement = {
  /** The name as written, prefix included, such as `w:p`. */
  readonly name: string;
  /** The name without its prefix, such as `p`. */
  readonly local: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
};

export type XmlNode = XmlElement | string;

type OpenElement = { name: string; local: string; attrs: Record<string, string>; children: XmlNode[] };

export class XmlError extends Error {}

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Replaces the five named entities and numeric character references. Unknown entities stay as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

/** Parses one XML document and returns its root element. Throws an XmlError on malformed input. */
export function parseXml(source: string): XmlElement {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const roots: OpenElement[] = [];
  const stack: OpenElement[] = [];
  const attach = (element: OpenElement): void => {
    const parent = stack.at(-1);
    if (parent) parent.children.push(element);
    else roots.push(element);
  };
  const addText = (value: string): void => {
    const parent = stack.at(-1);
    if (parent && value.length > 0) parent.children.push(value);
  };
  const closing = (marker: string, from: number, what: string): number => {
    const end = text.indexOf(marker, from);
    if (end === -1) throw new XmlError(`unclosed ${what} at offset ${from}`);
    return end;
  };

  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      addText(decodeEntities(text.slice(i)));
      break;
    }
    if (lt > i) addText(decodeEntities(text.slice(i, lt)));

    if (text.startsWith('<!--', lt)) {
      i = closing('-->', lt + 4, 'comment') + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = closing(']]>', lt + 9, 'CDATA section');
      addText(text.slice(lt + 9, end));
      i = end + 3;
    } else if (text.startsWith('<?', lt)) {
      i = closing('?>', lt + 2, 'processing instruction') + 2;
    } else if (text.startsWith('<!', lt)) {
      const bracket = text.indexOf('[', lt);
      const gt = closing('>', lt, 'declaration');
      i =
        bracket !== -1 && bracket < gt
          ? closing('>', closing(']', bracket, 'declaration'), 'declaration') + 1
          : gt + 1;
    } else if (text[lt + 1] === '/') {
      const gt = closing('>', lt, 'closing tag');
      const name = text.slice(lt + 2, gt).trim();
      const open = stack.pop();
      if (!open || open.name !== name) {
        throw new XmlError(`unexpected </${name}> at offset ${lt}${open ? `, <${open.name}> is open` : ''}`);
      }
      attach(open);
      i = gt + 1;
    } else {
      i = readTag(text, lt, stack, attach);
    }
  }

  const open = stack.at(-1);
  if (open) throw new XmlError(`<${open.name}> is never closed`);
  const [root, ...extra] = roots;
  if (!root) throw new XmlError('no root element');
  if (extra.length > 0) throw new XmlError('more than one root element');
  return root;
}

/** Reads one opening tag starting at `lt`, pushes or attaches its element, and returns the offset after it. */
function readTag(
  text: string,
  lt: number,
  stack: OpenElement[],
  attach: (element: OpenElement) => void,
): number {
  let j = lt + 1;
  while (j < text.length && !isSpace(text[j]) && text[j] !== '>' && text[j] !== '/') j++;
  const name = text.slice(lt + 1, j);
  if (name.length === 0) throw new XmlError(`a tag without a name at offset ${lt}`);
  const attrs: Record<string, string> = {};
  for (;;) {
    while (isSpace(text[j])) j++;
    if (j >= text.length) throw new XmlError(`<${name}> is not closed at offset ${lt}`);
    if (text[j] === '>') {
      stack.push(element(name, attrs));
      return j + 1;
    }
    if (text[j] === '/' && text[j + 1] === '>') {
      attach(element(name, attrs));
      return j + 2;
    }
    const start = j;
    while (j < text.length && !isSpace(text[j]) && text[j] !== '=' && text[j] !== '>' && text[j] !== '/') j++;
    const attribute = text.slice(start, j);
    while (isSpace(text[j])) j++;
    if (attribute.length === 0 || text[j] !== '=') {
      throw new XmlError(`attribute "${attribute}" of <${name}> has no value at offset ${start}`);
    }
    j++;
    while (isSpace(text[j])) j++;
    const quote = text[j];
    if (quote !== '"' && quote !== "'")
      throw new XmlError(`attribute "${attribute}" is not quoted at offset ${j}`);
    const end = text.indexOf(quote, j + 1);
    if (end === -1) throw new XmlError(`attribute "${attribute}" is not closed at offset ${j}`);
    attrs[attribute] = decodeEntities(text.slice(j + 1, end));
    j = end + 1;
  }
}

function element(name: string, attrs: Record<string, string>): OpenElement {
  return { name, local: localName(name), attrs, children: [] };
}

function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** The element children, all of them or those with this local name. */
export function childElements(parent: XmlElement, local?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const node of parent.children) {
    if (typeof node !== 'string' && (local === undefined || node.local === local)) out.push(node);
  }
  return out;
}

/** The first element child with this local name. */
export function childElement(parent: XmlElement | undefined, local: string): XmlElement | undefined {
  if (!parent) return undefined;
  for (const node of parent.children) {
    if (typeof node !== 'string' && node.local === local) return node;
  }
  return undefined;
}

/** Every descendant element with this local name, in document order. */
export function descendants(parent: XmlElement, local: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement): void => {
    for (const child of node.children) {
      if (typeof child === 'string') continue;
      if (child.local === local) out.push(child);
      walk(child);
    }
  };
  walk(parent);
  return out;
}

/**
 * An attribute by local name. `prefixed: true` takes only a prefixed one (`r:id`), `false` only an
 * unprefixed one (`id`); without it, the first attribute with that local name.
 */
export function attribute(
  node: XmlElement | undefined,
  local: string,
  prefixed?: boolean,
): string | undefined {
  if (!node) return undefined;
  for (const [name, value] of Object.entries(node.attrs)) {
    const colon = name.indexOf(':');
    if ((colon === -1 ? name : name.slice(colon + 1)) !== local) continue;
    const hasPrefix = colon !== -1;
    if (prefixed === undefined || prefixed === hasPrefix) return value;
  }
  return undefined;
}
