import { describe, expect, it } from 'vitest';
import {
  dropCommentLines,
  dropTrailingComma,
  repairAnswerText,
  singleToDoubleQuotes,
  straightenCurlyQuotes,
} from '../src/index';

describe('near-JSON repairs', () => {
  it('escapes a double quote inside a string value, and leaves valid JSON as it is', () => {
    expect(JSON.parse(repairAnswerText('{"reason": "it said "no" twice"}'))).toEqual({
      reason: 'it said "no" twice',
    });
    expect(repairAnswerText('{"a": "b"}')).toBe('{"a": "b"}');
  });

  it('rewrites single quotes and curly quotes as straight double quotes', () => {
    expect(JSON.parse(singleToDoubleQuotes("{'units': '1', 'label': 'rule'}"))).toEqual({
      units: '1',
      label: 'rule',
    });
    expect(JSON.parse(straightenCurlyQuotes('{“units”: “1”}'))).toEqual({ units: '1' });
  });

  it('drops a comment line and a comma before a closing brace or bracket', () => {
    expect(JSON.parse(dropCommentLines('{\n// the labels\n"a": 1\n}'))).toEqual({ a: 1 });
    expect(JSON.parse(dropTrailingComma('{"labels": [{"a": 1},]}'))).toEqual({ labels: [{ a: 1 }] });
    expect(dropTrailingComma('{"a": "x,}"}')).toBe('{"a": "x,}"}');
  });
});
