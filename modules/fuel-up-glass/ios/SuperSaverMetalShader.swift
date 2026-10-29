import Foundation

// Broad, smooth fields only: no particles, noise, sharp edges, or rapid oscillation.
// One full cycle takes 80 seconds. The logo carries color; the background stays subdued.
enum SuperSaverMetalShader {
  static let source = """
  #include <metal_stdlib>
  using namespace metal;
  struct Raster { float4 position [[position]]; float2 uv; };
  struct Uniforms { float time; float dark; float wordmark; float aspect; };
  vertex Raster saverVertex(uint id [[vertex_id]]) {
    float2 p = float2((id << 1) & 2, id & 2);
    Raster out;
    out.position = float4(p * 2.0 - 1.0, 0.0, 1.0);
    out.uv = float2(p.x, 1.0 - p.y);
    return out;
  }
  fragment float4 saverFragment(Raster in [[stage_in]], constant Uniforms &u [[buffer(0)]]) {
    float t = u.time * 0.078539816;
    float2 p = in.uv;
    float bend = sin(p.y * 3.2 + t) * 0.22 + cos(p.x * 2.8 - t) * 0.16;
    float flow = 0.5 + 0.5 * sin(p.x * 4.2 + p.y * 2.4 + bend * 3.0 - t);
    float sheen = pow(0.5 + 0.5 * cos(p.x * 3.8 - p.y * 2.2 + bend * 2.0 + t), 4.0);
    float3 ember = float3(0.96, 0.20, 0.015);
    float3 orange = float3(1.0, 0.45, 0.015);
    float3 gold = float3(1.0, 0.77, 0.12);
    float3 molten = mix(ember, orange, smoothstep(0.0, 0.65, flow));
    molten = mix(molten, gold, sheen * 0.9);
    if (u.wordmark > 0.5) return float4(molten, 1.0);

    // A soft metallic fold in the upper half fades out before the purchase controls.
    float fold = exp(-pow((p.x + p.y * 0.72 + bend - 0.62) * 2.5, 2.0));
    float envelope = 1.0 - smoothstep(0.35, 0.92, p.y);
    float glow = (fold * 0.72 + sheen * 0.28) * envelope;
    float3 lightBase = float3(0.962, 0.956, 0.946);
    float3 darkBase = float3(0.022, 0.021, 0.020);
    float3 lightMetal = float3(0.94, 0.79, 0.60);
    float3 darkMetal = float3(0.24, 0.15, 0.075);
    float3 color = u.dark > 0.5
      ? mix(darkBase, darkMetal, glow * 0.58)
      : mix(lightBase, lightMetal, glow * 0.32);
    return float4(color, 1.0);
  }
  """
}
