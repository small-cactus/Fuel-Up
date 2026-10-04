"""Retrospective jump/return audit; never interprets patterns as proof of fraud."""
import argparse,json
from pathlib import Path
import numpy as np


def audit(root,out):
    m=json.loads((root/'metadata.json').read_text())
    assert m['cutoff'] <= '2026-10-05T18:19:00.000Z'
    p,s,o=[np.load(root/(f+'.npy'),mmap_mode='r') for f in ['prices','sources','observed']]
    records=[]; eligible_jumps=0; late_without_six_hours=0
    for t in range(1,len(p)-1):
        now=p[t];prev=p[t-1];at=o[t,:,None];before=o[t-1,:,None]
        valid=(abs(now-prev)>=.09999)&(s[t]>s[t-1]+5/60)&(s[t]<=at+5/60)&(s[t-1]<=before+5/60)&(now>0)&(prev>0)&(at>before)&(at-before<=2)
        ii,cc=np.where(valid)
        if not len(ii):continue
        full=at[ii,0]+6 <= float(m['start_hour'])+len(p)
        late_without_six_hours+=int((~full).sum());ii=ii[full];cc=cc[full]
        eligible_jumps+=len(ii)
        # Require a return to within 3 cents of the pre-jump quote on a newer report.
        returned=np.full(len(ii),-1,int);confirmed=np.full(len(ii),-1,int)
        for u in range(t+1,min(t+7,len(p))):
            good=(o[u,ii]>o[t,ii])&(o[u,ii]-o[t,ii]<=6)&(s[u,ii,cc]>s[t,ii,cc]+5/60)&(s[u,ii,cc]<=o[u,ii]+5/60)&(abs(p[u,ii,cc]-prev[ii,cc])<=.03001)
            k=np.maximum(returned,0)
            support=good&(returned>=0)&(confirmed<0)&(s[u,ii,cc]>s[k,ii,cc]+5/60)&(o[u,ii]-o[k,ii]>=1)
            confirmed[support]=u
            returned[good&(returned<0)]=u
        for j in np.flatnonzero(returned>=0):
            i=int(ii[j]);c=int(cc[j]);u=int(returned[j]);v=int(confirmed[j])
            records.append({'station_id':m['ids'][i],'state':m['states'][i],'product':c,'hour':t,
                'observed_hour':float(o[t,i]),'report_age_hours':float(o[t,i]-s[t,i,c]),
                'before':float(prev[i,c]),'jump':float(now[i,c]),'returned':float(p[u,i,c]),
                'return_hours':float(o[u,i]-o[t,i]),'confirmed':v>=0,
                'confirmation_hour':float(o[v,i]) if v>=0 else None})
    report={'definition':'Observed >=10c jump then return within 3c of pre-jump within 6h on a newer timestamp; optional further newer-timestamp confirmation >=1h later',
        'limitations':'Retrospective report pattern, not fraud or pump truth; physical temporary changes remain possible. Missing archive coverage can hide returns. Cash and credit can duplicate the same station event.',
        'cutoff':m['cutoff'],'eligible_jump_products':eligible_jumps,'late_jumps_excluded':late_without_six_hours,
        'return_products':len(records),'confirmed_return_products':sum(r['confirmed'] for r in records),
        'return_stations':len(set(r['station_id'] for r in records)),
        'confirmed_return_stations':len(set(r['station_id'] for r in records if r['confirmed'])),
        'fresh_under_one_hour_returns':sum(r['report_age_hours']<1 for r in records),
        'examples':sorted([r for r in records if r['confirmed']],key=lambda r:-abs(r['jump']-r['before']))[:20]}
    out.mkdir(parents=True,exist_ok=True)
    (out/'reversal-audit.json').write_text(json.dumps(report,indent=2))
    (out/'reversal-events.json').write_text(json.dumps(records))
    print(json.dumps({k:v for k,v in report.items() if k!='examples'},indent=2))

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--arrays',type=Path,required=True);a.add_argument('--out',type=Path,required=True);v=a.parse_args();audit(v.arrays,v.out)
