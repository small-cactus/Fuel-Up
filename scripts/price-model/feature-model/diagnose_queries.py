"""Age, selective-correction and classifier diagnostics; no tuning."""
import argparse,json
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.metrics import precision_recall_curve


def main(root):
    d=np.load(root/'trees/evaluation.npz');v=d['meta'][:,5]==1;X=d['X'][v];y=d['y'][v]
    prob=np.load(root/'trees/stale-probabilities.npy')[v];pred=np.load(root/'frozen-selected-predictions.npy')[v]
    truth=abs(y)>=.09999;precision,recall,_=precision_recall_curve(truth,prob)
    fig,axes=plt.subplots(1,2,figsize=(11,4));axes[0].plot(recall,precision,label='Future-report change classifier');axes[0].axhline(truth.mean(),color='gray',ls='--',label='Prevalence');axes[0].set(xlabel='Recall of changes ≥10 cents',ylabel='Precision',title='Change detection on query-time development');axes[0].legend(fontsize=8)
    bins=[]
    for indices in np.array_split(np.argsort(prob),10):
        bins.append({'n':len(indices),'predicted':float(prob[indices].mean()),'observed':float(truth[indices].mean())})
    axes[1].plot([0,1],[0,1],ls='--',color='gray');axes[1].plot([b['predicted'] for b in bins],[b['observed'] for b in bins],'o-');axes[1].set(xlabel='Mean predicted probability',ylabel='Observed correction fraction',title='Calibration: equal-count bins',xlim=(0,.5),ylim=(0,.5));fig.tight_layout();fig.savefig(root/'classifier-diagnostics.png',dpi=170);plt.close(fig)
    rows=[]
    for lo,hi in [(0,1),(1,6),(6,24),(24,168)]:
        ix=(X[:,1]>=lo)&(X[:,1]<hi);delta=abs(pred[ix]-y[ix])-abs(y[ix])
        rows.append({'age_hours':f'{lo}–{hi}','n':int(ix.sum()),'raw_mae_cents':float(abs(y[ix]).mean()*100),'frozen_mae_cents':float(abs(pred[ix]-y[ix]).mean()*100),'better':int((delta<-1e-6).sum()),'worse':int((delta>1e-6).sum()),'changes10':int(truth[ix].sum())})
    fig,ax=plt.subplots(figsize=(8,4));x=np.arange(len(rows));ax.bar(x-.18,[r['raw_mae_cents'] for r in rows],.36,label='Last reported price');ax.bar(x+.18,[r['frozen_mae_cents'] for r in rows],.36,label='Frozen gated correction');ax.set_xticks(x,[r['age_hours'] for r in rows]);ax.set(xlabel='Age of source quote, hours',ylabel='MAE, cents/gal',title='Same development examples, grouped by quote age');ax.legend();fig.tight_layout();fig.savefig(root/'age-errors.png',dpi=170);plt.close(fig)
    (root/'query-diagnostics.json').write_text(json.dumps({'ages':rows,'calibration':bins,'caveat':'Next newer provider report within 24h, not verified current pump price. Missing targets excluded. This is selection data, not independent confirmation.'},indent=2));print(json.dumps(rows))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);a=p.parse_args();main(a.root)
