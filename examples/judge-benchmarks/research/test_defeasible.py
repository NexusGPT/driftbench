"""Self-check for the defeasible engine (fictional facts). Run: python3 test_defeasible.py"""
from defeasible import solve

L = lambda s, p, o='', neg=False: {'s': s, 'p': p, 'o': o, 'neg': neg}


def spec(prefs):
    return {
        'facts': [L('frog', 'has_primary_color_card', neg=True), L('frog', 'has_leafy_green'),
                  L('seahorse', 'creates_castle', 'vampire', True)],
        'rules': [
            {'id': 'R16', 'if': [L('frog', 'has_primary_color_card')], 'then': L('frog', 'destroys_wall', 'swan', True)},
            {'id': 'R21', 'if': [L('frog', 'has_leafy_green')], 'then': L('frog', 'destroys_wall', 'swan')},
            {'id': 'R24', 'if': [L('frog', 'destroys_wall', 'swan')], 'then': L('swan', 'shouts', 'peafowl')},
            {'id': 'R6', 'if': [L('?any', 'enjoys', 'ant')], 'then': L('swan', 'shouts', 'peafowl', True)},
            {'id': 'R12', 'if': [L('?x', 'creates_castle', 'vampire', True)], 'then': L('?x', 'enjoys', 'ant')},
        ],
        'preferences': prefs, 'question': L('swan', 'shouts', 'peafowl')}


assert solve(spec([['R16', 'R21'], ['R24', 'R6']])) == 'proved'
assert solve(spec([['R16', 'R21'], ['R6', 'R24']])) == 'disproved'
assert solve(spec([['R16', 'R21']])) == 'unknown'  # unresolved conflict proves neither side
print('defeasible engine: 3 of 3 checks pass')
