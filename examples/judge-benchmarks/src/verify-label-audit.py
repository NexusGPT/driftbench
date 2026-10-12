"""Dev-only label proofs. This file is never imported by any judge contestant."""
import json
import math
import os
import subprocess
from fractions import Fraction as F
from itertools import combinations, permutations
from pathlib import Path

root = Path(__file__).resolve().parents[1]
items_path = root / 'results/verify-dev/items.json'
if items_path.exists():
    items = json.loads(items_path.read_text())
else:
    # Fetch the public input on demand, cache only within this worktree, and retain dev only.
    code = """import {loadBenchmark,splitOf} from './examples/judge-benchmarks/src/data.ts';
const b=await loadBenchmark('longjudge-verify');
process.stdout.write(JSON.stringify(b.items.filter(i=>splitOf(b.id,i.id)==='dev')));"""
    env = {**os.environ, 'DRIFTBENCH_BENCH_CACHE': str(root / 'results/verify-dev/data-cache')}
    ran = subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e', code],
                         cwd=root.parents[1], env=env, check=True, capture_output=True, text=True)
    items = json.loads(ran.stdout)
    items_path.parent.mkdir(parents=True, exist_ok=True)
    items_path.write_text(json.dumps(items))
audits = []


def audit(prefix, corrected, proof):
    matches = [i for i in items if i['id'].startswith(prefix)]
    assert len(matches) == 1
    item = matches[0]
    assert item['correct'] != corrected
    audits.append({'id': item['id'], 'official': item['correct'], 'audited': corrected, 'proof': proof})


# The locus equivalence is algebraic in both directions, not a numeric sample.
audit('d39f096b', True,
      'For x<-3, distance to (2,0) is at least 2-x, greater than -x-4, so no solution. '
      'Otherwise the distance equation is sqrt((x-2)^2+y^2)=x+2. Squaring gives y^2=8x. '
      'Conversely y^2=8x implies x>=0 and the square root is x+2. The submitted locus is exact.')

assert math.isclose((4 * math.cos(math.pi / 6)) ** 2 - (4 * math.sin(math.pi / 6)) ** 2, 8)
assert math.isclose((4 * math.cos(7 * math.pi / 6)) ** 2 - (4 * math.sin(7 * math.pi / 6)) ** 2, 8)
audit('045503cb', True,
      'Under the two-intersection line convention in the question, the polar points are '
      '(4,pi/6) and (4,7pi/6). Substitution gives x^2-y^2=8. For the second line, '
      't^2+4sqrt(3)t-8=0, so t=-2sqrt(3)+/-2sqrt(5). The direction vector has norm 1, '
      'hence MN=4sqrt(5). Both submitted parts match.')


def mm(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(2)) for j in range(2)] for i in range(2)]


original = [[F(-4, 5), F(3, 5)], [F(-1, 5), F(2, 5)]]
shifted = [[original[i][j] + (i == j) for j in range(2)] for i in range(2)]
submitted = [[F(23, 2), F(-6)], [F(2), F(-1, 2)]]
identity = [[F(1), F(0)], [F(0), F(1)]]
assert mm(mm(shifted, shifted), submitted) == identity
assert mm(submitted, mm(shifted, shifted)) == identity
audit('799919e2', True,
      'Exact Fraction arithmetic: A=[[-4/5,3/5],[-1/5,2/5]]. '
      '(A+I)^2=[[-2/25,24/25],[-8/25,46/25]]. Multiplication in both orders '
      'by the submitted [[23/2,-6],[2,-1/2]] gives the identity.')

item = next(i for i in items if i['id'].startswith('514cb7d2'))
pair = dict(zip('([{<', ')]}>'))
prefix = ''.join(item['question'].split('Input:')[1].split())
stack = []
for ch in prefix:
    if ch in pair:
        stack.append(ch)
    else:
        assert stack and pair[stack.pop()] == ch
suffix = ''.join(pair[ch] for ch in reversed(stack))
assert suffix == ')]'
completion = item['response'].split('`')[-2].replace(' ', '').strip()
assert completion == prefix + ')] )]'.replace(' ', '')
audit('514cb7d2', False,
      'A stack parse of the given input leaves [ and ( open, requiring only the suffix ) ]. '
      'The final submitted completed sequence appends ) ] ) ], producing two unmatched closers. '
      'The earlier explanatory suffix is also wrong. The final answer is invalid.')

