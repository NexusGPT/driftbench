import { describe, expect, it } from 'vitest';
import type { ChangeManifest } from '../../src/radius/change';
import type { SectionRegistry } from '../../src/radius/sections';
import { sectionSelection } from '../../src/radius/select';
import type { Spec } from '../../src/schema/spec';
import { specHash } from '../../src/spec/identity';

/** Fictional data only. A child authored before its parent in the YAML is still its parent's descendant. */
const registry: SectionRegistry = {
  prompt_id: 'p',
  version: 'v1',
  text_sha256: '0'.repeat(64),
  sections: ['intro', 'offer'].map((id, index) => ({
    id,
    scope: 'local' as const,
    span: { start: index * 10, end: index * 10 + 9 },
    sha256: '0'.repeat(64),
    anchor: { quote: id },
  })),
};
const spec = {
  id: 's',
  kind: 'conversation',
  blocks: [
    { id: 'child', parent: 'root', when: { user: 'child' } },
    { id: 'root', when: { user: 'root' } },
  ],
  metadata: {
    links: [
      { block: 'child', to: { kind: 'prompt_section', prompt: 'p', section: 'intro' }, status: 'declared' },
      { block: 'root', to: { kind: 'prompt_section', prompt: 'p', section: 'offer' }, status: 'declared' },
    ],
  },
} as Spec;
const manifest = {
  from: 'v1',
  to: 'v2',
  changes: [{ kind: 'prompt_section', id: 'p#offer' }],
} as ChangeManifest;

describe('sectionSelection across block-level parent edges', () => {
  it('selects a child authored before the parent a changed section reaches', () => {
    const got = sectionSelection([{ spec, hash: specHash(spec) }], manifest, [registry]);
    const states = got.specs[0]?.blocks.map((block) => `${block.id}:${block.state}`);
    expect(states).toEqual(['child:forward', 'root:direct']);
  });

  it('leaves an independent root of a forest out, even authored after a selected block', () => {
    const forest = {
      ...spec,
      id: 'forest',
      blocks: [
        { id: 'child', parent: 'root', when: { user: 'child' } },
        { id: 'other', when: { user: 'other' } },
        { id: 'root', when: { user: 'root' } },
      ],
      metadata: {
        links: [
          ...(spec.metadata as { links: unknown[] }).links,
          {
            block: 'other',
            to: { kind: 'prompt_section', prompt: 'p', section: 'intro' },
            status: 'declared',
          },
        ],
      },
    } as Spec;
    const got = sectionSelection([{ spec: forest, hash: specHash(forest) }], manifest, [registry]);
    const states = got.specs[0]?.blocks.map((block) => `${block.id}:${block.state}`);
    expect(states).toEqual(['child:forward', 'other:out', 'root:direct']);
  });
});
