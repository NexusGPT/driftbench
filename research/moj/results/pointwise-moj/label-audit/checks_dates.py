"""Exact calendar and duration checks. No model, labels, or references."""
import json
from datetime import date,timedelta
from fractions import Fraction
from pathlib import Path
ROOT=Path(__file__).parent
CASES=json.loads((ROOT/'cases.json').read_text())

def average(times):
    seconds=sum(Fraction(h*3600+m*60+s) for h,m,s in times)/len(times)
    h=int(seconds//3600);m=int((seconds-h*3600)//60);s=seconds-h*3600-m*60
    return (h,m,int(s) if s.denominator==1 else s)

def row(n,expected,actual,evidence):
    c=CASES[n]
    assert actual in c['candidate'],(n,actual)
    return {'index':n,'id':c['id'],'status':'proved','candidate_correct':expected==actual,
            'expected':expected,'candidate_final':actual,'evidence':evidence,
            'reason':'Exact Gregorian calendar / rational duration arithmetic; final answer compared, not intermediate reasoning.'}

def run():
    rows=[]
    # 41: month/day/year fields are explicitly specified.
    x,y,z=5,13,2024-3
    p=(0-(x+24))%7;pprime=(p+25)%7;q=(pprime-(y-1))%7;qprime=(q+60)%7
    hours=z-1997
    assert hours%24==0
    day=('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')[(qprime+hours//24)%7]
    rows.append(row(41,day,'unanswerable',{'date1':date(z,x,y).isoformat(),'P':p,'Q':q,'Qprime':qprime,'hours':hours,'days_added':hours//24}))
    # 44: final date is impossible even though the candidate's earlier math errs.
    x,y,z=average([(2,0,40),(0,55,30),(1,50,30),(1,0,40)])
    p,m,s=average([(x+1,y+24,z),(2,30,10),(2,50,30)])
    raw=(p+1989,m-37,s-16)
    try:expected=(date(*raw)-timedelta(days=2)).isoformat()
    except ValueError:expected='unanswerable'
    rows.append(row(44,expected,'unanswerable',{'average1':[x,y,z],'average2':[p,m,s],'invalid_or_valid_date_fields':raw}))
    # 55: date fields have a unique valid interpretation (day-month-year).
    x=2005+8;y=(date(2015,10,19)-date(2008,3,22)).days;z=(2005*12+12)-(2005*12+6)
    joe=date(z+1873,y-2756,x-1992)
    dates={'Jenny':date(1925,10,16),'Kyle':date(1872,6,23),'Joe':joe,'Emma':date(1944,5,19),'Jason':date(1851,8,1)}
    order=sorted(dates,key=dates.get,reverse=True)
    actual='February 14, 1879 at 14:46'
    assert actual in CASES[55]['candidate']
    rows.append({'index':55,'id':CASES[55]['id'],'status':'inconclusive','candidate_correct':None,
      'expected':order,'candidate_final':actual,'evidence':{'X':x,'Y':y,'Z':z,'Joe_actual_date':joe.isoformat(),'correct_order':order},
      'reason':'Candidate final list has the correct relative person order but an incorrect Joe date. Whether this invalidates the requested ordering is a grading interpretation; no label correction.'})
    # 68: the day before tomorrow is today.
    q1=date(2014,6,27)+timedelta(days=91);hour=q1.month;minute=q1.day-25
    expected=f'same_day, {hour:02d}:{minute:02d}'
    rows.append(row(68,expected,'same_day, 09:00',{'date1':q1.isoformat(),'UTC_offsets':[0,0],'time_fields':[hour,minute]}))
    # 90: invalid derived date means the explicitly requested unanswerable output.
    x,y,z=average([(2,55,30),(0,40,0),(1,55,40),(1,10,50)])
    p,m,s=average([(x-1,y+15,z+20),(2,30,10),(2,40,10),(0,30,10)])
    raw=(p+2021,m-38,s+29)
    try:expected=(date(*raw)-timedelta(days=10)).isoformat()
    except ValueError:expected='unanswerable'
    rows.append(row(90,expected,'1-10',{'average1':[x,y,z],'average2':[p,m,s],'invalid_or_valid_date_fields':raw}))
    return rows

if __name__=='__main__':
    assert average([(0,59,59),(1,0,1)])==(1,0,0)
    assert (date(2024,3,1)-timedelta(days=1))==date(2024,2,29)
    rows=run();(ROOT/'audit_dates.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(rows,indent=2))
