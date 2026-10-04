"""Frozen temporal residual network shared by training and inference."""
import torch
from torch import nn

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

