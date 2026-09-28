# Glass Lab

The second native tab is a full-bleed Apple map with station price pills. It shares
the fuel service cache, but its rendering and animation are independent of Home.

`ClusterLabMapView` owns MapKit and the display link. `ClusterLabGeometry` performs
screen-space spatial hashing and contact hysteresis (84 × 32 pt to connect,
108 × 48 pt to disconnect, allowing a small extra stretch before splitting). `ClusterLabRenderer` owns
station identity, projection, reversible motion, and atomic handoffs.
`ClusterLabDynamics` handles mass-weighted impacts and magnetic home springs.
`ClusterLabGlass` uses the installed Callstack library's public Swift glass views.
The shared native container uses Apple's `UIGlassContainerEffect`; it does not
draw an imitation or place glass in MapKit annotation snapshots. Native glass
spacing is 12 pt, giving the connecting neck a little extra stretch.

Only visible stations and a 160-point approach margin participate. One container
extends 336 points beyond all map edges, including refraction and badge travel.
Settled groups retain a price and count view, not hidden views for each member.
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
JS camera-event loop. The display link sleeps when settled, unfocused, detached,
or backgrounded. Reduced Motion resolves transitions immediately. Older systems
use plain rounded system-background pills.

## Shared cluster motion

A station contributes one mass unit. On contact, the incoming pill and receiving
cluster share a mass-weighted velocity; contact retains 85% of incoming velocity
for a softer connection, and bounded viscous loss prevents runaway energy.
Both the main price and count move together. On an actual partition,
equal-and-opposite impulses go to the departing mass and remaining mass. A whole
cluster merging into another cluster does not falsely trigger release impulses.

At contact, the incoming pill briefly resists while the receiving cluster takes
its momentum. A smooth local clock adjustment slows then catches up over at most
65 ms, entirely before the existing outward peak. Maximum clock lag is 14.3 ms;
a smooth spatial limit keeps the visible lag below 6 pt even on fast arrivals.
The clock never stops or reverses, and position/velocity/acceleration remain continuous
at both ends. The native glass neck gets a moment to stretch without adding a
second bounce, extra views, or a later completion. Splits and the rebound curve
are unchanged. Retargeting clears the catch and starts from the current pose;
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
