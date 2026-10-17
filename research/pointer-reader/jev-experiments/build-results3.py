import re, json
T = open('tables3.out.md').read()
def block(header_start):
    i = T.index(header_start)
    j = T.find('\n#### ', i + 5)
    k = T.find('\n### ', i + 5)
    ends = [x for x in (j, k) if x != -1]
    return T[i: min(ends) if ends else len(T)]
def table_after(blk, marker):
    i = blk.index(marker)
    lines = blk[i:].split('\n')[1:]
    out = []; started = False
    for l in lines:
        if l.startswith('|'): started = True; out.append(l)
        elif started: break
    return '\n'.join(out)
J = block('#### Descent labeller: Jev stacker trained on the other corpus (no Haiku, no label of this corpus); calibration folds: lofo-all')
JH = block('#### Descent labeller: Jev + Haiku stacker trained on the other corpus; calibration folds: lofo-all')
R = T[T.index('### References'):]
Jd = block('#### Descent labeller: Jev stacker trained on the other corpus; calibration trained on the 3 dev files only')
JHd = block('#### Descent labeller: Jev + Haiku stacker; calibration trained on the 3 dev files only')
def sel(tbl, names):
    ls = tbl.split('\n'); head = ls[:2]; rows = [l for l in ls[2:] if any(l.startswith('| ' + n) for n in names)]
    return '\n'.join(head + rows)
perunit = open('an12.out.md').read().strip()
cost = open('an10.out.md').read()
cost_tbl = cost[:cost.index('Top-down arm')].strip()
rest = cost[cost.index('Top-down arm'):]
boot = open('an13.out.md').read().strip()
auc = open('an8.out.txt').read().strip()
annot = open('an11.out.txt').read().strip()
agree = open('agree3.out.txt').read().strip().split('\n')[:12]
mdl = open('RESULTS-3.template.md').read()
def sub(name, text): 
    global mdl
    assert '{{' + name + '}}' in mdl, name
    mdl = mdl.replace('{{' + name + '}}', text)
sub('J_TEST', table_after(J, '**Test files'))
sub('J_ALL', table_after(J, '**All 9 files'))
sub('JH_TEST', table_after(JH, '**Test files'))
sub('JH_ALL', table_after(JH, '**All 9 files'))
sub('REF_TEST', table_after(R, '**Test files'))
sub('REF_ALL', table_after(R, '**All 9 files'))
sub('JD_TEST', sel(table_after(Jd, '**Test files'), ['s0', 'g-cal', 'h-cal', 'g2-cal']))
sub('JHD_TEST', sel(table_after(JHd, '**Test files'), ['s0', 'g-cal', 'h-cal', 'g2-cal']))
sub('PERUNIT', perunit)
sub('COST', cost_tbl)
sub('REST', rest.strip())
sub('BOOT', boot)
sub('AUC', '```\n' + auc + '\n```')
sub('ANNOT', '```\n' + annot + '\n```')
sub('AGREE', '```\n' + '\n'.join(agree) + '\n```')
open('RESULTS-3.md', 'w').write(mdl)
print(len(mdl))
