import Foundation

/// Direct-light transport integrated over the actual rectangular button surface.
/// Shadow rays intersect the extruded glyph atlas. No radial glow or beam sprite.
enum SuperSaverMetalShader {
  static let source = """
  #include <metal_stdlib>
  using namespace metal;
  constant float PI = 3.14159265;
  constant float titleRelief = 0.012;
  constant float priceRelief = 0.0016;
  constant int areaSamples = 64;
  constexpr sampler glyphSampler(coord::normalized, address::clamp_to_zero, filter::linear);
  struct Raster { float4 position [[position]]; float2 uv; };
  struct Uniforms { float4 settings; float4 rect; float4 lamp; float4 atlas; float4 textA; float4 textB; float4 display; };
  vertex Raster saverVertex(uint id [[vertex_id]]) {
    float2 p = float2((id << 1) & 2, id & 2);
    Raster out; out.position = float4(p * 2.0 - 1.0, 0.0, 1.0);
    out.uv = float2(p.x, 1.0 - p.y); return out;
  }
  float mask(texture2d<float> glyphs, float2 uv, constant Uniforms &u) {
    float4 r=u.textA; float tile=0.0;
    if(!all(uv>=r.xy)||!all(uv<=r.zw)) {r=u.textB;tile=1.0;}
    if(!all(uv>=r.xy)||!all(uv<=r.zw)) return 0.0;
    float2 local=(uv-r.xy)/max(r.zw-r.xy,float2(0.00001));
    return glyphs.sample(glyphSampler,float2(local.x,(local.y+tile)*0.5)).a;
  }
  // The glyph's interior is a raised plane. A short bevel closes its edge.
  float heightAt(texture2d<float> glyphs, float2 uv, float2 texel, constant Uniforms &u) {
    float a = mask(glyphs,uv,u);
    if(a<0.001) return 0.0;
    float rim = min(min(mask(glyphs,uv+float2(texel.x*2,0),u),mask(glyphs,uv-float2(texel.x*2,0),u)),
                    min(mask(glyphs,uv+float2(0,texel.y*2),u),mask(glyphs,uv-float2(0,texel.y*2),u)));
    // Price is almost flush with the sheet: a compact contact shadow, not the
    // title's tall extrusion projected into a second set of floating digits.
    bool price = all(uv>=u.textA.xy) && all(uv<=u.textA.zw);
    return (price ? priceRelief : titleRelief) * a * (0.45+0.55*rim);
  }
  float visibility(texture2d<float> glyphs, float3 p, float3 emitter, constant Uniforms &u) {
    float aspect=u.settings.w; float2 texel=1.0/u.atlas.zw;
    if (p.z >= titleRelief + 0.0005) return 1.0;
    // Integrate through the only occupied slab. Unlike screen-space darkening,
    // this tests the same geometric height field used to shade the letters.
    float3 ray = emitter-p;
    float z0 = max(p.z+0.0006, 0.0006);
    float2 start=(p+ray*((z0-p.z)/ray.z)).xy/float2(aspect,1);
    float2 end=(p+ray*((titleRelief-p.z)/ray.z)).xy/float2(aspect,1);
    float2 lo=min(start,end)-texel*3.0, hi=max(start,end)+texel*3.0;
    bool hitA=all(hi>=u.textA.xy)&&all(lo<=u.textA.zw);
    bool hitB=all(hi>=u.textB.xy)&&all(lo<=u.textB.zw);
    if(!hitA&&!hitB) return 1.0;
    // Quadratic spacing resolves the shallow price slab as well as the title.
    for (int k=0;k<16;k++) {
      float tSlab=(float(k)+0.5)/16.0;
      float z = mix(z0,titleRelief+0.0002,tSlab*tSlab);
      if (z<=p.z || z>=emitter.z) continue;
      float t=(z-p.z)/ray.z;
      float2 xy=(p+ray*t).xy;
      float surface=heightAt(glyphs,float2(xy.x/aspect,xy.y),texel,u);
      if(surface > z+0.0003) return 0.0;
    }
    return 1.0;
  }
  float3 fresnel(float c,float3 f0) {return f0+(1.0-f0)*pow(1.0-c,5.0);}
  float ambientVisibility(texture2d<float> glyphs,float3 p,constant Uniforms &u) {
    float2 uv=p.xy/float2(u.settings.w,1);
    float radius=0.0;
    if(all(uv>=u.textA.xy-0.008)&&all(uv<=u.textA.zw+0.008)) radius=0.006;
    if(all(uv>=u.textB.xy-0.04)&&all(uv<=u.textB.zw+0.04)) radius=0.035;
    if(radius==0.0) return 1.0;
    float visible=0.0;
    // Local hemisphere integration adds contact between the raised metal and
    // its matte receiver. Its shadow comes from glyph intersections, not blur.
    for(int i=0;i<12;i++) {
      float a=float(i)*2.399963;
      float r=radius*sqrt((float(i)+0.5)/12.0);
      float3 q=p+float3(cos(a)*r,sin(a)*r,radius*0.62);
      visible+=visibility(glyphs,p,q,u);
    }
    return 0.3+0.7*visible/12.0;
  }
  float smith(float n,float a2) { return 2.0*n/max(n+sqrt(a2+(1.0-a2)*n*n),0.001); }
  float3 brdf(float3 n,float3 v,float3 l,float3 f0,float rough) {
    float3 h=normalize(v+l);
    float nl=max(dot(n,l),0.001),nv=max(dot(n,v),0.001);
    float nh=max(dot(n,h),0.0),vh=max(dot(v,h),0.0),a2=pow(rough,4.0);
    float d=a2/max(PI*pow(nh*nh*(a2-1.0)+1.0,2.0),0.0001);
    return d*smith(nl,a2)*smith(nv,a2)*fresnel(vh,f0)/max(4.0*nl*nv,0.001);
  }
  float3 film(float3 x) {return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
  float3 displayRadiance(float3 radiance, float headroom) {
    if(headroom<=1.001) return film(radiance);
    float peak=max(max(radiance.r,radiance.g),radiance.b);
    // Hue-preserving highlight shoulder. Values above SDR white remain >1 in
    // the floating-point drawable; never gamma-encode this linear P3 output.
    float mapped=peak<=1.0?peak:1.0+(headroom-1.0)*(1.0-exp(-(peak-1.0)/(headroom-1.0)));
    return radiance*(mapped/max(peak,0.0001));
  }
  float3 emission(float2 q,float time) {
    // One emissive material for the visible button and every lighting sample.
    float flow=0.5+0.5*sin(q.x*5.0 + sin(q.y*3.0-time)*0.65 + time);
    return mix(float3(1.0,0.17,0.008),float3(1.0,0.54,0.075),flow)*10.0;
  }
  fragment float4 saverFragment(Raster in [[stage_in]], constant Uniforms &u [[buffer(0)]],
                                texture2d<float> glyphs [[texture(0)]]) {
    float mode=u.settings.z, dark=u.settings.y, aspect=u.settings.w;
    float2 uv=u.rect.xy+in.uv*u.rect.zw;
    float2 texel=1.0/u.atlas.zw;
    float slow=u.settings.x*(2.0*PI/80.0), fast=u.settings.x*(2.0*PI/8.0);
    if(mode>2.5) {
      // Display-compress the emitter while preserving the same spatial radiance
      // pattern used by the area integral. The entire surface emits light.
      float3 rgb=displayRadiance(emission(in.uv,slow)*0.13,min(u.display.x,1.65));
      return float4(rgb,1.0);
    }
    bool metal=mode>0.5;
    bool raised=mode>1.5;
    float alpha=raised?mask(glyphs,uv,u):1.0;
    if(alpha<0.005) return float4(0.0);
    float z=raised?heightAt(glyphs,uv,texel,u):0.0;
    float3 p=float3(uv.x*aspect,uv.y,z);
    float3 normal=float3(0,0,1);
    if(raised) {
      float dx=(heightAt(glyphs,uv+float2(texel.x,0),texel,u)-heightAt(glyphs,uv-float2(texel.x,0),texel,u))/(2.0*texel.x*aspect);
      float dy=(heightAt(glyphs,uv+float2(0,texel.y),texel,u)-heightAt(glyphs,uv-float2(0,texel.y),texel,u))/(2.0*texel.y);
      normal=normalize(float3(-dx,-dy,1));
    } else if(!metal) {
      // Broad satin folds, not small noisy waves. Analytic derivatives of the
      // normal-mapped surface bend studio reflections slowly over the sheet.
      float a=uv.x*5.5+uv.y*3.0-slow, b=uv.x*2.5-uv.y*4.0+slow*0.7;
      float upper=1.0-smoothstep(0.45,0.80,uv.y);
      normal=normalize(float3(-(cos(a)*0.78+cos(b)*0.28)*upper,
                               -(cos(a)*0.42-cos(b)*0.45)*upper,1));
    }
    float3 v=normalize(float3(aspect*0.5,0.4,2.5)-p);
    // Broad liquid folds, with a finer secondary reflection travelling through
    // them. The brand shares one continuous field rather than flashing a glow.
    float fold=uv.x*9.0+uv.y*3.0-fast+sin(uv.y*5.0+fast)*0.7;
    float wave=0.5+0.5*sin(fold);
    bool brand=u.display.y>0.5;
    float3 alloy=brand?mix(float3(0.98,0.085,0.008),float3(1.0,0.58,0.075),wave):float3(0.95,0.90,0.80);
    // Low-reflectance charcoal under broad ambient illumination keeps the
    // emitter's footprint visible without bleaching the annual-price copy.
    float3 albedo=metal?alloy:(dark>0.5?float3(0.018,0.019,0.021):float3(0.82,0.80,0.75));
    float3 reflected=albedo*(metal?(brand?0.22:0.55):(dark>0.5?2.2:0.27));
    if(!metal) reflected*=ambientVisibility(glyphs,p+float3(0,0,0.0004),u);
    if(!metal) {
      // A broad offscreen studio softbox reflected by the upper satin sheet.
      // Keep the lower purchase region matte so its text never sits on a flare.
      float satin=1.0-smoothstep(0.44,0.76,uv.y);
      float3 f0=float3(0.34,0.16,0.075);
      for(int k=0;k<8;k++) {
        float2 s=float2((float(k)+0.5)/8.0,fract(float(k)*0.618034));
        float3 q=float3(-0.6+s.x*1.6,-0.7+s.y*0.8,1.2);
        float3 ray=q-p;float r2=dot(ray,ray);float3 l=ray*rsqrt(r2);
        reflected+=float3(1.0,0.74,0.48)*brdf(normal,v,l,f0,0.55)*
          max(dot(normal,l),0.0)*max(l.z,0.0)*1.28*1.5/(8.0*r2)*satin;
      }
    }
    if(u.display.y>0.5) {
      // Persistent bright studio reflection on the two brand marks. This
      // environment is independent of the CTA, so neither mark loses HDR as
      // the button scrolls. It does not cast another shadow into the scene.
      float ribbon=pow(0.5+0.5*cos(fold*1.35+sin(uv.x*13.0+fast)*0.35),8.0);
      float3 environment=alloy*(1.35+2.7*ribbon)+float3(1.0,0.68,0.22)*ribbon*0.4;
      reflected+=environment;
    }
    float width=u.lamp.z*aspect, depth=u.lamp.w;
    // Rectangular area emitter sits above the backing sheet. Its normal faces
    // the sheet and the content above it, like a recessed, tilted light panel.
    float3 lightNormal=normalize(float3(0,-0.85,-1.0));
    float area=width*depth*sqrt(1.0+0.85*0.85);
    for(int i=0;i<areaSamples;i++) {
      float2 sample=float2((float(i)+0.5)/float(areaSamples),fract(float(i)*0.61803398875+0.5));
      float3 q=float3((u.lamp.x+sample.x*u.lamp.z)*aspect,
                       u.lamp.y+sample.y*depth,0.10-sample.y*depth*0.85);
      float3 ray=q-p; float r2=max(dot(ray,ray),0.0001); float3 l=ray*rsqrt(r2);
      float cosIn=max(dot(normal,l),0.0), cosOut=max(dot(lightNormal,-l),0.0);
      if(cosIn<=0.0 || cosOut<=0.0) continue;
      float shadow=visibility(glyphs,p+normal*0.0004,q,u);
      // Matte backing avoids a specular hotspot behind the price. Metal keeps
      // the real area-source reflection; all objects retain the same emitter.
      float3 f=metal?brdf(normal,v,l,alloy,brand?0.25:0.38):albedo/PI;
      reflected+=emission(sample,slow)*f*cosIn*cosOut*area/(float(areaSamples)*r2)*shadow;
    }
    // No invented shafts in empty air: visible light is radiance reflected by
    // the sheet and letters. The glyphs cast area-light penumbras onto the sheet.
    float3 rgb=metal?displayRadiance(reflected,u.display.x):film(reflected);
    return float4(rgb*alpha,alpha);
  }
  """
}
