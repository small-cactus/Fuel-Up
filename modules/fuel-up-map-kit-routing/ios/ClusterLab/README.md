# Glass Lab

The second native tab is a full-bleed Apple map with station price pills. It shares
the fuel service cache, but its rendering and animation are independent of Home.

`ClusterLabMapView` owns MapKit. `ClusterLabMapAnchor` places the shared glass
root inside one live `MKAnnotationView`. MapKit moves that carrier with its
map content, so panning does not depend on the overlay catching up to a camera
callback. The renderer projects pill positions into padded viewport coordinates;
the carrier compensates its geographic anchor inside the same transaction. It
recenters as the anchor approaches the viewport edge, retaining the same glass
views and their local positions. Immediate camera jumps move the anchor first
to avoid MapKit culling its old coordinate, then repair stale placement before
commit. The clock observes the next 100 ms of native placement work even if the
camera has already stopped; this adds no motion or easing. MapKit retains
ordinary subpixel placement. The placement/visibility repair is restricted to
explicit camera jumps; applying it during gestures reintroduces tracking slips.
This uses one annotation, not one per station, and
does not rasterize or snapshot the glass. The carrier does not clip its children.

`ClusterLabFrameClock` uses UIKit's
`UIUpdateLink.beforeCATransactionCommit` phase on iOS 18 and later: camera
callbacks mark the projection dirty, then clustering and pill positioning run
once after gesture and display-link work, before the frame is committed. This
avoids competing early camera callbacks and display-link updates. Tracking stays
active through camera deceleration; the clock observes passively when settled
and requests continuous frames only for camera motion, transitions, or a probe.
Older iOS uses a display-link fallback. No camera smoothing or prediction adds
lag, and the approved cluster springs remain separate from map anchoring.
`ClusterLabGeometry` performs
screen-space spatial hashing and contact hysteresis (84 × 32 pt to connect,
120 × 56 pt to disconnect for side-by-side stations). Vertically dominant
pairs connect at 32 pt and disconnect at 34 pt: a two-point anti-chatter band
without the extended retention or pre-split count stretch. Spatial
hash cells span this retained range so stretched neighbors remain discoverable. `ClusterLabRenderer` owns
station identity, projection, reversible motion, and atomic handoffs.
`ClusterLabDynamics` handles mass-weighted impacts and magnetic home springs.
`ClusterLabMarket` gives only the cheapest confirmed station in the loaded search
snapshot a green tint. The input already excludes estimated prices and
contains only the selected fuel grade. Stable station-ID order breaks price ties,
matching cluster ownership. Every alternative is red, including tied prices.
Saturation is lowest near the typical local price. Red grows more saturated
above the local median; below-market alternatives remain pastel red. The green
winner grows more saturated with its savings below the local median. Full
saturation means a difference of at least 15 cents or 8% of that reference,
whichever is larger. The median uses up to 12 peers within five miles; with
fewer than three, the loaded search median supplies the reference. This is
recomputed only when data changes, so panning and zooming never reassign colors.

The tint matches onboarding's #00FF2F green and #FF1900 red at 30% opacity.
Saturation ranges from pastel to the original onboarding hue, with constant
brightness and opacity. Adaptive system-label foregrounds match onboarding's
light/dark text treatment and stay legible over the lighter regular glass.

`ClusterLabGlass` uses the installed Callstack library's public Swift glass views.
Pills use regular glass with native `UIGlassEffect.tintColor`, high-contrast text,
and a spoken local-price comparison. The count shares its representative price's
tint. Departing duplicates start with the count's tint, then transition to their
own station tint; incoming pills transition to the receiving cluster tint. A
cached target starts at most one 80 ms native material animation per change;
ordinary camera frames never rebuild the effect. Reduced Motion applies it
immediately. Tinting does not alter the movement or rebound curves.
`ClusterLabGlassGroups` pools Apple's native `UIGlassContainerEffect` views under
the same MapKit carrier. Each effect spans the full padded root. Horizontal
neighbors share an effect with the unchanged 36 pt spacing. Vertically dominant
neighbors use separate effects until their actual capsule edges are within 2 pt;
there is no stretched vertical bridge between separate rows. Spatial hashing
and stable group assignments minimize work and reparenting. Far-apart runs reuse
effects, and pills retain their identity and coordinates when changing groups.
Horizontal chains remain a single effect, including turns: native effects have
transitive membership, so a vertical pair indirectly joined through a horizontal
chain cannot be isolated without breaking that horizontal connection.
Connection impulses keep the previously tuned 18-point contact band inside this
longer native neck; the catch and rebound curves are unchanged.

