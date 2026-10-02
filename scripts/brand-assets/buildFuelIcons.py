"""Build small vector pump illustrations with outlined numerals (no SVG fonts)."""
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
font=TTFont('/System/Library/Fonts/Supplemental/Arial Bold.ttf'); glyphs=font.getGlyphSet();cmap=font.getBestCmap();upm=font['head'].unitsPerEm
root=Path('modules/fuel-up-map-kit-routing/ios/Resources/FuelIcons.xcassets')
root.mkdir(parents=True, exist_ok=True)
(root/'Contents.json').write_text(json.dumps({'info':{'author':'xcode','version':1}}))
for key,text,color in [('regular','87','#F9D838'),('midgrade','89','#F9D838'),('premium','93','#F9D838'),('diesel','D','#1E8C50'),('e85','E85','#F9D838')]:
 size=15 if len(text)>2 else 20
 scale=size/upm;width=sum(glyphs[cmap[ord(c)]].width for c in text)*scale;x=25-width/2; paths=[]
 for c in text:
  g=glyphs[cmap[ord(c)]];pen=SVGPathPen(glyphs);g.draw(pen)
  paths.append(f'<path transform="translate({x:.3f} 32) scale({scale:.6f} {-scale:.6f})" d="{pen.getCommands()}"/>');x+=g.width*scale
 svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
 <path d="M43 18h5l6 7v22a4 4 0 0 1-8 0V35h-4" fill="none" stroke="#34383E" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="m48 18 6 7v7h-4l-3-8z" fill="#34383E"/>
 <rect x="7" y="6" width="36" height="49" rx="6" fill="{color}"/>
 <rect x="12" y="13" width="26" height="24" rx="3" fill="#FFFDF1"/>
 <g fill="#20242B">{''.join(paths)}</g>
 <path d="M14 45h22" stroke="#20242B" stroke-width="3" stroke-linecap="round"/>
 <rect x="4" y="54" width="42" height="5" rx="2.5" fill="#34383E"/>
</svg>'''
 dest=root/f'fuel-{key}.imageset';dest.mkdir(exist_ok=True)
 (dest/'icon.svg').write_text(svg)
 (dest/'Contents.json').write_text(json.dumps({'images':[{'filename':'icon.svg','idiom':'universal'}],'info':{'author':'xcode','version':1},'properties':{'preserves-vector-representation':True}},indent=2))
