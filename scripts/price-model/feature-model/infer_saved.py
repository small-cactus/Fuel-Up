"""Reload saved predictors with no outcome-dependent input; replay and later-slice inference."""
import argparse,json
from pathlib import Path
import numpy as np
import torch
from catboost import CatBoostRegressor,CatBoostClassifier
from spatial_network import NationalPrice,QwenPrice


def neural_predict(folder,X,m,contexts,cache):
    spec=json.loads((folder/'spec.json').read_text());norm=np.load(folder/'normalization.npz')
    X=X[:,:len(norm['median'])];finite=np.isfinite(X);fill=np.where(finite,X,norm['median'])
    feature=np.concatenate([np.clip((fill-norm['mean'])/norm['std'],-20,20),~finite],axis=1).astype('float32')
    scale=np.array([90,180,5,5,5,5,10,168,1,.1,.1,.1],dtype='float32')
    c=np.concatenate([np.clip(np.nan_to_num(contexts)/scale,-10,10),~np.isfinite(contexts)],axis=-1).astype('float32')
    bank=torch.from_numpy(c).cuda()
    if spec['kind']=='qwen':model=QwenPrice(spec['features'],spec['national_states'],spec['model_name'],spec['revision'],str(cache),str(folder/'adapter')).cuda()
    else:model=NationalPrice(spec['features'],256 if spec['kind']=='spatial256' else 512,6).cuda()
    ckpt=torch.load(folder/'best.pt',weights_only=False,map_location='cuda')
    if spec['kind']=='qwen':
        missing,unexpected=model.load_state_dict(ckpt['state_dict'],strict=False)
        assert not unexpected and all(k.startswith('backbone.') for k in missing)
    else:model.load_state_dict(ckpt['state_dict'])
    model.eval();pred=[];prob=[];batch=spec['batch']
    with torch.inference_mode(),torch.autocast('cuda',dtype=torch.bfloat16):
        for lo in range(0,len(X),batch):
            ix=slice(lo,lo+batch);t=torch.from_numpy(m[ix,2].astype('int64')).cuda();g=torch.from_numpy(m[ix,1].astype('int64')).cuda()
            p,q=model(torch.from_numpy(feature[ix]).cuda(),bank[t,g]);pred.append(p.float().cpu().numpy());prob.append(q.sigmoid().float().cpu().numpy())
    return np.concatenate(pred),np.concatenate(prob)


def main(dataset,context,models,out,cache,replay):
    torch.set_num_threads(8);torch.set_float32_matmul_precision('high')
    pieces=[np.load(f) for f in sorted(dataset.glob('part-*.npz'))]
    X=np.concatenate([p['X'] for p in pieces]);m=np.concatenate([p['meta'] for p in pieces]);ey=np.concatenate([p['y'] for p in pieces])
    ev=m[:,5]!=0;X=X[ev];m=m[ev];ey=ey[ev]
    contexts=np.load(context);out.mkdir(exist_ok=True,parents=True);report={}
    for folder in models.iterdir():
        if not folder.is_dir():continue
        if (folder/'signed-spec.json').exists():
            from train_signed import signed_predict
            predictions,prob=signed_predict(folder,X)
            for name,pred in predictions.items():
                np.save(out/(folder.name+'_'+name+'-predictions.npy'),pred)
                if replay:
                    old=np.load(folder/(name+'-predictions.npy'));err=float(np.max(abs(old-pred)))
                    report[name]={'max_abs_delta':err,'exact':bool(np.array_equal(old,pred))};assert err<1e-6
        elif (folder/'spec.json').exists() and (folder/'best.pt').exists():
            pred,prob=neural_predict(folder,X,m,contexts,cache)
            np.save(out/(folder.name+'-predictions.npy'),pred);np.save(out/(folder.name+'-probabilities.npy'),prob)
            if replay:
                old=np.load(folder/'best-predictions.npy');err=float(np.max(abs(pred-old)))
                report[folder.name]={'max_abs_delta':err,'exact':bool(np.array_equal(old,pred))}
                assert err<1e-6
            torch.cuda.empty_cache()
        elif (folder/'features.json').exists():
            result=json.loads((folder/'results.json').read_text())
            for name,entry in result['models'].items():
                model=CatBoostRegressor();model.load_model(str(folder/(name+'.cbm')));pred=model.predict(X[:,:entry['columns']]).astype('float32')
                np.save(out/(folder.name+'_'+name+'-predictions.npy'),pred)
                if replay:
                    old=np.load(folder/(name+'-predictions.npy'));err=float(np.max(abs(old-pred)))
                    report[name]={'max_abs_delta':err,'exact':bool(np.array_equal(old,pred))};assert err<1e-6
            classifier=CatBoostClassifier();classifier.load_model(str(folder/'stale-proxy.cbm'))
            np.save(out/(folder.name+'-probabilities.npy'),classifier.predict_proba(X)[:,1].astype('float32'))
    np.savez_compressed(out/'evaluation.npz',y=ey,meta=m,raw=X[:,0]);(out/'verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('context',type=Path);p.add_argument('models',type=Path);p.add_argument('out',type=Path);p.add_argument('--cache',type=Path,required=True);p.add_argument('--replay',action='store_true');a=p.parse_args();main(a.dataset,a.context,a.models,a.out,a.cache,a.replay)