Only visible stations and a 160-point approach margin participate. The root and every native effect
extend 360 points beyond all map edges, including refraction and badge travel.
Settled groups retain a price and count view, not hidden views for each member.
Before a horizontally retained group splits, its count moves outward with the map through
up to 18 points of additional horizontal travel. This uses the existing
84 × 32 to 120 × 56 hysteresis band: the count remains +n and 44 points wide
while it pulls away. It no longer stays fixed until the split starts. The native
glass spacing, spring tuning, and flight durations are unchanged.

The count's offset is shared by arriving movers and its rendered badge. A
membership change carries the current count offset into an 80 ms correction,
so a remaining +n does not snap back when one member leaves. Split duplicates
start at the actual stretched badge position, including its current recoil.

The first arriving mover becomes the count view in place. Further movers are
removed in the same transaction that increments the count. Splitting materializes
the count duplicate at exactly the count's location, then reuses that view as its
final price pill. Position, dimensions, and content share the same progression.
Glass and glass ancestors always keep alpha 1; only label content crossfades.

Motion is retargeted from its current map coordinate and screen offset. Its
80–220 ms base duration follows measured camera velocity and elapsed movement time.
Camera completion can shorten an unfinished outward flight to an 80 ms base
without changing the current pose; an ongoing rebound finishes in full. An elapsed-time viscous curve eases into motion, surges past the destination,
then returns once. Outward travel keeps its original timing; the rebound runs
at half its previous speed for twice its previous duration. Rebound scales with
both travel and measured gesture speed,
up to 18 screen points. The curve has zero velocity and acceleration at its
endpoints and turnaround. Total duration is 1.32 times the base duration,
with the added time confined to the return. There is no fixed points-per-frame
speed limit or trailing exponential tail. MapKit's
projection is read natively during camera changes, including rotation; there is no
JS camera-event loop. Continuous frame requests stop when settled; the clock is
released when unfocused, detached, or backgrounded. Reduced Motion resolves transitions immediately. Older systems
use plain rounded system-background pills.

## Shared cluster motion

A station contributes one mass unit. On contact, the incoming pill and receiving
cluster share a mass-weighted velocity; contact retains 85% of incoming velocity
for a softer connection, and bounded viscous loss prevents runaway energy.
Both the main price and count move together. On an actual partition,
equal-and-opposite impulses go to the departing mass and remaining mass. The
recoil waits for the actual rendered capsule edges to separate by 27 pt (or for
the pill to arrive), rather than firing while the split copies still overlap.
This retained release policy is separate from the new map-driven count travel. The release retains the
same impulse strength and flight deadline. Reversals discard the pending release,
camera-end retiming preserves it, and Reduced Motion clears it. A whole
cluster merging into another cluster does not falsely trigger release impulses.

At contact, the incoming pill briefly resists while the receiving cluster takes
its momentum. A smooth local clock adjustment slows then catches up over at most
65 ms, entirely before the existing outward peak. Maximum clock lag is 14.3 ms;
a smooth spatial limit keeps the visible lag below 6 pt even on fast arrivals.
The clock never stops or reverses, and position/velocity/acceleration remain continuous
at both ends. The native glass neck gets a moment to stretch without adding a
second bounce, extra views, or a later completion. The contact catch leaves the
rebound curve untouched. Retargeting clears the catch and starts from the current pose;
Reduced Motion skips it.

The screen-space spring offset is added to the live MapKit projection. Its exact
damped-oscillator solution is independent of frame rate, retains state through
interruptions, and dissipates energy back to zero. One shared energy budget caps
excursions at 36 pt without hard-clamping positions. Reduced Motion clears it.
No extra effect views or animation clocks are created.

UIKit Dynamics and UIKit spring animators were considered. They take ownership
of view positions; this renderer instead needs map projection, glass geometry,
impacts and view handoffs committed together in the existing display-link
transaction. The small Swift solver keeps that ownership in one place. Glass
rendering and merging still use the native Apple effect via Callstack.

## Verification

Build after installing pods because the map is native Swift:

```
cd ios && pod install
```

Run with a development build and Metro on the selected simulator:

```
node --test tests/clusterLabGeometry.test.cjs tests/clusterLabDynamics.test.cjs
node --test tests/clusterLabMarket.test.cjs tests/clusterLabGlassGrouping.test.cjs
FUELUP_SIMULATOR_UDID=<udid> node --test tests/clusterLabProbe.integration.test.cjs
```

