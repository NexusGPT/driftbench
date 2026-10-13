"""Cheap computed features of a pair, each antisymmetric (swapping A and B flips the sign). Zero model calls.

They are experts beside the System-1 and System-2 verdicts: `feature_signals(item)` returns {name: {'pA': ...}} with
pA = 0.5 + tanh(scale * (f(a) - f(b))) / 2, so the fitted combination treats them like any other signal.
"""
import math
import re


def _words(text):
    return re.findall(r"[A-Za-zÀ-ɏ']+|[一-鿿]", text.lower())


def measures(question, text):
    words = _words(text)
    sentences = [s for s in re.split(r'[.!?。！？\n]+', text) if s.strip()]
    asked = set(w for w in _words(question) if len(w) > 3 or '一' <= w <= '鿿')
    return {
        'len': math.log(1 + len(text)),
        'paragraphs': math.log(1 + len([p for p in text.split('\n\n') if p.strip()])),
        'structure': math.log(1 + len(re.findall(r'^\s*(?:#+|[-*•]|\d+[.)])\s', text, flags=re.M))),
        'specifics': math.log(1 + len(re.findall(r'\d+|"[^"]{3,}"|“[^”]{3,}”', text))),
        'variety': len(set(words)) / max(1, len(words)) ** 0.7,  # type-token ratio, length-corrected
        'sentence_len': math.log(1 + len(words) / max(1, len(sentences))),
        'coverage': len(asked & set(words)) / max(1, len(asked)),
        'dialogue': math.log(1 + text.count('"') + text.count('“') + text.count('：')),
    }


SCALE = {'len': 1.5, 'paragraphs': 1.0, 'structure': 0.8, 'specifics': 0.8, 'variety': 0.5, 'sentence_len': 1.5, 'coverage': 4.0, 'dialogue': 0.8}


def feature_signals(item):
    a, b = measures(item['question'], item['a']), measures(item['question'], item['b'])
    out = {}
    for name in a:
        out['f_' + name] = {'pA': 0.5 + math.tanh(SCALE[name] * (a[name] - b[name])) / 2, 'detail': {'a': round(a[name], 4), 'b': round(b[name], 4)},
                            'calls': {'jev': 0, 'luna': 0}, 'usd': 0.0, 'seconds': {'jev': 0.0, 'luna': 0.0}, 'missing': 0}
    return out
