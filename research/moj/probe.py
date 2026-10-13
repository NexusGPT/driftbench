"""Probe of the System-1 endpoint with fictional data only: shape, routes, several questions, size, languages."""
import json, sys, time
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from moj.client import jev

Q = 'Request: "Name the capital of the fictional country Veldoria, which the story says is Marrow Bay."'
A = 'The capital of Veldoria is Marrow Bay.'
B = 'Veldoria has no capital; it is governed from a ship.'
out = {}
def pair(first, second, extra=''):
    return {'request': Q + extra, 'FIRST': first, 'SECOND': second}
ask = {'better': {'question': 'Is the FIRST reply a better answer to the request than the SECOND reply? Answer yes when FIRST is better, no when SECOND is better.'}}
for route in ['gateway', 'typesafe']:
    p, row = jev(pair(A, B), ask, route=route); p2, row2 = jev(pair(B, A), ask, route=route)
    out[f'P1_{route}'] = {'AB': p, 'BA': p2, 'seconds': [row.get('seconds'), row2.get('seconds')], 'error': row.get('error'),
                          'answer_keys': sorted((row.get('answer') or {}).keys())}
multi = {'correct': {'question': 'Does the reply state that the capital is Marrow Bay?'},
         'refuses': {'question': 'Does the reply refuse to answer?'},
         'long': {'question': 'Is the reply longer than 200 words?'}}
p, row = jev({'request': Q, 'reply': A}, multi); out['P2_multi'] = {'p': p, 'seconds': row.get('seconds'), 'error': row.get('error')}
filler = 'The harbour clerk of Marrow Bay counted crates of salted plums and wrote the tally in a green ledger. '
for size in [2000, 8000, 16000, 32000, 64000, 128000]:
    text = (filler * (size // len(filler) + 1))[:size]
    p, row = jev({'request': Q, 'reply': text + ' ' + A}, {'correct': multi['correct']})
    out[f'P3_{size}'] = {'p': p, 'seconds': row.get('seconds'), 'error': row.get('error')}
    if row.get('error'): break
langs = {'de': ('Anfrage: "Nenne die Hauptstadt des erfundenen Landes Veldoria. Laut Geschichte ist es Marrow Bay."', 'Die Hauptstadt von Veldoria ist Marrow Bay.', 'Veldoria hat keine Hauptstadt; es wird von einem Schiff aus regiert.'),
         'zh': ('请求："说出虚构国家维尔多利亚的首都。故事里说是马罗湾。"', '维尔多利亚的首都是马罗湾。', '维尔多利亚没有首都，它由一艘船统治。'),
         'ar': ('الطلب: "اذكر عاصمة البلد الخيالي فيلدوريا. تقول القصة إنها خليج مارو."', 'عاصمة فيلدوريا هي خليج مارو.', 'ليس لفيلدوريا عاصمة؛ تُحكم من سفينة.')}
for lang, (q, a, b) in langs.items():
    p, _ = jev({'request': q, 'FIRST': a, 'SECOND': b}, ask); p2, _ = jev({'request': q, 'FIRST': b, 'SECOND': a}, ask)
    out[f'P4_{lang}'] = {'AB': p, 'BA': p2}
p, row = jev({'question': 'What is 17 * 23 + 4?', 'reply': 'The result is 395.'}, {'ok': {'question': 'Is the arithmetic result in the reply correct?'}})
p2, _ = jev({'question': 'What is 17 * 23 + 4?', 'reply': 'The result is 385.'}, {'ok': {'question': 'Is the arithmetic result in the reply correct?'}})
out['P6_arithmetic'] = {'right_answer_395': p, 'wrong_answer_385': p2}
json.dump(out, open('results/probe.json', 'w'), indent=1, ensure_ascii=False); print(json.dumps(out, indent=1, ensure_ascii=False))