item = next(i for i in items if i['id'].startswith('d29e283a'))
assert 'Greg is a rhino.' in item['question']
assert not any(f'Greg is {color}.' in item['question'] for color in ['yellow', 'green', 'white', 'gray'])
audit('d29e283a', True,
      'No premise specifies Greg\'s color and there is no universal color rule. '
      'Both a model with Greg yellow and a model with Greg green satisfy every listed premise. '
      'Thus the final committed answer, that Greg\'s color is not specified, is correct.')

# Monday is zero; all computations follow the chained variables exactly.
X, Y, Z = 5, 13, 2021
P = (0 - (X + 24)) % 7
P1 = (P + 25) % 7
Q = (P1 - (Y - 1)) % 7
Q1 = (Q + 60) % 7
assert (P, P1, Q, Q1, Z - 1997) == (6, 3, 5, 2, 24)
assert (Q1 + 1) % 7 == 3
audit('daafa66d', False,
      'Q1=05/13/2021, X\'=29, P=Sunday, P\'=Thursday, Y\'=12, Q=Saturday, '
      'Q\'=Wednesday and Z\'=24. Exactly 24 hours after Wednesday is Thursday. '
      'The submitted unanswerable is wrong; no time of day is needed.')

probability = F(math.comb(7, 6) * 10 ** 6, math.comb(70, 6))
assert probability == F(200000, 3746171)
audit('8dce745b', True,
      'There are choose(70,6)=131115985 equally likely six-element subsets. '
      'Choosing six of seven tens digits and one of ten integers for each gives '
      'choose(7,6)*10^6=7000000 favorable subsets. The reduced probability '
      'is exactly the submitted 200000/3746171.')

values = list(combinations(range(2, 8), 2))
assert len(values) == 15 and sum(map(sum, values)) == 135
audit('987731fe', True,
      'Exhaustive enumeration of all 15 unordered pairs of marbles 2 through 7 '
      'gives a total pair sum of 135, so the expected sum is 135/15=9. '
      'Equivalently, linearity gives 2*(2+3+4+5+6+7)/6=9, the submitted value.')

# Each index is a wall's upper then lower slot. This exhausts all assignments.
paintings = ['FO', 'FW', 'GO', 'GW', 'HO', 'HW', 'IO', 'IW']
possible = [False] * 5
witness = None
for placement in permutations(paintings):
    if placement[7] != 'IO':
        continue
    pos = {painting: n for n, painting in enumerate(placement)}
    if pos['GW'] % 2 or pos['GW'] // 2 != pos['FO'] // 2:
        continue
    walls = [placement[n:n + 2] for n in range(0, 8, 2)]
    if any(all(p[1] == 'W' for p in wall) or wall[0][0] == wall[1][0]
           or {p[0] for p in wall} == {'F', 'I'} for wall in walls):
        continue
    predicates = [
        all(pos[p] % 2 for p in ['FO', 'FW', 'GO', 'GW']),
        all(pos[p] % 2 == 0 for p in ['FO', 'FW', 'GO', 'GW']),
        all(pos[p] % 2 == 0 for p in ['FO', 'FW', 'HO', 'HW']),
        all(pos[p] % 2 for p in ['GO', 'GW', 'HO', 'HW']),
        all(pos[p] % 2 == 0 for p in ['GO', 'GW', 'HO', 'HW']),
    ]
    possible = [a or b for a, b in zip(possible, predicates)]
    if predicates[4] and witness is None:
        witness = walls
assert possible == [False, False, False, False, True]
audit('aee1de22', True,
      'Exhaustive enumeration of all eight-painting placements finds E alone possible. '
      'A witness, in upper/lower order, is: wall1 HO/FW, wall2 GW/FO, wall3 GO/IW, '
      'wall4 HW/IO. Each wall contains an oil and a watercolor from different students; '
      'Franz never shares a wall with Isaacs; Greene\'s watercolor is above Franz\'s oil; '
      'Isaacs\'s oil is lower on wall4. Greene and Hidalgo each occupy two upper slots. '
      'The submitted E is therefore correct.')

