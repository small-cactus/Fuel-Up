const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const os=require('node:os');const {execFileSync}=require('node:child_process');
const root='modules/fuel-up-map-kit-routing/ios/Resources';
test('bundled logos are exact 64px assets with provenance, matching hashes, and offline membership coverage',()=>{
 const manifest=JSON.parse(fs.readFileSync(`${root}/BrandLogos/brand-logos.json`));const evidence=JSON.parse(fs.readFileSync('docs/ui/brand-assets/logo-manifest.json'));const assets=new Map(evidence.assets.filter(a=>a.source).map(a=>[`${a.qid}.png`,a]));let bytes=0;
 for(const file of new Set(Object.values(manifest))){const image=fs.readFileSync(`${root}/BrandLogos/${file}`);assert.equal(image.readUInt32BE(16),64);assert.equal(image.readUInt32BE(20),64);const source=assets.get(file);assert.ok(source);assert.equal(crypto.createHash('sha256').update(image).digest('hex'),source.sha256);bytes+=image.length;}
 assert.ok(bytes<1e9);for(const id of ['sams','costco','bjs','walmart-plus'])assert.ok(manifest[id]);
 for(const fuel of ['regular','midgrade','premium','diesel','e85']){const svg=fs.readFileSync(`${root}/FuelIcons.xcassets/fuel-${fuel}.imageset/icon.svg`,'utf8');assert.match(svg,/viewBox="0 0 64 64"/);assert.doesNotMatch(svg,/<(?:text|image)|href=/);}
});
test('native radius gesture snapping stays inside the same whole-mile settings range',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fuelup-radius-'));
 try {const source=fs.readFileSync('modules/fuel-up-map-kit-routing/ios/Onboarding/RadiusSelection.swift','utf8');fs.writeFileSync(`${dir}/main.swift`,source+`\nassert(RadiusSelection.snap(6.49)==6)\nassert(RadiusSelection.snap(6.51)==7)\nassert(RadiusSelection.scaled(8,by:2)==15)\nassert(RadiusSelection.scaled(4,by:0.1)==2)\nassert(RadiusSelection.snap(.nan)==2)\nfor n in RadiusSelection.notches { assert(RadiusSelection.snap(Double(n))==Double(n)) }\n`);execFileSync('swift',[`${dir}/main.swift`],{timeout:30000});} finally {fs.rmSync(dir,{recursive:true,force:true});}
});
