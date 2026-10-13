import { describe, expect, it } from 'vitest';
import { machineCheck, parseJson, reformat, type RequirementBlock } from '../src/blocks';

describe('block-native judging helpers', () => {
  it('reads the JSON object of a fenced or bare answer', () => {
    expect(parseJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJson('text {"blocks": []} more')).toEqual({ blocks: [] });
    expect(parseJson('no json')).toBeUndefined();
  });

  it('fails a draft below a stated minimum length, with a 10 percent tolerance', () => {
    const block: RequirementBlock = { id: 'r1', ask: 'at least 100 words', expected: '', hard: true, machine: { type: 'min_units', value: 100 } };
    expect(machineCheck(block, 'word '.repeat(95), 'en')).toBe(true);
    expect(machineCheck(block, 'word '.repeat(50), 'en')).toBe(false);
  });

  it('counts Chinese characters for a Chinese length check', () => {
    const block: RequirementBlock = { id: 'r1', ask: '不少于10字', expected: '', hard: true, machine: { type: 'min_units', value: 10 } };
    expect(machineCheck(block, '这是一个很长的中文句子用于测试', 'zh')).toBe(true);
    expect(machineCheck(block, '短句', 'zh')).toBe(false);
  });

  it('has no machine verdict for a block without a machine check', () => {
    const block: RequirementBlock = { id: 'r1', ask: 'be vivid', expected: '', hard: false, machine: null };
    expect(machineCheck(block, 'anything', 'en')).toBeUndefined();
  });

  it('keeps the words of a draft when it removes markdown presentation', () => {
    expect(reformat('## Title\n**Bold** text\n- item')).toBe('Title\nBold text\n• item');
  });
});
