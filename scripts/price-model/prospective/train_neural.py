"""Temporal transformer residual forecasters, with saved best validation checkpoints."""
import argparse,json,time,copy,random
from pathlib import Path
import numpy as np
import torch
from torch import nn
from train_trees import load
from evaluate import price_metrics,ranking_metrics,grouped_mae_interval

class TemporalPrice(nn.Module):
    def __init__(self,features,width,layers):
        super().__init__();self.project=nn.Linear(4,width);self.position=nn.Parameter(torch.zeros(1,24,width))
        layer=nn.TransformerEncoderLayer(width,8,width*4,dropout=.1,activation='gelu',batch_first=True,norm_first=True)
        self.temporal=nn.TransformerEncoder(layer,layers,enable_nested_tensor=False)
        self.tabular=nn.Sequential(nn.Linear(features,width*2),nn.GELU(),nn.Dropout(.1),nn.Linear(width*2,width),nn.GELU())
        self.head=nn.Sequential(nn.LayerNorm(width*2),nn.Linear(width*2,width),nn.GELU(),nn.Linear(width,1))
        nn.init.zeros_(self.head[-1].weight);nn.init.zeros_(self.head[-1].bias)
    def forward(self,x,sequence):
        h=self.temporal(self.project(sequence)+self.position)[:,-1]
        return self.head(torch.cat([h,self.tabular(x)],dim=-1)).squeeze(-1)*.1

def main(root,out):
    assert torch.cuda.is_available();torch.set_num_threads(8);torch.set_float32_matmul_precision('high')
    out.mkdir(exist_ok=True,parents=True);d=load(root);X,y,meta=d['X'],d['y'],d['meta'];tr=np.flatnonzero(meta[:,5]==0);va=np.flatnonzero(meta[:,5]==1);rank=np.flatnonzero(meta[:,5]==2)
    median=np.nanmedian(X[tr],axis=0);median=np.nan_to_num(median);fill=np.where(np.isfinite(X),X,median);mean=fill[tr].mean(0);scale=np.maximum(fill[tr].std(0),.01)
    features=np.concatenate([np.clip((fill-mean)/scale,-20,20),~np.isfinite(X)],axis=1).astype('float32')
    xt=torch.from_numpy(features);st=torch.from_numpy(d['sequence'].astype('float32'));yt=torch.from_numpy(y)
    np.savez(out/'normalization.npz',median=median,mean=mean,scale=scale)
    reports={}
    for width,layers in [(128,4),(256,6)]:
        name=f'temporal_{width}x{layers}';seed=11+width;random.seed(seed);np.random.seed(seed);torch.manual_seed(seed)
        model=TemporalPrice(features.shape[1],width,layers).cuda();params=sum(v.numel() for v in model.parameters());optimizer=torch.optim.AdamW(model.parameters(),lr=2e-4,weight_decay=.02)
        best=float('inf');patience=0;history=[];start=time.monotonic();batch=512
        def predict(indices):
            model.eval();ans=[]
            with torch.inference_mode(),torch.autocast('cuda',dtype=torch.bfloat16):
                for k in range(0,len(indices),batch):
                    ix=indices[k:k+batch];ans.append(model(xt[ix].cuda(),st[ix].cuda()).float().cpu().numpy())
            return np.concatenate(ans)
        for epoch in range(30):
            model.train();order=np.random.permutation(tr);loss_sum=0
            for k in range(0,len(order),batch):
                ix=order[k:k+batch];optimizer.zero_grad(set_to_none=True)
                with torch.autocast('cuda',dtype=torch.bfloat16):
                    pred=model(xt[ix].cuda(),st[ix].cuda());target=yt[ix].cuda()
                    loss=nn.functional.huber_loss(pred/.1,target/.1,delta=1.)+.05*nn.functional.mse_loss(pred/.1,target/.1)
                loss.backward();nn.utils.clip_grad_norm_(model.parameters(),1.);optimizer.step();loss_sum+=float(loss.detach())*len(ix)
            pv=predict(va);metric=price_metrics(y[va],pv);score=metric['mae_cents']+.1*metric['worst5_mean_cents']
            record={'epoch':epoch+1,'loss':loss_sum/len(tr),'seconds':time.monotonic()-start,**metric};history.append(record);print(json.dumps({'model':name,**record}),flush=True)
            if score<best:
                best=score;patience=0;torch.save({'state_dict':model.state_dict(),'width':width,'layers':layers,'features':features.shape[1],'epoch':epoch+1,'parameters':params},out/(name+'.pt'))
            else: patience+=1
            if patience>=5:break
        ckpt=torch.load(out/(name+'.pt'),weights_only=True);model.load_state_dict(ckpt['state_dict']);indices=np.flatnonzero(meta[:,5]!=0);pred=predict(indices);np.save(out/(name+'-predictions.npy'),pred)
        pm=meta[indices];vy=y[indices];raw=X[indices,0];sel=pm[:,5]==1;ranking=pm[:,5]==2
        reports[name]={'parameters':params,'best_epoch':ckpt['epoch'],'seconds':time.monotonic()-start,'history':history,'validation':price_metrics(vy[sel],pred[sel]),'ranking':ranking_metrics(raw[ranking],vy[ranking],pred[ranking],pm[ranking]),'station_interval':grouped_mae_interval(vy[sel],pred[sel],pm[sel,0])}
        (out/'neural-results.json').write_text(json.dumps(reports,indent=2));del model;torch.cuda.empty_cache()
    print(json.dumps(reports),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('dataset',type=Path);p.add_argument('out',type=Path);a=p.parse_args();main(a.dataset,a.out)
