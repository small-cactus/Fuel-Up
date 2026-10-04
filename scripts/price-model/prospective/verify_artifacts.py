"""Verify the preserved experiment bundle without loading executable models."""
import argparse,hashlib,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('artifacts',type=Path);a=p.parse_args();root=a.artifacts.resolve()
m=json.loads((root/'artifact-manifest.json').read_text())
for name,expected in m.items():
    file=(root/name).resolve();assert file.is_relative_to(root),name
    assert file.stat().st_size==expected['bytes'],name
    assert hashlib.sha256(file.read_bytes()).hexdigest()==expected['sha256'],name
print(json.dumps({'verified_files':len(m),'passed':True}))
