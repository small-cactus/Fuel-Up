// Offline build-time downloader; never called by the app or research collector.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const workdir=process.argv[2];
if(!workdir)throw Error('Usage: node scripts/brand-assets/fetchLogos.mjs <workdir> (install sharp in <workdir>/tooling)');
const sharp = createRequire(path.resolve(workdir,'tooling/package.json'))('sharp');
const blockedHosts=new Set();
const root='modules/fuel-up-map-kit-routing/ios/Resources/BrandLogos';
const rows=JSON.parse(await fs.readFile(path.join(workdir,'matches.json'),'utf8'));
const reviewed=JSON.parse(await fs.readFile('docs/ui/brand-assets/reviewed-sources.json','utf8'));
const groups=new Map(); for(const row of rows) { const list=groups.get(row.wikidata)||[];list.push(row);groups.set(row.wikidata,list); }
await fs.mkdir(root,{recursive:true});
const manifest={}, evidence=[];
let cursor=0;const entries=[...groups];
async function fetchImage(url) {
 const host=new URL(url).host; if(blockedHosts.has(host))throw Error('Host deferred after rate limit');
 const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'FuelUpAssetBuilder/1.0'}});
 if(response.status===429){blockedHosts.add(host);throw Error(`HTTP 429; Retry-After=${response.headers.get('retry-after')||'unspecified'}; host deferred for this run`);}
 if(!response.ok)throw Error(`HTTP ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer()); if(bytes.length>5000000)throw Error('Image too large');
 return sharp(bytes,{limitInputPixels:30000000}).resize(64,64,{fit:'contain',background:'#ffffff'}).png().toBuffer();
}
async function worker(){while(cursor<entries.length){const [qid,names]=entries[cursor++];const row=names[0];const failures=[];let png,source;
 const candidates=Object.hasOwn(reviewed,qid) ? [reviewed[qid]].filter(Boolean) : [row.logos.wikidata,row.logos.facebook].filter(Boolean);
 for(const url of candidates){try{png=await fetchImage(url);source=url;break;}catch(e){failures.push({url,error:e.message});}}
 if(png){const file=`${qid}.png`;await fs.writeFile(path.join(root,file),png);
  for(const name of names)manifest[name.id]=file;
  evidence.push({qid,names:names.map(n=>n.name),stationCount:names.reduce((s,n)=>s+n.count,0),source,bytes:png.length,sha256:createHash('sha256').update(png).digest('hex'),failures});
 }else evidence.push({qid,names:names.map(n=>n.name),stationCount:names.reduce((s,n)=>s+n.count,0),failures});
 if(cursor%20===0) console.log(`${cursor}/${entries.length}`);
}}
await Promise.all(Array.from({length:4},worker));
for(const [alias,target] of Object.entries({'sams':"sam's club",'bjs':"bj's",'walmart-plus':'walmart','costco':'costco'})){if(manifest[target])manifest[alias]=manifest[target];}
await fs.writeFile(path.join(root,'brand-logos.json'),JSON.stringify(manifest,null,2));
await fs.mkdir('docs/ui/brand-assets',{recursive:true});
await fs.writeFile(path.join(workdir,'download-manifest.json'),JSON.stringify({catalog:'name-suggestion-index@8.0.20260918',generatedAt:new Date().toISOString(),width:64,height:64,assets:evidence.sort((a,b)=>b.stationCount-a.stationCount)},null,2));
console.log(JSON.stringify({identities:entries.length,bundled:evidence.filter(e=>e.source).length,bytes:evidence.reduce((s,e)=>s+(e.bytes||0),0),names:Object.keys(manifest).length}));
