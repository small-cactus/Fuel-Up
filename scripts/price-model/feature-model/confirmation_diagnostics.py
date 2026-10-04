"""Geographic dependence and paired station-choice checks after the frozen score."""
import argparse,json
from pathlib import Path
import numpy as np


def main(root,array_metadata):
    state=np.array(json.loads(array_metadata.read_text())['states']);report={}
    for kind in ['event','query']:
        folder=root/('confirmation-'+kind);d=np.load(folder/'evaluation.npz');p=np.load(folder/'predictions.npy');m=d['meta'];y=d['y'];raw=d['raw'];v=m[:,5]==1
        labels=state[m[v,0].astype(int)];names,inv=np.unique(labels,return_inverse=True);diff=(abs(p[v]-y[v])-abs(y[v]))*100
        sums=np.bincount(inv,weights=diff);counts=np.bincount(inv);rng=np.random.default_rng(411);boot=[]
        for _ in range(2000):
            ix=rng.integers(len(names),size=len(names));boot.append(sums[ix].sum()/counts[ix].sum())
        slices=[{'state':n,'n':int(counts[i]),'mae_delta_cents':float(sums[i]/counts[i])} for i,n in enumerate(names)]
        groups={}
        for i in np.flatnonzero(m[:,5]==2):groups.setdefault(tuple(m[i,[1,2,6]].astype(int)),[]).append(i)
        changed=0;known=0;cheaper=0;dearer=0;differences=[];panels=0
        for indices in groups.values():
            ix=np.array(indices)
            if len(ix)<5:continue
            panels+=1
            a=ix[np.lexsort((m[ix,0],raw[ix]))[0]];b=ix[np.lexsort((m[ix,0],raw[ix]+p[ix]))[0]]
            if a==b:continue
            changed+=1
            if not(np.isfinite(y[a]) and np.isfinite(y[b]) and abs(m[a,4]-m[b,4])<=2):continue
            known+=1;delta=(raw[b]+y[b]-raw[a]-y[a])*100;differences.append(float(delta));cheaper+=int(delta < -.0001);dearer+=int(delta > .0001)
        report[kind]={'row_weighted_mae_delta_cents':float(diff.mean()),'state_block_interval95_cents':np.quantile(boot,[.025,.975]).tolist(),'state_slices':slices,'price_only_choices':{'panels':panels,'changed_choices':changed,'known_changed_choices':known,'unknown_changed_choices':changed-known,'cheaper_choices':cheaper,'dearer_choices':dearer,'mean_chosen_price_delta_cents':float(np.mean(differences)) if differences else None},'limitations':['State bootstrap keeps nearby stations together but cannot eliminate nationwide shared shocks. Four overnight hours, not a complete independent market regime.','Choose stations using all contemporaneously available candidates before examining labels. Compare later reports only when both chosen labels exist within two hours. Most changed choices may be unknown.','Price-only selection omits distance, membership and preferences, and source reports are not pump truth.']}
    (root/'dependence-and-ranking.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:{a:b for a,b in v.items() if a!='state_slices'} for k,v in report.items()},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('array_metadata',type=Path);a=p.parse_args();main(a.root,a.array_metadata)
