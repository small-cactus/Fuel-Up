#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// One bounded sampling pass over the splash only. The real map stays untouched.
[[ stitchable ]] half4 fuelUpLaunchBubble(float2 position, SwiftUI::Layer layer,
                                         float2 size, float progress) {
    if (progress <= 0.0) return layer.sample(position);
    if (progress >= 1.0) return half4(0.0);
    float2 center = size * 0.5;
    float2 delta = position - center;
    float distance = length(delta);
    float radius = max(length(center), 1.0);
    float d = distance / radius;
    float2 direction = delta / max(distance, 0.001);

    // Inflate first; the white-fade rim leads the live UIKit blur-clearing rim.
    float swell = sin(M_PI_F * smoothstep(0.0, 0.68, progress));
    float front = mix(-0.24, 1.28, smoothstep(0.0, 0.76, progress));
    float rim = exp(-pow((d - front) / 0.16, 2.0));
    float displacement = 22.0 * swell * exp(-d * d * 3.0)
                       + 12.0 * rim * sin(M_PI_F * progress);
    displacement *= 1.0 - exp(-distance / 100.0);
    float2 samplePosition = position - direction * displacement;
    float blur = (2.0 * swell + 7.0 * rim) * smoothstep(0.0, 0.22, progress);
    // Sampling is clamped at the artwork edge to avoid transparent fringes.
    float2 lo = float2(0.5);
    float2 hi = max(size - 0.5, lo);
    half4 color = layer.sample(clamp(samplePosition, lo, hi)) * 0.25h;
    for (int i = 0; i < 8; i++) {
        float angle = float(i) * M_PI_F * 0.25;
        float2 offset = float2(cos(angle), sin(angle)) * blur;
        color += layer.sample(clamp(samplePosition + offset, lo, hi)) * 0.09375h;
    }
    float opacity = smoothstep(front - 0.22, front + 0.10, d);
    return color * half(opacity);
}