The debug deep link `fuelup:///cluster-lab?clusterLabProbe=<unique-token>` runs
stepped and one-shot MapKit zooms using a deterministic six-station fixture. It
exports actual native view frames, transition events, and reset geometry to
`Documents/cluster-lab-probe.json`, then restores real stations and the camera.
Leaving the tab cancels the probe and reports cancellation as a failure.

The native gate checks completion within 300 ms (including scheduling allowance),
exact handoff alignment, container bounds, view count, and reset geometry. It
reports actual frame travel rather than restricting gesture speed. Pure Swift
checks exercise timing and rebound across travel distances and frame rates.
The live gate also requires visible main-price reactions to both contact and
release, equal displacement of the connected price/count, bounded physical
travel, and balanced split impulses. These are actual UIKit frame samples.
This is additional coverage. It does not replace or weaken the existing Home
`tests/clusterProbe.integration.test.cjs` gate or its JSON export.

The additional `pair-` probe token runs the same map zoom sequence with two
stations to isolate +1. Its gate requires at least 12 points of actual connected
count travel, multiple intermediate frames with unchanged count/width/content,
and a split duplicate within 0.12 points of the stretched badge. The normal
six-station gate remains in place.

The `anchor-` probe adds long pans in both directions and immediate camera jumps.
It checks the carrier remains attached and visible, exercises repeated rebasing,
and measures the actual shared surface origin in map coordinates (at most 2 pt
of offset), then verifies all six station views return. This hierarchy check
complements recorded drag comparisons against visible map features; local pill
coordinates alone cannot establish that the glass tracks the rendered map.

The `vertical-` probe isolates a north/south pair. Its live gate requires repeated
merges/splits with the connected count held at its normal 56 pt offset throughout,
plus an exact split handoff and separate actual native effect parents for close
stacked prices. The horizontal pair probe continues to require its
full visible outward travel. Native glass spacing and recoil remain unchanged.

## Tab-entry framing

`ClusterLabCameraFit` solves the initial north-up camera in projected map coordinates,
including the full price capsule and the extra width of every predicted count.
It searches exact contact-scale intervals and solves their monotonic bounds,
including the existing smoothstep stretch on a transitive group's count;
the largest feasible uniform scale also minimizes fresh clustering. All station
locations remain in frame, including members represented by a count. The native
MapKit camera receives the resulting rect once, before pill creation. Its native
layout margins are accounted for so safe areas are not padded twice. Longitudes
are unwrapped across the date line. A single station has a 250 m minimum map width.

The fit reserves 15 pt of blank space on both sides, plus a 2 pt rendering
allowance, and respects the native safe areas at the top and bottom. It runs on
tab entry, station-data changes, and size/safe-area changes; normal camera gestures
do not trigger it. Initial groups are seeded directly in their settled poses,
without leftover hysteresis or flights from the old camera. Home is unchanged.

`tests/clusterLabCameraFit.test.cjs` checks bounds, group widths, deterministic
ordering, and optimal zoom against tighter alternatives across compact, large,
and landscape phone sizes. The live `fit-` probe checks every represented station,
actual native pill bounds, and absence of transition flights from the first frame.

## User location

Glass Lab uses MapKit's standard blue user-location annotation while the tab is
active, with native annotation z-priority keeping it above the glass. Location
updates refresh projection without enabling camera following or refitting it.
No custom location marker, duplicate location manager, or accuracy-circle
avoidance is introduced.

`ClusterLabLocationClearance` protects the dot and its white rim with a small
15 pt radius. Overlapping prices/counts receive a shared vertical translation,
limited to 32 pt. It picks the shorter clear direction, prefers the side without
neighboring pills when possible, and respects the visible safe-area edges.
Longitude and all station coordinates stay unchanged. Adjustments ease over
80 ms without rebound, resolve immediately for Reduced Motion, and are seeded
before the first fitted frame. A split inherits the source count's displacement;
its existing flight interpolates toward its own clearance, preserving handoffs.
The native dot stays above the pills even when a crowded edge leaves insufficient
space for full separation within the displacement cap.

The `location-` live probe places a price/count at the actual simulator GPS fix
and verifies the native annotation, z-priority, shared bounded displacement,
actual rendered clearance, and unchanged distant station positions. Frame
telemetry includes the presentation translation in the measured pill coordinates.
