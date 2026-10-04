"""Coordinates query an all-state national market memory; numeric Qwen transfer variant."""
import torch
from torch import nn


class NationalPrice(nn.Module):
    def __init__(self,features,width=256,layers=6):
        super().__init__()
        self.query=nn.Sequential(nn.Linear(features,width),nn.GELU(),nn.LayerNorm(width))
        self.market=nn.Sequential(nn.Linear(24,width),nn.GELU(),nn.Linear(width,width))
        self.attention=nn.MultiheadAttention(width,8,batch_first=True,dropout=.05)
        self.layers=nn.ModuleList([nn.Sequential(nn.LayerNorm(width),nn.Linear(width,width*2),nn.GELU(),nn.Dropout(.05),nn.Linear(width*2,width)) for _ in range(layers)])
        self.head=nn.Linear(width,2)
        nn.init.zeros_(self.head.weight);nn.init.zeros_(self.head.bias)

    def forward(self,x,context):
        query=self.query(x)
        memory=self.market(context)
        attended,_=self.attention(query[:,None],memory,memory,need_weights=False)
        h=query+attended[:,0]
        for block in self.layers:h=h+block(h)
        out=self.head(h)
        return out[:,0]*.1,out[:,1]


class QwenPrice(nn.Module):
    """LoRA fine-tuning of pretrained Qwen on numeric soft tokens, not generated prices.

    Six station feature tokens plus two full national context tokens and a query token.
    All state summaries are retained by flattening (no target-based selection).
    """
    def __init__(self,features,states,model_name,revision,cache):
        super().__init__()
        from transformers import AutoModel
        from peft import LoraConfig,get_peft_model
        base=AutoModel.from_pretrained(model_name,revision=revision,cache_dir=cache,torch_dtype=torch.bfloat16,attn_implementation='sdpa')
        width=base.config.hidden_size
        self.backbone=get_peft_model(base,LoraConfig(r=16,lora_alpha=32,lora_dropout=.05,target_modules=['q_proj','v_proj','k_proj','o_proj'],bias='none'))
        self.backbone.config.use_cache=False
        self.features=features;self.chunk=(features+5)//6
        self.station=nn.Linear(self.chunk,width)
        self.nation=nn.Linear(states*24//2,width)
        self.positions=nn.Parameter(torch.randn(1,9,width)*.01)
        self.query=nn.Parameter(torch.randn(1,1,width)*.01)
        self.head=nn.Linear(width,2)
        nn.init.zeros_(self.head.weight);nn.init.zeros_(self.head.bias)

    def forward(self,x,context):
        batch=len(x)
        x=nn.functional.pad(x,(0,self.chunk*6-self.features)).reshape(batch,6,self.chunk)
        a=self.station(x)
        b=self.nation(context.reshape(batch,2,-1))
        tokens=torch.cat([a,b,self.query.expand(batch,-1,-1)],dim=1)+self.positions
        out=self.backbone(inputs_embeds=tokens.to(torch.bfloat16),use_cache=False).last_hidden_state[:,-1]
        head=self.head(out)
        return head[:,0]*.1,head[:,1]
