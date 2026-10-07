// Reproducible marketing layouts. App captures remain unmodified apart from
// uniform resizing and rounding at the outside device edge.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const root = __dirname;
const features = [
  { file: '01-nearby', lines: ['Find cheaper gas.', 'Near you.'], sub: 'Compare nearby reported prices.', bg: '#DDF3E7', ink: '#102C23', accent: '#177447' },
  { file: '02-trends', lines: ['Gas prices change.', 'Stay in the know.'], sub: 'Explore national and local trends.', bg: '#E4EDF9', ink: '#142A43', accent: '#2462A2' },
  { file: '03-e85', lines: ['Your usual fuel.', 'And E85.'], sub: 'Spot E85 stations in yellow.', bg: '#F9EAB7', ink: '#302917', accent: '#8B6214' },
  { file: '04-brands', lines: ['Your stations.', 'Your way.'], sub: 'Choose brands and memberships.', bg: '#EAE6F5', ink: '#29223C', accent: '#7252A3' },
];
const sizes = { 'iphone-large': [1320,2868], 'iphone-medium': [1206,2622], 'iphone-compact': [1080,2340], ipad: [2064,2752] };
const svg = (w,h,body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
async function render(kind,w,h,f) {
  const tablet=kind==='ipad', unit=w/(tablet?2064:1320);
  const raw=path.join(root,'raw',tablet?'ipad':'iphone-large',`${f.file}.png`);
  const meta=await sharp(raw).metadata();
  const sw=Math.round((tablet?1460:980)*unit), sh=Math.round(sw*meta.height/meta.width);
  const x=Math.round((w-sw)/2), y=Math.round((tablet?670:620)*unit), r=Math.round((tablet?42:112)*unit), bezel=Math.round((tablet?24:15)*unit);
  if(y+sh+bezel>h-55*unit) throw new Error(`Device overflows ${kind}`);
  const logo=await sharp(path.join(root,'../../../assets/FuelUp-text-logo-light.png')).trim().resize({width:Math.round((tablet?340:275)*unit)}).png().toBuffer();
  const font=(tablet?142:118)*unit, baseline=(tablet?315:315)*unit, step=(tablet?153:126)*unit;
  const backdrop=svg(w,h,`<rect width="100%" height="100%" fill="${f.bg}"/>
    <circle cx="${w*.95}" cy="${h*.63}" r="${w*.8}" fill="white" opacity=".2"/>
    <g font-family="Helvetica Neue,Arial,sans-serif" text-anchor="middle" font-weight="700" letter-spacing="${-4*unit}">
      <text x="${w/2}" y="${baseline}" font-size="${font}" fill="${f.ink}">${f.lines[0]}</text>
      <text x="${w/2}" y="${baseline+step}" font-size="${font}" fill="${f.accent}">${f.lines[1]}</text>
    </g>
    <text x="${w/2}" y="${(tablet?550:520)*unit}" font-family="Helvetica Neue,Arial,sans-serif" text-anchor="middle" font-size="${(tablet?48:43)*unit}" fill="${f.ink}">${f.sub}</text>
    <rect x="${x-bezel}" y="${y-bezel}" width="${sw+2*bezel}" height="${sh+2*bezel}" rx="${r+bezel}" fill="#1C1F21"/>
  `);
  const screen=await sharp(raw).resize(sw,sh).composite([{input:svg(sw,sh,`<rect width="100%" height="100%" rx="${r}" fill="white"/>`),blend:'dest-in'}]).png().toBuffer();
  const dir=path.join(root,'exports',kind);await fs.mkdir(dir,{recursive:true});
  const out=path.join(dir,`${f.file}.png`);
  await sharp(backdrop).composite([{input:logo,top:Math.round((tablet?90:83)*unit),left:Math.round((w-(tablet?340:275)*unit)/2)},{input:screen,left:x,top:y}]).flatten({background:f.bg}).removeAlpha().png({compressionLevel:9}).toFile(out);
  const o=await sharp(out).metadata(); if(o.width!==w||o.height!==h||o.hasAlpha)throw Error('Export validation failed');
  return {file:path.relative(root,out),width:w,height:h,source:path.relative(root,raw)};
}
(async()=>{
 const manifest=[];
 for(const [kind,[w,h]]of Object.entries(sizes))for(const f of features)manifest.push(await render(kind,w,h,f));
 await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({features,exports:manifest},null,2)+'\n');
 for(const kind of Object.keys(sizes)){
   const thumbW=kind==='ipad'?330:280;
   const thumbs=await Promise.all(features.map(f=>sharp(path.join(root,'exports',kind,`${f.file}.png`)).resize({width:thumbW}).toBuffer()));
   const mh=await sharp(thumbs[0]).metadata();
   await sharp({create:{width:thumbW*4+60,height:mh.height+24,channels:3,background:'#FFFFFF'}}).composite(thumbs.map((input,i)=>({input,left:12+i*(thumbW+12),top:12}))).png().toFile(path.join(root,`preview-${kind}.png`));
 }
 console.log(`Rendered and validated ${manifest.length} screenshots.`);
})();
