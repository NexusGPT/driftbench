import type { Family } from '../frame';
import { edgesFamily } from './edges';
import { gatesFamily } from './gates';
import { layoutFamily } from './layout';
import { linksFamily } from './links';
import { lintFamily } from './lint';

export function blindFamilies(): Family[] {
  return [layoutFamily(), gatesFamily(), linksFamily(), lintFamily(), edgesFamily()];
}
