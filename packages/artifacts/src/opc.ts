import type JSZip from 'jszip';
import { attribute, childElements, parseXml, type XmlElement } from './xml';

/**
 * The package layer of docx and pptx (Open Packaging Conventions): parts inside a zip, tied by
 * relationship files. The main part and the slides are found through relationships, never by file
 * name, so a renamed or reordered part is still read in the order the document declares.
 */

export type Relationship = { id: string; type: string; target: string };

export async function readXmlPart(zip: JSZip, path: string): Promise<XmlElement | undefined> {
  const file = zip.file(path);
  return file ? parseXml(await file.async('string')) : undefined;
}

/** Resolves a relationship target against the folder of the part that declares it. */
export function resolvePart(folder: string, target: string): string {
  const parts = target.startsWith('/') ? [] : folder.split('/').filter((segment) => segment.length > 0);
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

/** The internal relationships of a part; `''` names the package itself (`_rels/.rels`). */
export async function relationships(zip: JSZip, part: string): Promise<Relationship[]> {
  const slash = part.lastIndexOf('/');
  const folder = slash === -1 ? '' : part.slice(0, slash);
  const name = part.slice(slash + 1);
  const root = await readXmlPart(zip, `${folder === '' ? '' : `${folder}/`}_rels/${name}.rels`);
  if (!root) return [];
  return childElements(root, 'Relationship').flatMap((relationship) => {
    const id = attribute(relationship, 'Id');
    const type = attribute(relationship, 'Type');
    const target = attribute(relationship, 'Target');
    if (!id || !type || !target || attribute(relationship, 'TargetMode') === 'External') return [];
    return [{ id, type, target: resolvePart(folder, target) }];
  });
}

/** The target of the first relationship whose type ends with `/<kind>`, such as officeDocument or styles. */
export function targetOf(list: readonly Relationship[], kind: string): string | undefined {
  return list.find((relationship) => relationship.type.endsWith(`/${kind}`))?.target;
}

/** The main part of the package (word/document.xml, ppt/presentation.xml), from the package relationships. */
export async function mainPart(zip: JSZip, fallback: string): Promise<string> {
  return targetOf(await relationships(zip, ''), 'officeDocument') ?? fallback;
}
