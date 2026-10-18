"""The frozen writing request compiler of the recorded driftbench writing cell, copied verbatim
from examples/ledger-wp/prepare.py on research/ledger-wp (110c2fec). Used only to prove that the
TypeScript compiler reproduces it byte for byte (`python3 baseline_rows.py <questions.json>`)."""
import json
import re
import sys


def requirements(question):
    patterns = {
        'length': r'\b\d+\s*(?:to\s*\d+\s*)?(?:words?|characters?|lines?|paragraphs?)\b|\d+\s*(?:字|行|段)',
        'language': r'\b(?:in|using|written in)\s+(?:English|Chinese|Mandarin|French|Spanish)\b|(?:用|使用)(?:中文|汉语|英文|英语)',
        'form': r'\b(?:write|create|compose|draft|produce)\s+(?:(?:a|an|the|short|brief|long|concise)\s+)*(?:poem|story|essay|speech|script|letter|memo|report|proposal|review|sonnet|haiku)\b|(?:写|创作|撰写).{0,12}(?:小说|诗歌|散文|剧本|演讲|书信)',
        'named_element': r'\b(?:must include|must mention|must feature|required to include|include the (?:name|character|phrase|word)|mention the (?:name|character|phrase|word))\b|(?:必须包含|必须包括|必须提及|务必包含)',
    }
    rows = []
    for kind, pattern in patterns.items():
        quotes = []
        for match in re.finditer(pattern, question, re.I):
            start = max(question.rfind('\n', 0, match.start()), question.rfind('. ', 0, match.start()), question.rfind('。', 0, match.start())) + 1
            ends = [n for token in ['\n', '. ', '。'] if (n := question.find(token, match.end())) >= 0]
            quote = question[start:min(ends) + 1 if ends else len(question)].strip()
            if quote and quote not in quotes:
                quotes.append(quote)
        if quotes:
            rows.append({'id': kind, 'hard': True, 'quotes': quotes,
                         'definition': 'Follow only the explicit ' + kind.replace('_', ' ') + ' constraint in these verbatim request excerpts. Do not invent a constraint: ' + json.dumps(quotes, ensure_ascii=False)})
    rows.append({'id': 'better_piece', 'hard': False, 'quotes': [],
                 'definition': 'Holistically evaluate the complete piece for the actual writing request and intended reader: fulfillment, developed content, coherence, effective genre and style. This is the primary quality row. Length alone is neither a merit nor a defect. Respect requested repetition, invention and form; do not impose an unrelated writing style.'})
    return rows


if __name__ == '__main__':
    questions = json.loads(open(sys.argv[1]).read())
    print(json.dumps([[{'name': r['id'], 'rubric': r['definition'], 'hard': r['hard']} for r in requirements(q)] for q in questions], ensure_ascii=False))
