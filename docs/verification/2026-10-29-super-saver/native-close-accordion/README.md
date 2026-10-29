# Super Saver: HDR Metal, refined shadows, native controls

This revision supersedes the parent folder's three-line composition and painted
beam shader. It remains a default-off preview at $19.99/year, without billing.

## Final design

The paywall always uses dark styling, independently of the app's theme. A lifted,
warm charcoal receiving surface makes the shadows visible. The normal centered
132 × 38 Fuel Up wordmark and separate Super Saver title share animated copper /
gold material with persistent HDR reflections. The price has shallow relief and a
short contact shadow; the title has deeper relief and a stronger shadow.

## Actual Metal and HDR output

`MTKView` and its pipeline use `rgba16Float`. The backing `CAMetalLayer` opts into
`wantsExtendedDynamicRangeContent` with `extendedLinearDisplayP3`. Shader output
is linear floating-point color, not gamma-encoded or clamped to SDR white.
Each frame reads the current display EDR headroom (capped at 4), with a
hue-preserving highlight shoulder. EDR is enabled throughout the preview;
brightness, thermal conditions and display capability can still limit available
headroom to 1. SDR fallback tone-maps within [0,1]. Reduce Motion also responds to
headroom changes while holding animation phase still.

The two brand surfaces have a persistent bright environment reflection in addition
to direct button lighting. The background remains SDR to keep the reading surface
subdued. The price is lit by the button and has no independent brand reflection.
The emitter itself uses display compression while retaining its spatial emission
pattern. These material/exposure choices are art directed.

Direct illumination integrates 64 samples over the button's measured rectangle,
with projected area, both surface cosines, inverse-square falloff, and a GGX
conductor BRDF. Actual glyph outlines form beveled height fields. Sixteen
quadratically spaced samples resolve shadow visibility through both the shallow
price slab (0.0016 screen-height units) and taller title slab (0.012). No painted
beam sprite or point-source glow is used.

This is sampled direct lighting, not hardware triangle ray tracing or multi-bounce
path tracing. Native glass-card refraction, fog and indirect bounces are not part
of the Metal scene. The shared geometry atlas is cached across scrolling; only
screen rectangles update. Rendering is 30 fps, at most two in-flight buffers,
with the background capped at 360 px wide; offscreen views pause.

Apple references: [EDR tone mapping](https://developer.apple.com/documentation/metal/performing-your-own-tone-mapping),
[current display headroom](https://developer.apple.com/documentation/uikit/uiscreen/currentedrheadroom).

## Controls and illustrations

- Close is UIKit `UIButton(type: .close)` without a custom glass wrapper.
- Price-drop alerts starts expanded; exactly one panel opens at a time.
  Every illustration is 166 points high.
- Notification uses native glass and an iOS notification layout; it is an in-app
  illustration rather than an embedded system notification.
- Route uses Apple Maps; favorite station uses a simplified Shell price curve.
  Illustrated prices and the all-time-low label are examples.
- Continue and Restore only show preview alerts. No StoreKit transaction occurs.

## Verification

`swift scripts/design/verifySaverLighting.swift` compiles the production shader
and executes it into an `rgba16Float` target on the Mac GPU. `metal-transport.json`
contains the output metrics. This tests actual GPU pixels rather than inferring
HDR from a bright-looking SDR screenshot.

- Both brand surfaces exceeded SDR white at every opaque fixture pixel across
  16 animation phases: minimum peak channels 1.47 / 1.48 with headroom 3.
- SDR fallback remained within [0,1]; no nonfinite or negative pixel output.
- Matched-geometry price shadow mean distance was 1.00 pixels; title was 9.38.
  Both cast measurable shadows. Emitter width changed the lighting integral.
- These are synthetic geometry checks, not proof of physical display luminance
  or on-phone GPU performance. Screenshot previews cannot demonstrate HDR peaks.
- `npm test`: 165 passed. Paywall files parse through the project Babel config.
- Earlier interaction checks in this revision verified native close dismissal,
  normal header geometry, one expanded accordion, the three 166-point graphics,
  preview-only Continue, mini/Pro Max layout and Accessibility Large scrolling.
- Existing Home location warnings were inspected and dismissed for captures;
  logging was not suppressed. No cluster or collection code changed.

## Riveo reference and screenshot iterations

The visual reference was [Riveo’s animated pricing sheet](https://60fps.design/shots/riveo-pricing-sheet): cinematic motion behind a calm dark foreground, with stable pricing and controls. This implementation uses original copper/satin Metal surfaces rather than Riveo video assets. Broad, slowly changing reflections sit above a matte purchase area. Native glass has explicit dark tint so it remains dark when the rest of Fuel Up uses Light appearance.

Four rendered iterations are retained: the rejected bright wash, matte refinement, copper refinement, and final composition. The final pass reduces light spill behind renewal text and makes the price neutral warm metal instead of hollow orange lettering.

Final screenshots:
- [Mini, price alerts](final-mini-price-alerts.png)
- [Mini, route](final-mini-route.png)
- [Mini, favorite station](final-mini-favorite.png)
- [Pro Max](final-pro-max.png)
- [Mini, closed and reopened](final-mini-reopened.png)

Final Debug simulator and signed Release device builds succeeded. Release 1.0.1 (39) was installed in place on the paired iPhone 18 Pro Max and launched with the preview URL. The local build enables the preview flag; the repository default remains off. No App Store upload was made.

Visual and accordion checks were performed on iPhone 13 mini and iPhone 17 Pro Max simulators. The final native close dismissed to the previous screen; reopening restored the initial alert panel and correctly masked cached Metal text. The physical device was available over the network, so installation and CLI launch are verified separately from simulator visual QA. Actual phone HDR luminance and phone frame times were not measured.
