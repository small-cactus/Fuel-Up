#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Move the combined placeholder/result silhouette as a soft liquid sheet.
// Travel and deformation both vanish at the endpoints, preserving live layout.
[[ stitchable ]] float2 fuelUpSkeletonFlow(float2 position, float2 size, float progress) {
    float t = clamp(progress, 0.0, 1.0);
    float pulse = pow(sin(M_PI_F * t), 2.0);
    float2 uv = position / max(size, float2(1.0));
    float wave = sin(position.y * 0.035 - t * M_PI_F * 1.4);
    float gather = (uv.x - 0.5) * 10.0;
    float2 flow = float2(gather + wave * 3.5,
                        sin(uv.x * M_PI_F) * cos(position.y * 0.018 + t * 2.0) * 5.0);
    return position + flow * pulse;
}

// Pull the blurred, overlapping silhouettes together before releasing them
// into separate letters/icons. This acts on the PAIR, not two independent fades.
[[ stitchable ]] half4 fuelUpSkeletonInk(float2 position, half4 color, float progress) {
    float pulse = pow(sin(M_PI_F * clamp(progress, 0.0, 1.0)), 2.0);
    float alpha = float(color.a);
    if (alpha < 0.001) return half4(0.0);
    float liquidAlpha = smoothstep(0.035, 0.68, alpha);
    float resolvedAlpha = mix(alpha, liquidAlpha, pulse * 0.8);
    return half4(color.rgb * half(resolvedAlpha / alpha), half(resolvedAlpha));
}
