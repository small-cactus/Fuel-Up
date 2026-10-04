"""Concentration, paired uncertainty, and readable research figures."""
import argparse,json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.metrics import average_precision_score, precision_recall_curve


def interval(y,group):
    _,ix=np.unique(group,return_inverse=True);n=ix.max()+1
    totals=np.bincount(ix,minlength=n);positive=np.bincount(ix,weights=y,minlength=n)
    rng=np.random.default_rng(104);rates=[]
    for _ in range(2000):
        selected=rng.integers(n,size=n);rates.append(positive[selected].sum()/totals[selected].sum())
    return np.percentile(rates,[2.5,97.5]).tolist()


def run(root,arrays,out):
    out.mkdir(parents=True,exist_ok=True)
    z=np.load(root/'audit/recurrence-events.npz');d=z['events'];later=z['later'];history=z['product_history']
    info=json.loads((arrays/'metadata.json').read_text());states=np.array(info['states'])[d[:,0].astype(int)]
    flag=later&(history>=2)
    def stats(mask):
        y=d[mask,4];return {'rows':len(y),'stations':len(np.unique(d[mask,0])),'returns':int(y.sum()),
          'return_rate':float(y.mean()) if len(y) else None,'confirmed_returns':int(np.isfinite(d[mask,5]).sum())}
    first=np.zeros(len(d),bool)
    for sid in np.unique(d[flag,0]):
        candidates=np.flatnonzero(flag&(d[:,0]==sid));first[candidates[np.argmin(d[candidates,2])]]=True
    station_rates=[d[flag&(d[:,0]==sid),4].mean() for sid in np.unique(d[flag,0])]
    report={'strict_rule':'at least two prior confirmed returns for this station/fuel/payment before the new >=10c jump',
        'selected':stats(flag),'recall_of_observed_returns':float(d[flag,4].sum()/d[later,4].sum()),
        'fresh_under_one_hour_flags':int((d[flag,7]<1).sum()),'first_flag_per_station':stats(first),
        'station_equal_weight_rate':float(np.mean(station_rates)),
        'station_bootstrap_95':interval(d[flag,4],d[flag,0]),'state_bootstrap_95':interval(d[flag,4],states[flag]),
        'non_midgrade':stats(flag&(d[:,1]//2!=1)),
        'non_midwest_four_states':stats(flag&~np.isin(states,['IN','IL','KY','MO'])),
        'by_state':{st:stats(flag&(states==st)) for st in np.unique(states[flag])},
        'by_product':{str(int(c)):stats(flag&(d[:,1]==c)) for c in np.unique(d[flag,1])}}
    # Episode and station totals explicitly expose duplicate product observations.
    report['station_hours']=len(np.unique(d[flag][:,[0,2]],axis=0))
    e=np.load(root/'models/evaluation.npz');test=e['split']==2;y=e['y'][test]
    _,groups=np.unique(e['meta'][test,0],return_inverse=True);n=groups.max()+1
    rng=np.random.default_rng(104);differences=[]
    for _ in range(300):
        weight=np.bincount(rng.integers(n,size=n),minlength=n)[groups]
        differences.append(average_precision_score(y,e['extended'][test],sample_weight=weight)-average_precision_score(y,e['existing'][test],sample_weight=weight))
    report['extended_minus_existing_ap_station_bootstrap_95']=np.percentile(differences,[2.5,97.5]).tolist()
    (out/'diagnostics.json').write_text(json.dumps(report,indent=2))
    fig,axes=plt.subplots(1,2,figsize=(12,4.7))
    labels=['No prior\nconfirmed return','≥1 prior\nconfirmed return','≥2 prior\nconfirmed returns']
    masks=[later&(history==0),later&(history>=1),later&(history>=2)]
    rates=[d[mask,4].mean()*100 for mask in masks]
    axes[0].bar(labels,rates,color=['#95a3af','#3277aa','#164d73'])
    for i,(rate,mask) in enumerate(zip(rates,masks)):
        axes[0].text(i,rate+2,f'{rate:.1f}%\nn={mask.sum():,}',ha='center',fontsize=10)
    axes[0].set_ylim(0,115);axes[0].set_ylabel('Later jumps returning within 6h (%)')
    axes[0].set_title('Same-station, same-product recurrence')
    for name,title in [('age_only','Age only'),('existing','Existing features'),('extended','Added refresh features')]:
        pr,re,_=precision_recall_curve(y,e[name][test]);ap=average_precision_score(y,e[name][test])
        axes[1].plot(re,pr,label=f'{title} (AP {ap:.3f})')
    axes[1].set(xlabel='Recall',ylabel='Precision',title='Separate confirmed-disagreement task',xlim=(0,1),ylim=(0,1))
    axes[1].legend(fontsize=9)
    fig.suptitle('Report anomalies: promising narrow signal, weak general improvement')
    fig.text(.5,.01,'Exploratory later development. Provider reports, not verified pump prices. Tasks and cohorts differ.',ha='center',fontsize=9)
    fig.tight_layout(rect=[0,.04,1,.94]);fig.savefig(out/'signals.png',dpi=180);plt.close(fig)
    print(json.dumps({k:v for k,v in report.items() if not k.startswith('by_')},indent=2))

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--root',type=Path,required=True);a.add_argument('--arrays',type=Path,required=True);a.add_argument('--out',type=Path,required=True);v=a.parse_args();run(v.root,v.arrays,v.out)
