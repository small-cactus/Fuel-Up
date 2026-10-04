"""Isolated TimesFM 3 research benchmark; predictions are not production artifacts."""
import argparse,os,sys,json,time,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('root',type=Path);a=p.parse_args();root=a.root
os.environ['HF_HOME']=str(root/'hf-cache');os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
sys.path.insert(0,str(root/'src'))
import numpy as np
import torch
from huggingface_hub import HfApi
from timesfm3 import TimesFM3Forecaster
from evaluate import price_metrics,grouped_mae_interval

torch.set_num_threads(4);torch.set_float32_matmul_precision('high')
out=root/'timesfm-results';out.mkdir(exist_ok=True)
d=np.load(root/'timesfm-contexts.npz');ctx,cov,lengths,y,meta=d['contexts'],d['covariates'],d['lengths'],d['y'],d['meta'];raw=d['raw']
revision=HfApi().model_info('google/timesfm-3.0-pytorch').sha
print(json.dumps({'loading':'google/timesfm-3.0-pytorch','revision':revision,'research_only':True}),flush=True)
f=TimesFM3Forecaster.from_pretrained('google/timesfm-3.0-pytorch',device='cuda',cache_dir=str(root/'hf-cache'),revision=revision,per_core_batch_size=64)
results={'revision':revision,'parameters':sum(v.numel() for v in f.model.parameters()),'examples':len(y),'raw':price_metrics(y,np.zeros(len(y))),
 'task':'Predict one next report-indexed observation; past report intervals are irregular. Actual future report time is not provided.',
 'license':'TimesFM Non-Commercial License v1.0. Isolated research benchmark, no production use or distillation.', 'variants':{}}
for name,with_covariates in [('event_series',False),('event_series_with_timing',True)]:
    start=time.monotonic();mapping={};unique=[];inverse=[]
    for k,n in enumerate(lengths):
        key=ctx[k,-n:].tobytes()+(cov[k,:,-n:].tobytes() if with_covariates else b'')
        if key not in mapping:mapping[key]=len(unique);unique.append(k)
        inverse.append(mapping[key])
    answers=[]
    for b in range(0,len(unique),128):
        ix=unique[b:b+128];contexts=[ctx[k,-lengths[k]:] for k in ix]
        kwargs={'past_only_covariates':[cov[k,:,-lengths[k]:] for k in ix]} if with_covariates else {}
        with torch.inference_mode():
            outputs=list(f.predict_batch(contexts,horizon=1,return_quantiles=False,use_symmetric_averaging=False,**kwargs))
        answers.extend(float(np.asarray(x.forecast).reshape(-1)[0]) for x in outputs)
        if b%4096==0:print(json.dumps({'variant':name,'unique_done':min(b+128,len(unique)),'unique_total':len(unique),'seconds':time.monotonic()-start}),flush=True)
    prediction=np.array(answers,dtype='float32')[inverse]-raw;assert np.isfinite(prediction).all()
    np.save(out/(name+'-predictions.npy'),prediction)
    results['variants'][name]={'unique_contexts':len(unique),'seconds':time.monotonic()-start,'metrics':price_metrics(y,prediction),'station_interval':grouped_mae_interval(y,prediction,meta[:,0])}
    (out/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps({'variant':name,**results['variants'][name]}),flush=True)
print(json.dumps(results),flush=True)
