import json,re,unicodedata,argparse
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument("--workdir",type=Path,required=True,help="Directory containing inventory.json and unpacked NSI package")
workdir=parser.parse_args().workdir
from collections import Counter,defaultdict
norm=lambda s:re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',s).lower())
n=json.load(open(workdir/'package/dist/json/nsi.json'))['nsi'];w=json.load(open(workdir/'package/dist/wikidata/wikidata.json'))['wikidata']
lookup=defaultdict(dict)
for key in ['brands/amenity/fuel','brands/shop/convenience','brands/shop/supermarket','brands/shop/wholesale']:
 for e in n[key]['items']:
  inc=e.get('locationSet',{}).get('include',[]); exc=e.get('locationSet',{}).get('exclude',[])
  if 'us' in exc or not any(isinstance(s,str) and (s in ['001','us'] or s.startswith('us-')) for s in inc):continue
  q=e['tags'].get('brand:wikidata'); data=w.get(q,{})
  if not q:continue
  for name in [e['tags'].get('brand',''),e['tags'].get('name','')]+e.get('matchNames',[]):
   if name:lookup[norm(name)].setdefault(q,dict(data, category=key))
# Reviewed aliases, limited to the same operator identity.
for alias, target in {"Love's Travel Stop":"Love's", "Huck's":"Huck's Food & Fuel", "Speedway Express":"Speedway", "Walmart Neighborhood Market":"Walmart", "Walmart+":"Walmart"}.items():
 lookup[norm(alias)] = lookup.get(norm(target),{})

inventory=json.load(open(workdir/'inventory.json'))['brands']; rows=[];matched=Counter();unmatched=[]
for group in inventory:
 for b in group['brands']:
  name=b.get('name') or '';matches=lookup.get(norm(name),{})
  fuel_matches={q:d for q,d in matches.items() if d.get('category')=='brands/amenity/fuel'}
  if fuel_matches: matches=fuel_matches
  if len(matches)==1:
   q,d=next(iter(matches.items()));rows.append({'name':name,'id':name.strip().lower(),'count':group['stations'],'wikidata':q,'logos':d.get('logos',{}),'website':d.get('identities',{}).get('website')});matched[q]+=group['stations']
  else:unmatched.append({'name':name,'stations':group['stations'],'reason':'ambiguous' if matches else 'no catalog match'})
json.dump(rows,open(workdir/'matches.json','w'),indent=2);json.dump(unmatched,open(workdir/'unmatched.json','w'),indent=2)
print(len(rows),'matched names',len(matched),'identities',sum(matched.values()),'station memberships');print('unmatched top',unmatched[:25])
