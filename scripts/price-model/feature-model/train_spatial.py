"""National-context neural regression plus stale-report-proxy classification.

Includes actual LoRA updates to a pretrained Qwen backbone, with a numeric price head.
"""
import argparse,json,time,random,hashlib
from pathlib import Path
import numpy as np
import torch
from torch import nn
from sklearn.metrics import average_precision_score,roc_auc_score,brier_score_loss
from common import load,normalizer,record_predictions,summarize,policies
from spatial_network import NationalPrice,QwenPrice


def main(root,context_path,out,kind,epochs,init=None):
    assert torch.cuda.is_available()
    torch.set_num_threads(8);torch.set_float32_matmul_precision('high')
    random.seed(104);np.random.seed(104);torch.manual_seed(104)
    out.mkdir(exist_ok=True,parents=True)
    d=load(root);X,y,m=d['X'],d['y'],d['meta'];tr=np.flatnonzero(m[:,5]==0);ev=np.flatnonzero(m[:,5]!=0);va=np.flatnonzero(m[:,5]==1)
    assert (m[tr,4]<72).all() and (m[:,3]<120).all()
    if init:
        norm=dict(np.load(init/'normalization.npz'));assert len(norm['median'])==X.shape[1]
        finite=np.isfinite(X);fill=np.where(finite,X,norm['median'])
        feature=np.concatenate([np.clip((fill-norm['mean'])/norm['std'],-20,20),~finite],axis=1).astype('float32')
    else:feature,norm=normalizer(X,tr)
    np.savez(out/'normalization.npz',**norm)
    contexts=np.load(context_path);valid=np.isfinite(contexts)
    # Fixed physical units, not statistics fitted on future national windows.
    scale=np.array([90,180,5,5,5,5,10,168,1,.1,.1,.1],dtype='float32')
    contexts=np.concatenate([np.clip(np.nan_to_num(contexts)/scale,-10,10),~valid],axis=-1).astype('float32')
    bank=torch.from_numpy(contexts).cuda()
    xx=torch.from_numpy(feature);tt=torch.from_numpy(m[:,2].astype('int64'));cc=torch.from_numpy(m[:,1].astype('int64'));yy=torch.from_numpy(np.nan_to_num(y))
    revision=None
    if kind=='qwen':
        resource_root=context_path.parent
        source=json.loads((resource_root/'qwen-source.json').read_text())
        model_name=source['model'];revision=source['revision']
        model=QwenPrice(feature.shape[1],contexts.shape[2],model_name,revision,str(resource_root/'hf-cache'),str(init/'adapter') if init else None).cuda()
        if init:
            # Inference loader freezes adapters; explicitly train them for this continuation.
            for name,param in model.backbone.named_parameters():
                if 'lora_' in name:param.requires_grad_(True)
            checkpoint=torch.load(init/'best.pt',weights_only=False,map_location='cuda')
            missing,unexpected=model.load_state_dict(checkpoint['state_dict'],strict=False)
            assert not unexpected and all(k.startswith('backbone.') for k in missing)
        batch=256;lr=1e-4
    else:
        width=256 if kind=='spatial256' else 512
        model=NationalPrice(feature.shape[1],width,6).cuda();batch=1024;lr=2e-4
    trainable=sum(p.numel() for p in model.parameters() if p.requires_grad);total=sum(p.numel() for p in model.parameters())
    optimizer=torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],lr=lr,weight_decay=.02)
    spec={'kind':kind,'parameters':total,'trainable_parameters':trainable,'features':feature.shape[1],'national_states':contexts.shape[2],'batch':batch,'learning_rate':lr,'max_epochs':epochs,'revision':revision,'model_name':'Qwen/Qwen3-0.6B-Base' if kind=='qwen' else None,'train_rows':len(tr),'validation_rows':len(va),'tokenization':'9 learned numeric soft tokens, no text tokenizer' if kind=='qwen' else 'one station query and all state summary tokens','compile':False,'device':torch.cuda.get_device_name(),'context_sha256':hashlib.sha256(context_path.read_bytes()).hexdigest(),'fairness':'Different architectures and compute budgets; predictive-system comparison, not parameter-matched architectural superiority.'}
    spec['initial_checkpoint']=str(init) if init else None
    (out/'spec.json').write_text(json.dumps(spec,indent=2));print(json.dumps(spec),flush=True)
    def predict(indices):
        model.eval();pp=[];pr=[]
        with torch.inference_mode(),torch.autocast('cuda',dtype=torch.bfloat16):
            for lo in range(0,len(indices),batch):
                ix=indices[lo:lo+batch];pred,logit=model(xx[ix].cuda(),bank[tt[ix].cuda(),cc[ix].cuda()])
                pp.append(pred.float().cpu().numpy());pr.append(logit.sigmoid().float().cpu().numpy())
        return np.concatenate(pp),np.concatenate(pr)
    start=time.monotonic();best=float('inf');patience=0;history=[];steps=0
    # Select the model and its sparse rule on development together; all trials are retained.
    for epoch in range(epochs):
        model.train();order=np.random.permutation(tr);loss_sum=0
        for lo in range(0,len(order),batch):
            ix=order[lo:lo+batch];target=yy[ix].cuda();optimizer.zero_grad(set_to_none=True)
            with torch.autocast('cuda',dtype=torch.bfloat16):
                pred,logit=model(xx[ix].cuda(),bank[tt[ix].cuda(),cc[ix].cuda()])
                loss=nn.functional.huber_loss(pred/.1,target/.1,delta=1)+.05*nn.functional.mse_loss(pred/.1,target/.1)+.1*nn.functional.binary_cross_entropy_with_logits(logit,(target.abs()>=.09999).float())
            loss.backward();nn.utils.clip_grad_norm_(model.parameters(),1);optimizer.step()
            loss_sum+=float(loss.detach())*len(ix);steps+=1
            if steps%500==0: print(json.dumps({'epoch':epoch+1,'steps':steps,'rows_this_epoch':lo+len(ix),'seconds':time.monotonic()-start}),flush=True)
        p,prob=predict(va);base=summarize(y[va],p,m[va]);trials={rule:summarize(y[va],q,m[va]) for rule,q in policies(p)}
        # Same conservative 20-cent bound as first experiment; no cap selection here.
        rule=min((k for k in trials if k.endswith('cap0.2')),key=lambda k:trials[k]['mae_cents'])
        score=trials[rule]['mae_cents'];history.append({'epoch':epoch+1,'loss':loss_sum/len(tr),'seconds':time.monotonic()-start,'unbounded':base,'policies':trials,'best_policy':rule,'stale_average_precision':average_precision_score(abs(y[va])>=.09999,prob)})
        (out/'history.json').write_text(json.dumps(history,indent=2));print(json.dumps({'epoch':epoch+1,'policy':rule,**trials[rule]}),flush=True)
        if score<best:
            best=score;patience=0
            if kind=='qwen':
                model.backbone.save_pretrained(out/'adapter')
                state={k:v for k,v in model.state_dict().items() if not k.startswith('backbone.')}
            else:state=model.state_dict()
            torch.save({'state_dict':state,'epoch':epoch+1,'policy':rule,'spec':spec},out/'best.pt')
            ep,eprob=predict(ev);np.save(out/'best-predictions.npy',ep);np.save(out/'stale-probabilities.npy',eprob)
        else:patience+=1
        if patience>=3:break
    best_ckpt=torch.load(out/'best.pt',weights_only=False);pred=np.load(out/'best-predictions.npy');prob=np.load(out/'stale-probabilities.npy');em=m[ev];ey=y[ev];v=em[:,5]==1
    result=record_predictions(out,'model',ey,pred,em)
    result.update(spec=spec,best_epoch=best_ckpt['epoch'],policy=best_ckpt['policy'],steps=steps,rows_seen=sum(len(tr) for _ in history),seconds=time.monotonic()-start,epochs_attempted=len(history),classifier={'prevalence':float((abs(ey[v])>=.09999).mean()),'average_precision':average_precision_score(abs(ey[v])>=.09999,prob[v]),'roc_auc':roc_auc_score(abs(ey[v])>=.09999,prob[v]),'brier':brier_score_loss(abs(ey[v])>=.09999,prob[v])})
    np.savez_compressed(out/'evaluation.npz',y=ey,meta=em,raw=X[ev,0]);(out/'results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('context',type=Path);p.add_argument('out',type=Path);p.add_argument('--kind',choices=['spatial256','spatial512','qwen'],default='spatial256');p.add_argument('--epochs',type=int,default=12);p.add_argument('--init',type=Path);a=p.parse_args();main(a.dataset,a.context,a.out,a.kind,a.epochs,a.init)
