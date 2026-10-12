import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg,
  bootstrapCI,
  cusum,
  ksTest,
  mean,
  pageHinkley,
  quantile,
  quantileSorted,
  sampleVariance,
  unreliability,
  wilcoxonSignedRank,
} from '../src/index';

/**
 * The degenerate-input contract, rule 1: a RangeError begins `<function>: <argument>`, so the caller sees which
 * argument to fix. A message that names no argument fails this contract.
 */
describe('RangeError names the function and the argument', () => {
  it('mean of an empty sample names values', () => {
    expect(() => mean([])).toThrow(RangeError);
    expect(() => mean([])).toThrow(/^mean: values/);
  });

  it('sampleVariance of an empty sample names values', () => {
    expect(() => sampleVariance([])).toThrow(/^sampleVariance: values/);
  });

  it('quantile of an empty sample names values', () => {
    expect(() => quantile([], 0.5)).toThrow(/^quantile: values/);
  });

  it('quantile level out of range names p', () => {
    expect(() => quantile([1, 2], 2)).toThrow(/^quantile: p/);
  });

  it('quantileSorted of an empty sample names sorted', () => {
    expect(() => quantileSorted([], 0.5)).toThrow(/^quantileSorted: sorted/);
  });

  it('mean of a NaN value names values and its index', () => {
    expect(() => mean([1, Number.NaN])).toThrow(/^mean: values\[1\]/);
  });

  it('mean of an infinite value names values and its index', () => {
    expect(() => mean([1, Number.POSITIVE_INFINITY])).toThrow(/^mean: values\[1\]/);
  });

  it('sampleVariance of an infinite value names values and its index', () => {
    expect(() => sampleVariance([1, Number.NEGATIVE_INFINITY, 2])).toThrow(/^sampleVariance: values\[1\]/);
  });

  it('quantile of a NaN value names values and its index', () => {
    expect(() => quantile([1, Number.NaN], 0.5)).toThrow(/^quantile: values\[1\]/);
  });

  it('quantileSorted of an infinite value names sorted and its index', () => {
    expect(() => quantileSorted([1, Number.POSITIVE_INFINITY], 0.5)).toThrow(/^quantileSorted: sorted\[1\]/);
  });

  it('cusum of a NaN value names series and its index', () => {
    expect(() => cusum([1, Number.NaN], { sd: 1 })).toThrow(/^cusum: series\[1\]/);
  });

  it('pageHinkley of an infinite value names series and its index', () => {
    expect(() => pageHinkley([1, Number.POSITIVE_INFINITY])).toThrow(/^pageHinkley: series\[1\]/);
  });

  it('ksTest of a NaN value in the first sample names a and its index', () => {
    expect(() => ksTest([1, Number.NaN], [1, 2])).toThrow(/^ksTest: a\[1\]/);
  });

  it('wilcoxonSignedRank of an infinite value names x and its index', () => {
    expect(() => wilcoxonSignedRank([1, Number.POSITIVE_INFINITY], [1, 2])).toThrow(
      /^wilcoxonSignedRank: x\[1\]/,
    );
  });

  it('unreliability of a NaN sample names samples and its index', () => {
    expect(() => unreliability([0.5, Number.NaN])).toThrow(/^unreliability: samples\[1\]/);
  });

  it('benjaminiHochberg of a NaN p-value names pvalues and its index', () => {
    expect(() => benjaminiHochberg([0.01, Number.NaN])).toThrow(/^benjaminiHochberg: pvalues\[1\]/);
  });

  it('bootstrapCI of an infinite value names values and its index', () => {
    expect(() => bootstrapCI([1, Number.NEGATIVE_INFINITY])).toThrow(/^bootstrapCI: values\[1\]/);
  });
});
