"""Pin/download public Qwen weights once; no research data leaves the training host."""
import argparse,json
from pathlib import Path
from huggingface_hub import HfApi,snapshot_download

p=argparse.ArgumentParser();p.add_argument('root',type=Path);a=p.parse_args()
name='Qwen/Qwen3-0.6B-Base';revision=HfApi().model_info(name).sha
path=snapshot_download(name,revision=revision,cache_dir=str(a.root/'hf-cache'),allow_patterns=['*.json','*.safetensors','LICENSE','README.md'])
(a.root/'qwen-source.json').write_text(json.dumps({'model':name,'revision':revision,'cache_path':path,'license':'Apache-2.0','source':'https://huggingface.co/Qwen/Qwen3-0.6B-Base'},indent=2))
print(path)