# The original tenth claim is convention-sensitive and is withdrawn.
# BoardgameQA uses RGB primaries: yellow is not primary. Its closure differs from RYB.
base_facts = {'bee_blue', 'bee_not_teardown_badger', 'frog_yellow', 'frog_spinach',
         'snake_reduced_hours', 'seahorse_not_create_vampire'}
rules = [
    ({'bee_not_teardown_badger'}, 'bee_refuse_badger'),
    ({'bee_refuse_badger'}, 'bee_shout_dragonfly'),
    ({'bee_shout_dragonfly'}, 'bee_see_fangtooth'),
    ({'bee_see_fangtooth'}, 'bee_not_shout_beetle'),
    ({'snake_reduced_hours'}, 'snake_teardown_dove'),
    ({'snake_teardown_dove'}, 'woodpecker_take_monkey'),
    ({'woodpecker_take_monkey'}, 'bee_not_refuse_dinosaur'),
    ({'bee_not_refuse_dinosaur'}, 'bee_reveal_zebra'),
    ({'bee_not_shout_beetle', 'bee_reveal_zebra'}, 'bee_not_trade_stork'),
    ({'seahorse_not_create_vampire'}, 'seahorse_enjoy_ant'),
    ({'swan_shout_peafowl'}, 'swan_shout_beaver'),
    ({'swan_shout_beaver'}, 'swan_unite_ostrich'),
    ({'swan_unite_ostrich'}, 'beetle_trade_stork'),
    ({'bee_not_trade_stork', 'beetle_trade_stork'}, 'stork_see_goat'),
    ({'stork_see_goat'}, 'finch_not_capture_pigeon'),
]
def color_closure(yellow_is_primary):
    facts = set(base_facts)
    active = list(rules)
    if yellow_is_primary:
        # Rule16 defeats Rule21, so Rule24 cannot activate. Rule6 is undefeated.
        active += [({'frog_yellow'}, 'frog_not_destroy_swan'),
                   ({'seahorse_enjoy_ant'}, 'swan_not_shout_peafowl')]
    else:
        # Rule21 applies. Rule24 then defeats the contrary Rule6 conclusion.
        active += [({'frog_spinach'}, 'frog_destroy_swan'),
                   ({'frog_destroy_swan'}, 'swan_shout_peafowl')]
    while True:
        new = facts | {head for body, head in active if body <= facts}
        if new == facts:
            return facts
        facts = new


ryb = color_closure(True)
rgb = color_closure(False)
assert 'finch_not_capture_pigeon' not in ryb and 'finch_capture_pigeon' not in ryb
assert 'finch_not_capture_pigeon' in rgb and 'finch_capture_pigeon' not in rgb
item = next(i for i in items if i['id'].startswith('1bd81440'))
assert item['correct'] is True
withdrawn = [{
    'id': item['id'], 'official': True, 'original_proposed_audit': False,
    'status': 'withdrawn', 'corrected_audit_value': True,
    'reason': 'The original claim assumes RYB primaries. The upstream task uses RGB, where yellow is not primary.',
    'conditional_ryb_result': 'unknown', 'rgb_result': 'disproved',
    'rgb_counter_derivation': 'Rule21 derives frog destroys swan wall; Rule24 defeats Rule6 and derives swan shouts peafowl. Rules22,1,7 give beetle trades stork. Independently Rules5,19,20,14 and23,2,13,17,18 derive bee does not trade stork. Rules4 and10 derive finch does not capture pigeon. Thus the submitted disproved is correct under RGB.',
    'source_urls': ['https://journals.sagepub.com/doi/10.3233/FAIA250981',
                    'https://huggingface.co/datasets/BBEH/bbeh'],
}]
(root / 'results/verify-dev/label-audit-withdrawn.json').write_text(json.dumps(withdrawn, indent=2) + '\n')

out = root / 'results/verify-dev/label-audit.json'
out.write_text(json.dumps(audits, indent=2) + '\n')
print(json.dumps({'proved_label_conflicts': len(audits), 'output': str(out)}))
