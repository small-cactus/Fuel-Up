#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Compress a single surface, then reverse the flow for a small spring recoil.
// Travel and deformation both vanish at the endpoints, preserving live layout.
[[ stitchable ]] float2 fuelUpSkeletonFlow(float2 position, float2 size, float progress) {
    float t = clamp(progress, 0.0, 1.0);
    float pulse = sin(2.0 * M_PI_F * t) * sin(M_PI_F * t);
    float2 uv = position / max(size, float2(1.0));
    float wave = sin(position.y * 0.035 - t * M_PI_F * 1.4);
    float gather = (uv.x - 0.5) * 10.0;
    float2 flow = float2(gather + wave * 3.5,
                        sin(uv.x * M_PI_F) * cos(position.y * 0.018 + t * 2.0) * 5.0);
    return position + flow * pulse;
}
