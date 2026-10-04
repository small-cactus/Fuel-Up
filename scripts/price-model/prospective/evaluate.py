"""Development metrics; never read final holdout or mask candidates by outcomes."""
import numpy as np

def price_metrics(y,pred):
    e=pred-y;a=np.abs(e);changed=np.abs(y)>=.09999
    return {'n':len(y),'mae_cents':float(a.mean()*100),'rmse_cents':float(np.sqrt((e*e).mean())*100),
      'worst5_mean_cents':float(np.sort(a)[-max(1,int(np.ceil(len(a)*.05))):].mean()*100),
      'p95_cents':float(np.quantile(a,.95)*100),'within5':float((a<=.050001).mean()),'within10':float((a<=.100001).mean()),
      'under10':float((e<-.100001).mean()),'over10':float((e>.100001).mean()),
      'changed_n':int(changed.sum()),'changed_mae_cents':float(a[changed].mean()*100) if changed.any() else None,
      'unchanged_mae_cents':float(a[~changed].mean()*100) if (~changed).any() else None}

def ranking_metrics(raw,y,pred,meta):
    # Grade/payment, decision hour and city. Price-only six-mile panels.
    groups={}
    for i,row in enumerate(meta): groups.setdefault((int(row[1]),int(row[2]),int(row[6])),[]).append(i)
    regret=[];falsecheap=0;unknown=0;panels=0;candidates=0;labeled=0
    for indices in groups.values():
        ix=np.array(indices)
        if len(ix)<5: continue
        panels+=1;candidates+=len(ix);labeled+=np.isfinite(y[ix]).sum()
        winner=ix[np.lexsort((meta[ix,0],raw[ix]+pred[ix]))[0]]
        # Winner selected across ALL candidates before looking at target availability.
        usable=ix[np.isfinite(y[ix]) & (abs(meta[ix,4]-meta[winner,4])<=2)]
        usable=usable[usable!=winner]
        if not np.isfinite(y[winner]) or len(usable)==0: unknown+=1;continue
        target=raw[winner]+y[winner];gap=max(0,float(target-np.min(raw[usable]+y[usable])))
        regret.append(gap);falsecheap+=int(gap>1e-6 and y[winner]-pred[winner]>=.10)
    return {'panels':panels,'known_panels':len(regret),'unknown_panels':unknown,'candidate_count':candidates,'labeled_candidates':int(labeled),
      'mean_regret_cents':float(np.mean(regret)*100) if regret else None,
      'worst5_regret_cents':float(np.mean(sorted(regret)[-max(1,int(np.ceil(len(regret)*.05))):])*100) if regret else None,
      'regret10_count':int(np.sum(np.array(regret)>=.10)),'false_cheap_count':falsecheap,
      'limitation':'Later-report price-only lower-bound regret; not simultaneous pump truth or actual membership/distance/preferences ranking. Policy label denominators may differ.'}

def grouped_mae_interval(y,pred,station,draws=500):
    ids,inv=np.unique(station,return_inverse=True)
    # Paired difference to raw, equal weight per independent station group.
    diff=np.abs(pred-y)-np.abs(y)
    sums=np.bincount(inv,weights=diff);counts=np.bincount(inv);means=sums/counts
    rng=np.random.default_rng(20261004)
    bootstrap=np.array([means[rng.integers(len(ids),size=len(ids))].mean() for _ in range(draws)])*100
    return {'station_groups':len(ids),'mean_delta_cents':float(means.mean()*100),'interval95_cents':np.quantile(bootstrap,[.025,.975]).tolist()}
