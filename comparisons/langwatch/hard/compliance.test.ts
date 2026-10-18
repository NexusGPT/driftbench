import { expect, test } from 'vitest';
import { compliancePrediction, complianceUser } from './compliance.mts';

test('absence and observed contradictions cannot become satisfied compliance', () => {
  expect(compliancePrediction('{"evidenceAvailable":false,"satisfied":true,"violations":[]}')).toBe(
    'inconclusive',
  );
  expect(
    compliancePrediction('{"evidenceAvailable":true,"satisfied":true,"violations":["wrong units"]}'),
  ).toBe('fail');
  expect(compliancePrediction('{"evidenceAvailable":true,"satisfied":false,"violations":[]}')).toBe('fail');
  expect(compliancePrediction('{"evidenceAvailable":true,"satisfied":true,"violations":[]}')).toBe('pass');
  expect(compliancePrediction('{"evidenceAvailable":"false","satisfied":true,"violations":[]}')).toBeNull();
});
test('model input excludes scoring labels, family and case ID', () => {
  const input = complianceUser(
    {
      id: 'LABEL_SENTINEL',
      kind: 'FAMILY_SENTINEL',
      truth: ['TRUTH_SENTINEL'],
      scenario: 'expected facts',
      criteria: ['criterion'],
      transcript: 'observed evidence',
    },
    'criterion',
  );
  expect(input).not.toMatch(/LABEL_SENTINEL|FAMILY_SENTINEL|TRUTH_SENTINEL/);
  expect(JSON.parse(input)).toEqual({
    criterion: 'criterion',
    expectedReferenceContext: 'expected facts',
    observedTranscript: 'observed evidence',
  });
});
