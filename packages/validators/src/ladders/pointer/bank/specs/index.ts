import { adversarial } from './adversarial';
import { cutting } from './cutting';
import { grouping } from './grouping';
import { HARDENING_SPECS } from './hardening';
import { HARDENING_BUGS_A_SPECS } from './hardening-bugs-a';
import { HARDENING_BUGS_B_SPECS } from './hardening-bugs-b';
import { HARDENING_BUGS_C_SPECS } from './hardening-bugs-c';
import { HARDENING_D_SPECS } from './hardening-bugs-d';
import { HARDENING_PRIVACY_SPECS } from './hardening-privacy';
import { ids } from './ids';
import { labels } from './labels';
import { links } from './links';
import { privacy } from './privacy';
import { radius } from './radius';
import { reanchoring } from './reanchoring';
import { replay } from './replay';
import { scale } from './scale';
import type { FamilySpec } from './types';

const FIRST_BANK: FamilySpec[] = [
  cutting,
  ids,
  reanchoring,
  grouping,
  labels,
  replay,
  privacy,
  links,
  radius,
  scale,
  adversarial,
];

/** The families with the items the audits added at the end of their rows. */
export const FAMILIES: FamilySpec[] = FIRST_BANK.map((family) => ({
  ...family,
  specs: [
    ...family.specs,
    ...(HARDENING_SPECS[family.id] ?? []),
    ...(HARDENING_BUGS_A_SPECS[family.id] ?? []),
    ...(HARDENING_BUGS_B_SPECS[family.id] ?? []),
    ...(HARDENING_BUGS_C_SPECS[family.id] ?? []),
    ...(HARDENING_D_SPECS[family.id] ?? []),
    ...(HARDENING_PRIVACY_SPECS[family.id] ?? []),
  ],
}));
